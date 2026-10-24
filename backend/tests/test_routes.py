import os
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Import configuration without requiring real credentials or a database connection.
with patch.dict(os.environ, {"MONGODB_URI": "mongodb://localhost:27017"}):
    from analysis.routes import router
from analysis.analyzer import ModelUnavailableError, SentimentAnalyzer
from analysis.youtube import YouTubeError


class RouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_post_parsed_comments(self):
        classifier = Mock(return_value=[[
            {"label": "negative", "score": 0.9},
            {"label": "neutral", "score": 0.08},
            {"label": "positive", "score": 0.02},
        ]])
        with patch("analysis.routes.get_analyzer", return_value=SentimentAnalyzer(classifier)):
            response = self.client.post("/analysis/comments", json={
                "youtube_response": {"items": [{"id": "c1", "snippet": {"textOriginal": "Awful"}}]},
            })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["summary"]["is_negative_reaction"])

    def test_invalid_payloads_and_threshold(self):
        for body in (
            {"youtube_response": {}},
            {"youtube_response": {"items": [{}]}},
            {"youtube_response": {"items": []}, "negative_threshold": 0},
            {"youtube_response": {"items": []}, "negative_threshold": 1.1},
        ):
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/analysis/comments", json=body).status_code, 422)

    def test_embedded_replies_cannot_exceed_limit(self):
        comment = {"snippet": {"textOriginal": "text"}}
        thread = {"snippet": {"topLevelComment": comment},
                  "replies": {"comments": [comment] * 1000}}
        response = self.client.post("/analysis/comments", json={"youtube_response": {"items": [thread]}})
        self.assertEqual(response.status_code, 422)

    def test_model_unavailable(self):
        analyzer = Mock()
        analyzer.analyze.side_effect = ModelUnavailableError("Model unavailable")
        with patch("analysis.routes.get_analyzer", return_value=analyzer):
            response = self.client.post("/analysis/comments", json={"youtube_response": {"items": []}})
        self.assertEqual(response.status_code, 503)

    def test_video_sample_metadata(self):
        with patch("analysis.routes.settings") as settings, \
             patch("analysis.routes.fetch_video_comments", return_value={"items": [], "nextPageToken": "next"}) as fetch:
            settings.youtube_api_key = "test-key"
            response = self.client.get("/analysis/videos/abcdefghijk?max_comments=123")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["summary"]["is_negative_reaction"])
        self.assertTrue(response.json()["sample"]["has_more"])
        fetch.assert_called_once_with("abcdefghijk", "test-key", 123)

    def test_missing_key_upstream_error_and_video_validation(self):
        with patch("analysis.routes.settings") as settings:
            settings.youtube_api_key = ""
            self.assertEqual(self.client.get("/analysis/videos/abcdefghijk").status_code, 503)
            settings.youtube_api_key = "test-key"
            with patch("analysis.routes.fetch_video_comments", side_effect=YouTubeError("YouTube failed")):
                self.assertEqual(self.client.get("/analysis/videos/abcdefghijk").status_code, 502)
        self.assertEqual(self.client.get("/analysis/videos/invalid").status_code, 422)
        self.assertEqual(self.client.get("/analysis/videos/abcdefghijk?max_comments=1001").status_code, 422)


if __name__ == "__main__":
    unittest.main()
