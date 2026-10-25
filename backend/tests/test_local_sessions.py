import asyncio
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from analysis.topic_store import TopicStore
from analysis.session_classification import validate_discovery
from analysis.video_assessment import AssessmentResult
from analysis.ollama_client import OllamaError
from app.routes.local_sessions import router
from app.services.local_sessions import LocalSessions, LOCAL_USER, process_local_session, aggregate


def event(source="clip1", platform="instagram", event_id="event1"):
    return {"event_id": event_id, "video_id": source, "platform": platform, "title": "React components tutorial",
            "caption": "Building a web application with React", "sequence_number": 1,
            "started_at": "2026-10-24T12:00:00Z", "ended_at": "2026-10-24T12:00:02Z", "dwell_seconds": 2}


def discovered(videos, catalog, **kwargs):
    ids = [video["video_id"] for video in videos]
    result = validate_discovery({"topics": [{"key": "react", "name": "React Tutorials", "description": "React web development tutorials",
        "parent_key": None, "existing_category_id": None, "video_ids": ids}], "unclassified_video_ids": []}, set(ids), set())
    return result, {"provider": "ollama", "model": "gemma4:e2b", "fallback_used": False}


class LocalReviewTests(unittest.TestCase):
    def setUp(self):
        directory = Path(__file__).resolve().parents[2] / ".cache"
        directory.mkdir(exist_ok=True)
        self.path = directory / f"local_review_test_{uuid4().hex}.sqlite3"
        self.jobs = LocalSessions(TopicStore(self.path))
        self.addCleanup(lambda: self.path.unlink(missing_ok=True))
        self.session_id = str(uuid4())
        app = FastAPI(); app.include_router(router)
        self.client = TestClient(app)

    def test_finish_and_poll_are_independent_of_mongodb_and_idempotent(self):
        body = {"events": [event()], "instagram": []}
        with patch("app.routes.local_sessions.LocalSessions", return_value=self.jobs), patch("app.routes.local_sessions.process_local_session", new_callable=AsyncMock), patch("app.database.db", object()):
            response = self.client.post(f"/local-sessions/{self.session_id}/finish", json=body)
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["storage"], "local")
            self.assertEqual(self.client.post(f"/local-sessions/{self.session_id}/finish", json=body).status_code, 202)
            self.assertEqual(self.client.get(f"/local-sessions/{self.session_id}/taxonomy").json()["video_count"], 1)
            body["events"][0]["title"] = "Changed snapshot"
            self.assertEqual(self.client.post(f"/local-sessions/{self.session_id}/finish", json=body).status_code, 409)
            self.assertEqual(self.client.get("/local-sessions/health").json()["mongodb_required"], False)

    def test_global_tree_and_pruning_include_descendants_and_restore(self):
        def topic(key, parent=None, videos=None):
            return {"key": key.lower(), "name": key, "description": f"Topics about {key}",
                    "parent_key": parent.lower() if parent else None, "existing_category_id": None, "video_ids": videos or []}

        result = validate_discovery({"topics": [topic("Technology"), topic("Programming", "Technology"),
            topic("React", "Programming", ["youtube:a"]), topic("Cooking", videos=["youtube:b"])],
            "unclassified_video_ids": []}, {"youtube:a", "youtube:b"}, set())
        assignments = self.jobs.store.apply_discovery(LOCAL_USER, result)
        self.jobs.store.save_session(self.session_id, LOCAL_USER, {"assignments": assignments,
            "videos": [{"video_id": video_id} for video_id in assignments]})
        with patch("app.routes.local_sessions.LocalSessions", return_value=self.jobs):
            response = self.client.get("/local-sessions/taxonomy")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["global_video_count"], 2)
            roots = response.json()["tree"]
            tech = next(node for node in roots if node["name"] == "Technology")
            cooking = next(node for node in roots if node["name"] == "Cooking")
            body = {"category_id": tech["id"], "reduce": True}
            response = self.client.patch("/local-sessions/taxonomy/preferences", json=body)
            self.assertEqual(response.status_code, 200)
            saved = self.client.get("/local-sessions/taxonomy").json()
            tech = next(node for node in saved["tree"] if node["id"] == tech["id"])
            self.assertTrue(tech["selected"])
            self.assertTrue(tech["children"][0]["reduce"])
            self.assertTrue(tech["children"][0]["children"][0]["reduce"])
            self.assertFalse(next(node for node in saved["tree"] if node["id"] == cooking["id"])["reduce"])
            body["reduce"] = False
            restored = self.client.patch("/local-sessions/taxonomy/preferences", json=body).json()
            self.assertEqual(restored["reduce_video_ids"], [])
            self.assertEqual(restored["global_video_count"], 2)
            self.assertEqual(self.client.patch("/local-sessions/taxonomy/preferences",
                json={"category_id": "missing", "reduce": True}).status_code, 404)

    def test_empty_global_tree_needs_no_session(self):
        with patch("app.routes.local_sessions.LocalSessions", return_value=self.jobs):
            response = self.client.get("/local-sessions/taxonomy")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tree"], [])
        self.assertEqual(response.json()["global_video_count"], 0)

    def test_duplicate_events_are_rejected_before_processing(self):
        with patch("app.routes.local_sessions.LocalSessions", return_value=self.jobs):
            response = self.client.post(f"/local-sessions/{self.session_id}/finish", json={"events": [event(), event()]})
        self.assertEqual(response.status_code, 422)
        self.assertIsNone(self.jobs.get(self.session_id))

    def test_reset_endpoint_keeps_video_analyses_and_clears_saved_tree(self):
        self.model_patches()
        self.jobs.enqueue(self.session_id, {"events": [event()], "instagram": []})
        asyncio.run(process_local_session(self.session_id, self.jobs))
        with patch("app.routes.local_sessions.LocalSessions", return_value=self.jobs):
            response = self.client.delete("/local-sessions/taxonomy")
        self.assertEqual(response.status_code, 200)
        review = self.jobs.view(self.session_id)
        self.assertEqual(review["tree"], [])
        self.assertEqual(review["assignments"], {})
        self.assertEqual(len(review["videos"]), 1)
        self.assertIn("assessment", review["videos"][0]["analysis"])

    def test_reset_is_rejected_while_a_job_could_repopulate_tree(self):
        self.jobs.enqueue(self.session_id, {"events": [event()], "instagram": []})
        with patch("app.routes.local_sessions.LocalSessions", return_value=self.jobs):
            self.assertEqual(self.client.delete("/local-sessions/taxonomy").status_code, 409)
            self.jobs.claim(self.session_id)
            self.assertEqual(self.client.delete("/local-sessions/taxonomy").status_code, 409)

    def test_aggregation_preserves_platform_identity_and_repeat_view_duration(self):
        videos = aggregate({"events": [event(), event(event_id="event2"), event(platform="youtube", event_id="event3")], "instagram": []})
        self.assertEqual(len(videos), 2)
        self.assertEqual(videos[0]["video_id"], "instagram:clip1")
        self.assertEqual(videos[0]["dwell_seconds"], 4)
        self.assertEqual(videos[0]["watch_count"], 2)
        self.assertEqual(videos[1]["video_id"], "youtube:clip1")

    def model_patches(self):
        analyzer = patch("app.services.local_sessions.get_analyzer").start()
        self.addCleanup(patch.stopall)
        analyzer.return_value.analyze.return_value = {"summary": {"total_comments": 1, "sentiment_balance": 1,
            "counts": {"positive": 1, "negative": 0, "neutral": 0}}, "comments": [{"text": "Helpful!", "sentiment": "positive", "confidence": .9}]}
        assessment = patch("app.services.local_sessions.assess_video").start()
        assessment.return_value = AssessmentResult(negative_for_user="no", reason="Educational material", context_summary="A React tutorial",
            content_signals=[], provider="gemini", fallback_used=True, model="configured-gemini")
        classify = patch("analysis.session_review.classify_batch", side_effect=discovered).start()
        return assessment, classify

    def test_completed_review_contains_tree_individual_analysis_and_fallback_flag(self):
        assessment, classify = self.model_patches()
        self.jobs.enqueue(self.session_id, {"events": [event()], "instagram": [{"video_id": "clip1", "comments": ["Helpful!"]}]})
        with patch("app.database.db", object()):
            asyncio.run(process_local_session(self.session_id, self.jobs))
        result = LocalSessions(TopicStore(self.path)).view(self.session_id)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["tree"][0]["video_ids"], ["instagram:clip1"])
        self.assertEqual(result["videos"][0]["analysis"]["assessment"]["negative_for_user"], "no")
        self.assertEqual(result["videos"][0]["analysis"]["sentiment"]["counts"]["positive"], 1)
        self.assertTrue(result["fallback_used"])
        self.assertEqual(result["analyzed_count"], 1)
        assessment.assert_called_once()
        classify.assert_called_once()

    def test_failed_content_assessment_keeps_video_results_and_still_builds_tree(self):
        assessment, classify = self.model_patches()
        assessment.side_effect = OllamaError("Unavailable")
        self.jobs.enqueue(self.session_id, {"events": [event()], "instagram": []})
        asyncio.run(process_local_session(self.session_id, self.jobs))
        result = self.jobs.view(self.session_id)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["tree"]), 1)
        self.assertNotIn("assessment", result["videos"][0]["analysis"])
        self.assertTrue(result["videos"][0]["analysis"]["errors"])
        self.assertTrue(self.jobs.retry(self.session_id))
        assessment.side_effect = None
        asyncio.run(process_local_session(self.session_id, self.jobs))
        self.assertEqual(self.jobs.view(self.session_id)["status"], "complete")
        self.assertEqual(classify.call_count, 2, "The newly available context summary changes the classification evidence")

    def test_late_heartbeat_cannot_overwrite_a_completed_job(self):
        self.jobs.enqueue(self.session_id, {"events": [], "instagram": []})
        job, token = self.jobs.claim(self.session_id)
        self.jobs.update(self.session_id, token, status="complete")
        self.jobs.update(self.session_id, token)
        self.assertEqual(self.jobs.get(self.session_id)["status"], "complete")

    def test_new_pending_session_retains_previous_tree_and_video_links(self):
        self.model_patches()
        self.jobs.enqueue(self.session_id, {"events": [event()], "instagram": []})
        asyncio.run(process_local_session(self.session_id, self.jobs))
        next_id = str(uuid4())
        self.jobs.enqueue(next_id, {"events": [event(source="clip2")], "instagram": []})
        pending = LocalSessions(TopicStore(self.path)).view(next_id)
        self.assertEqual(pending["status"], "pending")
        self.assertEqual(pending["tree"][0]["video_ids"], ["instagram:clip1"])
        self.assertEqual(pending["tree_videos"][0]["source_id"], "clip1")
        self.assertEqual(pending["videos"], [])
        asyncio.run(process_local_session(next_id, self.jobs))
        complete = self.jobs.view(next_id)
        self.assertEqual(complete["global_video_count"], 2)
        self.assertEqual(len(complete["tree"]), 1)
        self.assertEqual(complete["tree"][0]["video_count"], 2)
        self.assertEqual(len(complete["videos"]), 1)


    def test_one_video_exception_preserves_all_video_classifications(self):
        self.model_patches()
        self.jobs.enqueue(self.session_id, {"events": [event(), event(source="clip2", event_id="event2")], "instagram": []})
        def analyze(video, previous=None, **kwargs):
            if video["source_id"] == "clip1":
                raise RuntimeError("Private provider details")
            video["analysis"] = {"status": "complete", "sentiment": None, "comments": [], "errors": []}
            return video
        with patch("app.services.local_sessions.analyze_video", side_effect=analyze):
            asyncio.run(process_local_session(self.session_id, self.jobs))
        result = self.jobs.view(self.session_id)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["videos"]), 2)
        self.assertEqual(set(result["assignments"]), {"instagram:clip1", "instagram:clip2"})
        self.assertNotIn("Private provider details", str(result))
