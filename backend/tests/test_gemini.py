import json
import os
import unittest
from unittest.mock import patch

import httpx

from analysis.gemini_client import GeminiClient, GeminiError, _gemini_schema
from analysis.video_assessment import VideoAssessment


class GeminiTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"GEMINI_FALLBACK_ENABLED": "true", "GEMINI_API_KEY": "test-secret",
                                     "GEMINI_MODEL": "gemini-3.8-flash", "GEMINI_TIMEOUT": "60"})
        env.start()
        self.addCleanup(env.stop)
        loader = patch("analysis.gemini_client.load_dotenv")
        loader.start()
        self.addCleanup(loader.stop)

    def transport(self, handler):
        original_client = httpx.Client
        transport = httpx.MockTransport(handler)
        return patch("analysis.gemini_client.httpx.Client", side_effect=lambda **kwargs: original_client(transport=transport, **kwargs))

    def test_request_uses_key_header_json_schema_and_no_tools(self):
        def handler(request):
            self.assertEqual(str(request.url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent")
            self.assertEqual(request.headers["x-goog-api-key"], "test-secret")
            payload = json.loads(request.content)
            self.assertNotIn("test-secret", json.dumps(payload))
            self.assertEqual(payload["systemInstruction"]["parts"][0]["text"], "Fixed rules")
            self.assertEqual(payload["contents"][0]["parts"][0]["text"], "Untrusted data")
            self.assertEqual(payload["generationConfig"]["responseMimeType"], "application/json")
            self.assertEqual(payload["generationConfig"]["thinkingConfig"]["thinkingLevel"], "low")
            schema = payload["generationConfig"]["responseJsonSchema"]
            self.assertNotIn("$ref", json.dumps(schema))
            self.assertNotIn("uniqueItems", json.dumps(schema))
            self.assertIn("music.kpop", json.dumps(schema))
            self.assertNotIn("tools", payload)
            return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"text": "not public", "thought": True}, {"text": '{"answer":"ok"}'},
            ]}}]})
        with self.transport(handler):
            answer = GeminiClient().prompt("Untrusted data", "Fixed rules", VideoAssessment.model_json_schema())
        self.assertEqual(answer, '{"answer":"ok"}')

    def test_missing_key_and_disabled_fallback_never_make_network_request(self):
        for changes in ({"GEMINI_API_KEY": ""}, {"GEMINI_FALLBACK_ENABLED": "false"}):
            with patch.dict(os.environ, changes), patch("analysis.gemini_client.httpx.Client") as client:
                with self.assertRaises(GeminiError):
                    GeminiClient().prompt("data", "rules", {})
                client.assert_not_called()

    def test_auth_quota_malformed_and_truncated_responses_are_sanitized(self):
        cases = [
            (401, {"error": "test-secret"}, "authentication"),
            (429, {"error": "test-secret"}, "quota"),
            (500, {"error": "test-secret"}, "HTTP 500"),
            (503, {"error": "test-secret"}, "Gemini service temporarily unavailable"),
            (200, {}, "no usable assessment"),
            (200, {"candidates": [{"finishReason": "MAX_TOKENS"}]}, "did not complete"),
            (200, {"candidates": [{"finishReason": "STOP", "content": {"parts": []}}]}, "no answer text"),
        ]
        for status, body, message in cases:
            with self.subTest(status=status, body=body), self.transport(lambda request: httpx.Response(status, json=body)):
                with self.assertRaisesRegex(GeminiError, message) as error:
                    GeminiClient().prompt("data", "rules", {})
                self.assertNotIn("test-secret", str(error.exception))

    def test_schema_conversion_preserves_a_property_named_title(self):
        schema = {"type": "object", "title": "Metadata", "properties": {"title": {"type": "string", "title": "Title"}}}
        self.assertEqual(_gemini_schema(schema)["properties"]["title"], {"type": "string"})

    def test_configuration_and_network_failures(self):
        for changes in ({"GEMINI_TIMEOUT": "nan"}, {"GEMINI_TIMEOUT": "invalid"}, {"GEMINI_MODEL": "https://example.org"}):
            with patch.dict(os.environ, changes), self.assertRaises(GeminiError):
                GeminiClient()
        for error_class in (httpx.ConnectError, httpx.ReadTimeout):
            def handler(request):
                raise error_class("test-secret", request=request)
            with self.subTest(error=error_class), self.transport(handler):
                with self.assertRaises(GeminiError) as error:
                    GeminiClient().prompt("data", "rules", {})
                self.assertNotIn("test-secret", str(error.exception))
