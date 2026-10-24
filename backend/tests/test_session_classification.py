import json
import os
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from analysis.session_classification import validate_discovery, pack_videos, classify_batch, MAX_BATCH_VIDEOS, MAX_BATCH_CHARS
from analysis.topic_store import TopicStore
from analysis.ollama_client import OllamaError

with patch.dict(os.environ, {"MONGODB_URI": "mongodb://localhost:27017"}):
    from app.services.session_analysis import classify_session_data, process_session_analysis, collect_session_videos
    from app.routes.sessions import router
    from app.instagram import router as instagram_router
    from analysis.analyzer import ModelUnavailableError


def topic(key, name, parent=None, videos=(), existing=None):
    return {"key": key, "name": name, "description": f"Videos about {name}", "parent_key": parent,
            "existing_category_id": existing, "video_ids": list(videos)}


def discovery(nodes, ids, unclassified=(), known=()):
    return validate_discovery({"topics": nodes, "unclassified_video_ids": list(unclassified)}, set(ids), set(known))


class DiscoveryValidationTests(unittest.TestCase):
    def test_variable_depth_tree_preserves_video_identity(self):
        result = discovery([topic("tech", "Technology"), topic("ai", "Artificial Intelligence", "tech"),
                            topic("companions", "AI Companions", "ai", ["youtube:a", "youtube:b"])], ["youtube:a", "youtube:b"])
        self.assertEqual(len(result.topics), 3)

    def test_invalid_graphs_and_assignments_are_rejected(self):
        cases = [
            [topic("a", "A", "b", ["v1"]), topic("b", "B", "a")],
            [topic("a", "A", "missing", ["v1"])],
            [topic("a", "A", videos=["invented"])],
            [topic("a", "A", videos=["v1", "v1"])],
            [topic("a", "A", videos=["v1"]), topic("b", "Unused")],
            [topic("a", "AI", videos=["v1"]), topic("b", "ai", videos=["v1"])],
            [topic("a", "A", videos=["v1"], existing="not-in-catalog")],
        ]
        for nodes in cases:
            with self.subTest(nodes=nodes), self.assertRaises(ValueError):
                discovery(nodes, ["v1"])
        with self.assertRaises(ValueError):
            discovery([topic("a", "A", videos=["v1"])], ["v1"], ["v1"])
        with self.assertRaises(ValueError):
            discovery([], ["v1"])

    def test_large_sessions_are_partitioned_without_dropping_videos(self):
        videos = [{"video_id": f"v{i}", "title": "A tutorial", "caption": "x" * 16000} for i in range(100)]
        batches = list(pack_videos(videos))
        self.assertEqual([video["video_id"] for batch in batches for video in batch], [video["video_id"] for video in videos])
        self.assertTrue(all(len(batch) <= MAX_BATCH_VIDEOS for batch in batches))
        self.assertTrue(all(len(video["caption"]) <= 500 for batch in batches for video in batch))
        self.assertTrue(all(len(json.dumps(batch, ensure_ascii=True)) <= MAX_BATCH_CHARS for batch in batches))

    def test_unicode_metadata_is_bounded_without_losing_identity(self):
        videos = [{"video_id": "v1", "title": "\U0001f600" * 1000, "caption": "\U0001f600" * 16000,
                   "context_summary": "\U0001f600" * 600, "comments": ["\U0001f600" * 300] * 12}]
        batches = list(pack_videos(videos))
        self.assertLessEqual(sum(len(json.dumps(video, ensure_ascii=True)) for video in batches[0]), MAX_BATCH_CHARS)
        self.assertEqual(batches[0][0]["video_id"], "v1")

    def test_gemini_fallback_for_invalid_session_output_is_flagged(self):
        client = Mock()
        client.prompt.return_value = {"response": '{"topics":[],"unclassified_video_ids":[]}'}
        with patch("analysis.model_output.GeminiClient") as factory:
            factory.return_value.enabled = True
            factory.return_value.model = "gemini-3.8-flash"
            factory.return_value.prompt.return_value = json.dumps({"topics": [topic("game", "Valorant", videos=["v1"])], "unclassified_video_ids": []})
            result, provenance = classify_batch([{"video_id": "v1", "title": "Valorant guide"}], [], client=client)
        self.assertTrue(provenance["fallback_used"])
        self.assertEqual(result.topics[0].video_ids, ["v1"])
        self.assertEqual(client.prompt.call_count, 2)


class PersistentTaxonomyTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".cache"
        root.mkdir(exist_ok=True)
        self.path = root / f"session_topics_test_{uuid4().hex}.sqlite3"
        self.store = TopicStore(self.path)
        self.addCleanup(lambda: self.path.unlink(missing_ok=True))
        fallback = patch("analysis.model_output.GeminiClient")
        self.gemini = fallback.start().return_value
        self.gemini.enabled = False
        self.addCleanup(fallback.stop)

    def example(self):
        result = discovery([topic("tech", "Technology"), topic("ai", "Artificial Intelligence", "tech"),
                            topic("comp", "AI Companions", "ai", ["v1"]), topic("art", "AI Art", "ai", ["v2"])], ["v1", "v2"])
        assignments = self.store.apply_discovery("user", result)
        self.store.save_session("s1", "user", {"assignments": assignments, "status": "complete", "videos": []})
        view = self.store.view("s1", "user")
        root = view["tree"][0]
        ai = root["children"][0]
        children = {node["name"]: node for node in ai["children"]}
        return root, ai, children

    def test_rollup_counts_and_parent_child_preferences(self):
        root, ai, children = self.example()
        self.assertEqual(root["video_count"], 2)
        self.store.set_preference("user", children["AI Companions"]["id"], True)
        self.assertEqual(self.store.view("s1", "user")["reduce_video_ids"], ["v1"])
        self.store.set_preference("user", ai["id"], True)
        self.assertEqual(self.store.view("s1", "user")["reduce_video_ids"], ["v1", "v2"])
        self.assertTrue(self.store.view("s1", "user")["tree"][0]["children"][0]["children"][0]["inherited"])

    def test_video_counts_use_unique_identity_across_sibling_branches(self):
        result = discovery([topic("tech", "Technology"), topic("ai", "AI", "tech", ["v1"]),
                            topic("code", "Programming", "tech", ["v1"])], ["v1"])
        assignments = self.store.apply_discovery("user", result)
        self.store.save_session("shared", "user", {"assignments": assignments})
        self.assertEqual(self.store.view("shared", "user")["tree"][0]["video_count"], 1)

    def test_semantic_match_reuses_ids_across_sessions(self):
        _, ai, children = self.example()
        existing = children["AI Companions"]["id"]
        nodes = [topic("ai", "AI", existing=ai["id"]), topic("friend", "Virtual AI Friends", "ai", ["v3"], existing)]
        result = discovery(nodes, ["v3"], known=[ai["id"], existing])
        assignments = self.store.apply_discovery("user", result)
        self.assertEqual(assignments["v3"], [existing])
        self.store.save_session("s2", "user", {"assignments": assignments})
        self.assertEqual(TopicStore(self.path).view("s2", "user")["assignments"]["v3"], [existing])

    def test_renames_merges_and_moves_preserve_preferences(self):
        root, ai, children = self.example()
        chosen = children["AI Companions"]["id"]
        target = children["AI Art"]["id"]
        self.store.set_preference("user", chosen, True)
        self.store.edit_category("user", chosen, name="AI Conversation")
        self.assertEqual(self.store.view("s1", "user")["reduce_video_ids"], ["v1"])
        self.store.edit_category("user", chosen, parent_id=root["id"], move=True)
        self.assertEqual(self.store.view("s1", "user")["reduce_video_ids"], ["v1"])
        self.store.edit_category("user", chosen, merge_into=target)
        self.assertEqual(self.store.view("s1", "user")["reduce_video_ids"], ["v1", "v2"])
        self.assertEqual(self.store.view("s1", "user")["assignments"]["v1"], [target])
        with self.assertRaises(ValueError):
            self.store.edit_category("user", root["id"], parent_id=target, move=True)

    def test_user_scoping_prevents_cross_user_category_preferences(self):
        root, _, _ = self.example()
        with self.assertRaises(ValueError):
            self.store.set_preference("someone-else", root["id"], True)
        self.assertIsNone(self.store.view("s1", "someone-else"))

    def test_many_videos_classify_by_batch_and_cache_successful_work(self):
        videos = [{"video_id": f"v{i}", "title": "Valorant tips", "caption": "A game tutorial"} for i in range(25)]
        client = Mock()
        def respond(prompt, system, **kwargs):
            ids = [video["video_id"] for video in json.loads(prompt)["videos"]]
            return {"response": json.dumps({"topics": [topic("valorant", "Valorant", videos=ids)], "unclassified_video_ids": []})}
        client.prompt.side_effect = respond
        result = classify_session_data("large", "user", videos, store=self.store, client=client)
        self.assertEqual(result["tree"][0]["video_count"], 25)
        self.assertEqual(client.prompt.call_count, 3)
        classify_session_data("large", "user", videos, store=self.store, client=client)
        self.assertEqual(client.prompt.call_count, 3)

    def test_partial_retry_reuses_successful_batches(self):
        videos = [{"video_id": f"v{i}", "title": "Valorant tips", "caption": "A game tutorial"} for i in range(13)]
        client = Mock()
        def respond(prompt, system, **kwargs):
            ids = [video["video_id"] for video in json.loads(prompt)["videos"]]
            if ids == ["v12"]:
                raise OllamaError("Local model busy")
            return {"response": json.dumps({"topics": [topic("valorant", "Valorant", videos=ids)], "unclassified_video_ids": []})}
        client.prompt.side_effect = respond
        result = classify_session_data("partial", "user", videos, store=self.store, client=client)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["tree"][0]["video_count"], 12)
        self.assertEqual(result["unclassified_video_ids"], ["v12"])
        client.prompt.reset_mock()
        client.prompt.side_effect = None
        client.prompt.return_value = {"response": json.dumps({"topics": [topic("valorant", "Valorant", videos=["v12"])], "unclassified_video_ids": []})}
        result = classify_session_data("partial", "user", videos, store=self.store, client=client)
        client.prompt.assert_called_once()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["tree"][0]["video_count"], 13)

    def test_reused_branch_keeps_ancestors_missing_from_a_batch(self):
        root, ai, children = self.example()
        chosen = children["AI Companions"]["id"]
        self.store.set_preference("user", root["id"], True)
        result = discovery([topic("comp", "AI Friends", videos=["v3"], existing=chosen)], ["v3"], known=[chosen])
        self.store.save_session("s2", "user", {"assignments": self.store.apply_discovery("user", result)})
        view = self.store.view("s2", "user")
        self.assertEqual(view["tree"][0]["id"], root["id"])
        self.assertEqual(view["reduce_video_ids"], ["v3"])

    def test_comments_alone_do_not_trigger_topic_model_calls(self):
        client = Mock()
        result = classify_session_data("empty", "user", [{"video_id": "v1", "title": "", "caption": "", "comments": ["Must be about gaming"]}], store=self.store, client=client)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["unclassified_video_ids"], ["v1"])
        client.prompt.assert_not_called()


class SessionLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_collector_deduplicates_and_keeps_platforms_separate(self):
        events = [{"platform": "instagram", "video_id": "same", "title": "K-pop dance"},
                  {"platform": "youtube", "video_id": "same", "title": "React tutorial"},
                  {"platform": "instagram", "video_id": "same", "title": "Repeat view"}]
        with patch("app.services.session_analysis.db") as database:
            database.video_events.find.return_value.sort.return_value.to_list = AsyncMock(return_value=events)
            database.instagram_evidence.find_one = AsyncMock(return_value={"metadata": {"title": "K-pop dance"}, "comments": ["Great song"]})
            database.video_analyses.find_one = AsyncMock(return_value={"metadata": {"title": "React tutorial"}})
            videos = await collect_session_videos("s")
        self.assertEqual([video["video_id"] for video in videos], ["instagram:same", "youtube:same"])
        self.assertEqual(videos[0]["comments"], ["Great song"])
        self.assertEqual(videos[1]["title"], "React tutorial")

    async def test_only_completed_pending_sessions_can_claim_classification(self):
        with patch("app.services.session_analysis.db") as database, patch("app.services.session_analysis.collect_session_videos") as collect:
            database.sessions.find_one_and_update = AsyncMock(return_value=None)
            await process_session_analysis("active")
            query = database.sessions.find_one_and_update.call_args.args[0]
            self.assertEqual(query["status"], "completed")
            self.assertEqual(query["taxonomy_status"], "pending")
            collect.assert_not_called()


class SessionRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI(); app.include_router(router)
        self.client = TestClient(app)

    def test_finish_queues_once_and_repeat_finish_is_idempotent(self):
        with patch("app.routes.sessions.db") as database, patch("app.routes.sessions.process_session_analysis", new_callable=AsyncMock) as process:
            database.sessions.find_one = AsyncMock(return_value={"session_id": "s", "user_id": "user", "status": "active"})
            database.sessions.update_one = AsyncMock(return_value=Mock(matched_count=1))
            self.assertEqual(self.client.patch("/sessions/s/finish").status_code, 200)
            process.assert_awaited_once_with("s")
            database.sessions.find_one.return_value = {"session_id": "s", "user_id": "user", "status": "completed", "taxonomy_status": "processing"}
            self.assertEqual(self.client.patch("/sessions/s/finish").status_code, 200)
            process.assert_awaited_once()

    def test_active_sessions_cannot_request_topics_or_set_preferences(self):
        with patch("app.routes.sessions.db") as database:
            database.sessions.find_one = AsyncMock(return_value={"status": "active", "user_id": "user"})
            self.assertEqual(self.client.get("/sessions/s/taxonomy").status_code, 409)
            self.assertEqual(self.client.patch("/sessions/s/taxonomy/preferences", json={"category_id": "c", "reduce": True}).status_code, 409)


class InstagramEvidenceTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI(); app.include_router(instagram_router)
        self.client = TestClient(app)

    def test_instagram_sentiment_and_metadata_are_persisted(self):
        with patch("app.instagram.db") as database, patch("app.instagram.get_analyzer") as analyzer:
            database.instagram_evidence.find_one = AsyncMock(return_value=None)
            database.instagram_evidence.update_one = AsyncMock()
            analyzer.return_value.analyze.return_value = {"summary": {"sentiment_balance": 1},
                "comments": [{"text": "Nice song", "sentiment": "positive", "confidence": .9}]}
            response = self.client.post("/instagram/comments", json={"video_id": "reel1", "comments": ["Nice song"], "title": "K-pop dance"})
            self.assertEqual(response.status_code, 200)
            evidence = database.instagram_evidence.update_one.call_args.args[1]["$set"]
            self.assertEqual(evidence["metadata"]["title"], "K-pop dance")
            self.assertEqual(evidence["model_results"]["roberta"]["summary"]["sentiment_balance"], 1)

    def test_raw_evidence_is_kept_when_sentiment_model_is_unavailable(self):
        with patch("app.instagram.db") as database, patch("app.instagram.get_analyzer") as analyzer:
            database.instagram_evidence.find_one = AsyncMock(return_value=None)
            database.instagram_evidence.update_one = AsyncMock()
            analyzer.return_value.analyze.side_effect = ModelUnavailableError("Unavailable")
            response = self.client.post("/instagram/comments", json={"video_id": "reel1", "comments": ["Nice song"]})
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["sentiment_available"])
            self.assertEqual(database.instagram_evidence.update_one.call_args.args[1]["$set"]["comments"], ["Nice song"])
