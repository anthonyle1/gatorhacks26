import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from analysis.ollama_client import OllamaClient, OllamaError


class OllamaTests(unittest.TestCase):
    @patch("analysis.ollama_client.load_dotenv")
    def test_default_and_environment_model_selection(self, _load_env):
        # Avoid depending on a developer's .env or modifying it during tests.
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(OllamaClient().model, "gemma4:e2b")
        with patch.dict(os.environ, {"OLLAMA_MODEL": "gemma4:e4b"}):
            self.assertEqual(OllamaClient().model, "gemma4:e4b")
            self.assertEqual(OllamaClient(model="gemma4:e2b").model, "gemma4:e2b")

    def client(self, handler):
        transport = httpx.MockTransport(handler)
        real_client = httpx.Client
        return patch("analysis.ollama_client.httpx.Client", side_effect=lambda **kwargs: real_client(transport=transport, **kwargs))

    def test_prompt_uses_requested_local_model_and_system(self):
        import json

        def handler(request):
            self.assertEqual(request.url.path, "/api/chat")
            self.assertEqual(json.loads(request.content), {
                "model": "gemma4:e2b", "stream": False,
                "messages": [{"role": "system", "content": "Be concise"},
                             {"role": "user", "content": "Hello"}],
            })
            return httpx.Response(200, json={"message": {"content": "Hi"}})

        with self.client(handler):
            result = OllamaClient(model="gemma4:e2b").prompt("Hello", "Be concise")
        self.assertEqual(result, {"model": "gemma4:e2b", "response": "Hi"})

    def test_status_requires_exact_model_tag(self):
        for name, expected in [("gemma4:e2b", True), ("gemma4:e2b-cloud", False)]:
            with self.subTest(name=name), self.client(lambda request: httpx.Response(200, json={"models": [{"name": name}]})):
                self.assertEqual(OllamaClient(model="gemma4:e2b").status()["available"], expected)

    def test_upstream_failures_are_actionable(self):
        cases = [
            (httpx.Response(404), "ollama pull gemma4:e2b"),
            (httpx.Response(500), "HTTP 500"),
            (httpx.Response(200, text="invalid"), "invalid JSON"),
            (httpx.Response(200, json={"message": {"content": ""}}), "no answer"),
            (httpx.Response(200, json=[]), "unsuccessful response"),
        ]
        for response, message in cases:
            with self.subTest(message=message), self.client(lambda request: response):
                with self.assertRaisesRegex(OllamaError, message):
                    OllamaClient(model="gemma4:e2b").prompt("Hello")

    def test_connection_and_timeout(self):
        for error, message in [(httpx.ConnectError, "Cannot connect"), (httpx.ReadTimeout, "timed out")]:
            def handler(request):
                raise error("failure", request=request)
            with self.subTest(error=error), self.client(handler):
                with self.assertRaisesRegex(OllamaError, message):
                    OllamaClient().prompt("Hello")

    def test_routes_and_validation(self):
        with patch.dict(os.environ, {"MONGODB_URI": "mongodb://localhost:27017"}):
            from analysis.routes import router

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        with patch("analysis.routes.OllamaClient") as factory:
            factory.return_value.prompt.return_value = {"model": "gemma4:e2b", "response": "Hi"}
            response = client.post("/analysis/prompt", json={"prompt": "Hello"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["response"], "Hi")
            factory.return_value.status.return_value = {"model": "gemma4:e2b", "available": True}
            self.assertTrue(client.get("/analysis/ollama/status").json()["available"])
            factory.return_value.prompt.side_effect = OllamaError("Cannot connect")
            self.assertEqual(client.post("/analysis/prompt", json={"prompt": "Hi"}).status_code, 503)
            factory.return_value.status.side_effect = OllamaError("Cannot connect")
            self.assertEqual(client.get("/analysis/ollama/status").status_code, 503)
        self.assertEqual(client.post("/analysis/prompt", json={"prompt": ""}).status_code, 422)
        self.assertEqual(client.post("/analysis/prompt", json={"prompt": "  "}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
