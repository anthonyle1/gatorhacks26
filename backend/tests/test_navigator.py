"""Provider contract tests use UF's documented paths/model alias without real keys."""
import json
from unittest.mock import patch

import httpx
import pytest

from analysis.navigator_client import NavigatorClient
from analysis.video_assessment import assess_video
from analysis.ollama_client import OllamaError
from analysis.session_classification import classify_batch
from analysis.versions import versions
from app.config import Settings, settings


@pytest.fixture
def navigator(monkeypatch):
    for key, value in {"navigator_toolkit_api_key": "test-private-key", "navigator_base_url": "https://api.ai.it.ufl.edu/v1",
        "navigator_model": "gemma-4-31b-it", "navigator_topic_model": "", "navigator_response_format": "auto",
        "assessment_provider": "navigator", "topic_provider": "navigator"}.items():
        monkeypatch.setattr(settings, key, value)


def transport(handler):
    original = httpx.Client
    return patch("analysis.navigator_client.httpx.Client", side_effect=lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))


def answer(**updates):
    return {"negative_for_user": "no", "reason": "The metadata describes a tutorial.", "context_summary": "Growing basil",
            "content_signals": [], "evidence_references": [{"id": "title"}], **updates}


def completion(value, **updates):
    return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}, **updates}]})


def test_defaults_enable_audio_and_use_uf():
    defaults = Settings(_env_file=None)
    assert defaults.audio_enabled and defaults.audio_disable_on_failure
    assert defaults.assessment_provider == defaults.topic_provider == "navigator"
    assert defaults.navigator_model == "gemma-4-31b-it"


def test_navigator_assessment_contract(navigator):
    def handler(request):
        assert str(request.url) == "https://api.ai.it.ufl.edu/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-private-key"
        payload = json.loads(request.content)
        assert payload["model"] == "gemma-4-31b-it"
        assert payload["response_format"]["type"] == "json_schema"
        assert "test-private-key" not in request.content.decode()
        assert payload["stream"] is False
        assert "tools" not in payload and "web_search" not in payload
        assert payload["messages"][1]["role"] == "user"
        return completion(answer())
    with transport(handler):
        result = assess_video("Basil", "Gardening tutorial")
    assert result.provider == "navigator" and result.model == "gemma-4-31b-it"
    assert result.web_search.status == "disabled" and not result.fallback_used


def test_unsupported_schema_falls_back_without_weakening_validation(navigator):
    modes = []
    def handler(request):
        payload = json.loads(request.content)
        modes.append(payload["response_format"]["type"])
        if modes[-1] == "json_schema":
            return httpx.Response(400, json={"error": {"message": "response_format json_schema is not supported by this model"}})
        assert "evidence_references" in payload["messages"][0]["content"]
        return completion(answer(evidence_references=[{"id": "made-up-evidence"}]))
    with transport(handler), patch("analysis.model_output.GeminiClient") as fallback:
        with pytest.raises(OllamaError, match="invalid output"):
            assess_video("Basil", "Tutorial")
        fallback.assert_not_called()
    assert modes == ["json_schema", "json_object", "json_schema", "json_object"]


def test_plain_json_mode_compatibility_is_bounded(navigator):
    modes = []
    def handler(request):
        payload = json.loads(request.content)
        mode = payload.get("response_format", {}).get("type", "text")
        modes.append(mode)
        if mode != "text":
            return httpx.Response(422, json={"error": f"response_format {mode} unsupported"})
        return completion(answer())
    with transport(handler):
        result = assess_video("Basil", "Tutorial")
    assert result.provider == "navigator"
    assert modes == ["json_schema", "json_object", "text"]


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
def test_failures_are_sanitized_and_do_not_switch_provider(navigator, status):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": "test-private-key confidential upstream details"})
    with transport(handler), patch("analysis.model_output.GeminiClient") as fallback:
        with pytest.raises(OllamaError) as error:
            assess_video("Basil", "Tutorial")
        assert "test-private-key" not in str(error.value) and "confidential" not in str(error.value)
        fallback.assert_not_called()
    assert len(calls) == (2 if status in {429, 500} else 1)


def test_missing_key_fails_before_network(navigator, monkeypatch):
    monkeypatch.setattr(settings, "navigator_toolkit_api_key", "")
    with transport(lambda request: pytest.fail("Missing credentials must not trigger a request")):
        with pytest.raises(OllamaError, match="NAVIGATOR_TOOLKIT_API_KEY"):
            assess_video("Basil", "Tutorial")


def test_models_discovery_uses_authenticated_uf_endpoint(navigator):
    def handler(request):
        assert request.method == "GET" and str(request.url) == "https://api.ai.it.ufl.edu/v1/models"
        assert request.headers["Authorization"] == "Bearer test-private-key"
        return httpx.Response(200, json={"data": [{"id": "gemma-4-31b-it"}]})
    with transport(handler):
        assert NavigatorClient().list_models() == ["gemma-4-31b-it"]


def test_topic_discovery_uses_navigator_and_retains_hierarchy_validation(navigator):
    def handler(request):
        assert json.loads(request.content)["model"] == "gemma-4-31b-it"
        return completion({"topics": [{"key": "gardening", "name": "Gardening", "description": "Growing herbs",
            "parent_key": None, "existing_category_id": None, "video_ids": ["v1"]}], "unclassified_video_ids": []})
    with transport(handler):
        discovery, provenance = classify_batch([{"video_id": "v1", "title": "Growing basil"}], [])
    assert discovery.topics[0].video_ids == ["v1"]
    assert provenance["provider"] == "navigator"


def test_protocol_and_model_changes_invalidate_reuse(navigator, monkeypatch):
    original = versions()
    monkeypatch.setattr(settings, "navigator_response_format", "json_object")
    assert versions() != original
    monkeypatch.setattr(settings, "navigator_topic_model", "other-model")
    assert versions("topics")["model"] == "other-model"
