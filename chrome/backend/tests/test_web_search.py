import os
import unittest
from unittest.mock import patch

import httpx

from analysis.web_search import SEARCH_URL, get_web_context


class WebSearchTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"OLLAMA_WEB_SEARCH_ENABLED": "true", "OLLAMA_API_KEY": "test-secret"})
        env.start()
        self.addCleanup(env.stop)
        loader = patch("analysis.web_search.load_dotenv")
        loader.start()
        self.addCleanup(loader.stop)

    def test_disabled_or_missing_key_never_makes_request(self):
        for changes, status in [({"OLLAMA_WEB_SEARCH_ENABLED": "false"}, "disabled"), ({"OLLAMA_API_KEY": ""}, "unavailable")]:
            with patch.dict(os.environ, changes), patch("analysis.web_search.httpx.Client") as client:
                self.assertEqual(get_web_context("Title", "Caption").status, status)
                client.assert_not_called()

    def test_search_is_bounded_and_does_not_follow_result_urls(self):
        with patch("analysis.web_search.httpx.Client") as factory:
            response = httpx.Response(200, json={"results": [
                {"title": "Plants", "url": "https://example.org/plants", "content": "x" * 2000},
                {"title": "Unsafe", "url": "javascript:alert(1)", "content": "bad"},
            ]}, request=httpx.Request("POST", SEARCH_URL))
            client = factory.return_value.__enter__.return_value
            client.post.return_value = response
            result = get_web_context("t" * 1000, "c" * 16000)
            self.assertEqual(result.status, "used")
            self.assertEqual(len(result.sources), 1)
            self.assertEqual(len(result.sources[0].content), 1200)
            client.post.assert_called_once()
            args, kwargs = client.post.call_args
            self.assertEqual(args, (SEARCH_URL,))
            self.assertEqual(kwargs["json"]["max_results"], 3)
            self.assertLess(len(kwargs["json"]["query"]), 550)
            self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-secret")
            client.get.assert_not_called()
            self.assertFalse(factory.call_args.kwargs["follow_redirects"])

    def test_failures_and_malformed_responses_fall_back_without_secrets(self):
        for status, body in [(401, {}), (429, {}), (500, {}), (200, {}), (200, {"results": [None]})]:
            with self.subTest(status=status, body=body), patch("analysis.web_search.httpx.Client") as factory:
                factory.return_value.__enter__.return_value.post.return_value = httpx.Response(status, json=body, request=httpx.Request("POST", SEARCH_URL))
                context = get_web_context("Title", "Caption")
                self.assertEqual(context.status, "unavailable")
                self.assertNotIn("test-secret", context.model_dump_json())
        with patch("analysis.web_search.httpx.Client") as factory:
            factory.return_value.__enter__.return_value.post.side_effect = httpx.ReadTimeout("test-secret")
            context = get_web_context("Title", "Caption")
            self.assertEqual(context.status, "unavailable")
            self.assertNotIn("test-secret", context.model_dump_json())

    def test_empty_results_are_distinct_from_search_failure(self):
        with patch("analysis.web_search.httpx.Client") as factory:
            factory.return_value.__enter__.return_value.post.return_value = httpx.Response(200, json={"results": []}, request=httpx.Request("POST", SEARCH_URL))
            self.assertEqual(get_web_context("Title", "Caption").status, "no_results")
