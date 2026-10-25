"""Provider contract, local API, and persistent pruning enforcement tests."""
import asyncio
import json
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from analysis.pruned_detection import Match, detect, uncertain
from analysis.session_classification import SessionDiscovery
from analysis.topic_store import TopicStore
from app.config import settings
from app.routes import detection
from app.services.local_sessions import LOCAL_USER


def proposal(key, name, parent=None, existing=None):
    return {"key": key, "name": name, "description": f"Videos about {name}",
            "parent_key": parent, "existing_category_id": existing, "video_ids": [key]}


def discover(store, nodes, user=LOCAL_USER):
    return store.apply_discovery(user, SessionDiscovery.model_validate({"topics": nodes, "unclassified_video_ids": []}))


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "")
    path = Path(__file__).resolve().parents[2] / ".cache" / f"pruned_detection_test_{uuid4().hex}.sqlite3"
    yield TopicStore(path)
    path.unlink(missing_ok=True)


def seed(store):
    assignments = discover(store, [proposal("parent", "Entertainment"),
        proposal("drama", "Celebrity Relationship Drama", "parent"),
        proposal("breakups", "Celebrity Breakups", "drama"), proposal("movies", "Movie Reviews", "parent")])
    return {key: value[0] for key, value in assignments.items()}


def test_permanent_prune_hides_subtree_persists_and_blocks_restore_and_regrowth(store):
    ids = seed(store)
    store.save_session("history", LOCAL_USER, {"assignments": {key: [value] for key, value in ids.items()}, "videos": []})
    store.set_preference(LOCAL_USER, ids["drama"], True)
    version = store.blacklist(LOCAL_USER)["version"]
    store.permanently_prune(LOCAL_USER, [ids["breakups"]], version)
    store.set_preference(LOCAL_USER, ids["drama"], False)
    restored_store = TopicStore(store.path)
    nodes = view(restored_store, {key: [value] for key, value in ids.items()})
    assert ids["breakups"] not in nodes
    assert ids["drama"] in nodes and ids["movies"] in nodes
    assert restored_store.blacklist(LOCAL_USER)["topics"][0]["permanent"] is True
    with pytest.raises(ValueError, match="cannot be restored"):
        restored_store.set_preference(LOCAL_USER, ids["breakups"], False)
    again = discover(restored_store, [proposal("again", "Celebrity Breakups", existing=ids["breakups"])])
    assert again["again"] == [ids["breakups"]]
    assert ids["breakups"] not in view(restored_store, again)


def test_permanent_prune_rejects_stale_unpruned_or_other_user_targets_atomically(store):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    version = store.blacklist(LOCAL_USER)["version"]
    with pytest.raises(ValueError, match="Topics changed"):
        store.permanently_prune(LOCAL_USER, [ids["drama"]], "old-version")
    with pytest.raises(ValueError, match="currently in the compost"):
        store.permanently_prune(LOCAL_USER, [ids["drama"], ids["movies"]], version)
    with pytest.raises(ValueError):
        store.permanently_prune("other-user", [ids["drama"]], store.blacklist("other-user")["version"])
    assert store.blacklist(LOCAL_USER)["version"] == version
    assert not store.blacklist(LOCAL_USER)["topics"][0]["permanent"]


def test_permanent_prune_endpoint_requires_confirmation(store, monkeypatch):
    from app.routes import local_sessions
    from app.services.local_sessions import LocalSessions
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    jobs = LocalSessions(store)
    monkeypatch.setattr(local_sessions, "LocalSessions", lambda: jobs)
    app = FastAPI(); app.include_router(local_sessions.router)
    client = TestClient(app)
    body = {"category_ids": [ids["drama"]], "blacklist_version": store.blacklist(LOCAL_USER)["version"], "confirmed": False}
    assert client.request("DELETE", "/local-sessions/taxonomy/compost", json=body).status_code == 422
    body["confirmed"] = True
    response = client.request("DELETE", "/local-sessions/taxonomy/compost", json=body)
    assert response.status_code == 200
    assert ids["breakups"] in response.json()["deleted_ids"]


def view(store, assignments):
    store.save_session("s", LOCAL_USER, {"assignments": assignments, "videos": []})
    tree = store.view("s", LOCAL_USER)["tree"]
    def flatten(nodes):
        return [node for root in nodes for node in [root, *flatten(root["children"])]]
    return {node["id"]: node for node in flatten(tree)}


def test_parent_child_scope_version_and_user_ownership(store):
    ids = seed(store)
    initial = store.blacklist(LOCAL_USER)["version"]
    store.set_preference(LOCAL_USER, ids["drama"], True)
    state = store.blacklist(LOCAL_USER)
    assert state["version"] != initial
    assert [topic["id"] for topic in state["topics"]] == [ids["drama"]]
    assert state["topics"][0]["descendants"][0]["id"] == ids["breakups"]
    nodes = view(store, {key: [value] for key, value in ids.items()})
    assert nodes[ids["breakups"]]["reduce"]
    assert not nodes[ids["movies"]]["reduce"] and not nodes[ids["parent"]]["reduce"]
    assert store.blacklist("someone_else")["topics"] == []
    with pytest.raises(ValueError):
        store.set_preference("someone_else", ids["drama"], True)
    store.set_preference(LOCAL_USER, ids["drama"], False)
    assert store.blacklist(LOCAL_USER)["version"] == initial


def test_semantic_equivalent_reuses_pruned_identity(store, monkeypatch):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    monkeypatch.setattr("analysis.pruned_detection.category_guard", lambda *_: Match(
        status="MATCH", matched_topic_id=ids["drama"], confidence=0.95, reason="Same subject."))
    result = discover(store, [proposal("rumors", "Famous Couples Dating Rumors")])
    assert result["rumors"] == [ids["drama"]]
    assert view(store, result)[ids["drama"]]["reduce"]


def test_semantic_unavailable_defers_new_topic_and_restore_releases_it(store):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    result = discover(store, [proposal("unknown", "Renamed Relationship Speculation")])
    new_id = result["unknown"][0]
    assert view(store, result)[new_id]["reduce"]
    store.set_preference(LOCAL_USER, ids["drama"], False)
    assert not view(store, result)[new_id]["reduce"]


def test_broader_topic_remains_visible_after_supported_no_match(store, monkeypatch):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    monkeypatch.setattr("analysis.pruned_detection.category_guard", lambda *_: Match(
        status="NO_MATCH", matched_topic_id=None, confidence=0.96, reason="Broader general culture."))
    result = discover(store, [proposal("culture", "Popular Culture")])
    assert not view(store, result)[result["culture"][0]]["reduce"]


def test_exact_pruned_name_cannot_reappear_at_another_parent(store):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    assert discover(store, [proposal("again", "Celebrity Relationship Drama")])["again"] == [ids["drama"]]


def test_reset_clears_guards_and_preferences(store):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    discover(store, [proposal("new", "Possible Duplicate")])
    store.reset_tree(LOCAL_USER)
    assert store.blacklist(LOCAL_USER)["topics"] == []
    with store.connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM category_guards").fetchone()[0] == 0


def test_outage_preserves_existing_broader_and_sibling_topics(store):
    ids = seed(store)
    store.set_preference(LOCAL_USER, ids["drama"], True)
    result = discover(store, [proposal("parent", "Entertainment", existing=ids["parent"]),
                             proposal("movies", "Movie Reviews", "parent", existing=ids["movies"])])
    nodes = view(store, result)
    assert not nodes[ids["parent"]]["reduce"]
    assert not nodes[ids["movies"]]["reduce"]
    assert nodes[ids["drama"]]["reduce"]


def test_reused_existing_semantic_duplicate_is_suppressed(store, monkeypatch):
    ids = seed(store)
    old = discover(store, [proposal("rumors", "Famous Couples Rumors")])["rumors"][0]
    store.set_preference(LOCAL_USER, ids["drama"], True)
    monkeypatch.setattr("analysis.pruned_detection.category_guard", lambda *_: Match(
        status="MATCH", matched_topic_id=ids["drama"], confidence=0.95, reason="Equivalent topic."))
    result = discover(store, [proposal("rumors", "Famous Couples Rumors", existing=old)])
    nodes = view(store, result)
    assert result["rumors"] == [ids["drama"]]
    assert nodes[old]["reduce"]


@pytest.mark.parametrize("content,code,expected", [
    ({"status": "MATCH", "matched_topic_id": "topic", "confidence": 0.91, "reason": "Video concerns breakup rumors."}, 200, "MATCH"),
    ({"status": "NO_MATCH", "matched_topic_id": None, "confidence": 0.91, "reason": "Unrelated movie review."}, 200, "NO_MATCH"),
    ({"status": "UNCERTAIN", "matched_topic_id": None, "confidence": 0.2, "reason": "Ambiguous evidence."}, 200, "UNCERTAIN"),
    ({"status": "MATCH", "matched_topic_id": "invented", "confidence": 0.99, "reason": "Wrong ID."}, 200, "UNCERTAIN"),
    ({"status": "NO_MATCH", "matched_topic_id": "topic", "confidence": 0.9, "reason": "Inconsistent."}, 200, "UNCERTAIN"),
    ({"status": "MATCH", "matched_topic_id": "topic", "confidence": 2.0, "reason": "Invalid."}, 200, "UNCERTAIN"),
    ({"bad": "schema"}, 200, "UNCERTAIN"),
    ({}, 429, "UNCERTAIN"),
    ({}, 503, "UNCERTAIN"),
])
def test_groq_contract_and_failures(monkeypatch, content, code, expected):
    monkeypatch.setattr(settings, "groq_api_key", "test-secret")
    original = httpx.AsyncClient
    requests = []
    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.url.host == "api.groq.com"
        assert body["model"] == "openai/gpt-oss-20b"
        assert body["response_format"]["json_schema"]["strict"]
        nullable = body["response_format"]["json_schema"]["schema"]["properties"]["matched_topic_id"]
        assert nullable == {"type": ["string", "null"], "enum": [None, "topic"]}
        assert "test-secret" not in request.content.decode()
        return httpx.Response(code, json={"choices": [{"message": {"content": json.dumps(content)}}]})
    monkeypatch.setattr("analysis.pruned_detection.httpx.AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    result = asyncio.run(detect({"title": "Breakup rumors", "caption": "", "comments": []}, [{"id": "topic"}]))
    assert result.status == expected and len(requests) == 1


def test_provider_timeout_and_comment_only_evidence(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "test")
    mocked_post = AsyncMock(side_effect=httpx.ReadTimeout("deadline"))
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        post = mocked_post
    monkeypatch.setattr("analysis.pruned_detection.httpx.AsyncClient", lambda **_: Client())
    assert asyncio.run(detect({"title": "Video", "caption": ""}, [{"id": "topic"}])).status == "UNCERTAIN"
    mocked_post.reset_mock()
    assert asyncio.run(detect({"title": "", "caption": "", "comments": ["celebrity drama"]}, [{"id": "topic"}])).status == "UNCERTAIN"
    mocked_post.assert_not_called()


def test_provider_diagnostics_exclude_raw_evidence_and_secrets(caplog):
    from analysis.pruned_detection import validated
    response = httpx.Response(400, request=httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions"), json={
        "error": {"code": "json_validate_failed", "message": "private submitted video title", "failed_generation": "secret raw comment"}})
    with pytest.raises(httpx.HTTPStatusError):
        validated(response, [{"id": "topic"}])
    assert "http_status=400 code=json_validate_failed" in caplog.text
    assert "private submitted" not in caplog.text and "secret raw" not in caplog.text


@pytest.fixture
def api(store, monkeypatch):
    monkeypatch.setattr(detection, "TopicStore", lambda: store)
    app = FastAPI(); app.include_router(detection.router)
    return TestClient(app)


def body(store):
    return {"platform": "instagram", "video_id": "clip", "request_id": "request-a",
            "blacklist_version": store.blacklist(LOCAL_USER)["version"], "title": "Breakup rumors"}


@pytest.mark.parametrize("status,confidence,notify", [("MATCH", 0.91, True), ("MATCH", 0.8, False), ("UNCERTAIN", 0.4, False), ("NO_MATCH", 0.9, False)])
def test_endpoint_notification_eligibility(api, store, monkeypatch, status, confidence, notify):
    ids = seed(store); store.set_preference(LOCAL_USER, ids["drama"], True)
    matcher = AsyncMock(return_value=Match(status=status, matched_topic_id=ids["drama"] if status == "MATCH" else None,
                                           confidence=confidence, reason="Evidence-based result."))
    monkeypatch.setattr(detection, "detect", matcher)
    result = api.post("/detection/check", json=body(store))
    assert result.status_code == 200
    assert result.json()["notify"] is notify
    assert result.json()["provider"] == "groq"
    assert result.json()["request_id"] == "request-a"


def test_blacklist_change_during_inference_and_stale_request(api, store, monkeypatch):
    ids = seed(store); store.set_preference(LOCAL_USER, ids["drama"], True)
    request = body(store)
    async def restore(*_):
        store.set_preference(LOCAL_USER, ids["drama"], False)
        return Match(status="MATCH", matched_topic_id=ids["drama"], confidence=0.99, reason="Old match.")
    monkeypatch.setattr(detection, "detect", restore)
    result = api.post("/detection/check", json=request).json()
    assert result["status"] == "UNCERTAIN" and not result["notify"]
    matcher = AsyncMock(return_value=uncertain())
    monkeypatch.setattr(detection, "detect", matcher)
    assert not api.post("/detection/check", json=request).json()["notify"]
    matcher.assert_not_called()


def test_input_limits_and_no_client_user_override(api, store):
    for change in [{"user_id": "someone_else"}, {"comments": ["x"] * 11}, {"title": "x" * 1001}, {"video_id": "bad/path"}]:
        assert api.post("/detection/check", json={**body(store), **change}).status_code == 422
    assert api.get("/detection/state").json()["configured"] is False


def test_comment_deadline_does_not_block(monkeypatch):
    monkeypatch.setattr(settings, "youtube_api_key", "test")
    monkeypatch.setattr(settings, "detection_comment_timeout_seconds", 0.01)
    async def delayed(*_, **__):
        await asyncio.sleep(1)
    monkeypatch.setattr(detection, "run_in_threadpool", delayed)
    assert asyncio.run(detection.youtube_comments("clip")) == []
