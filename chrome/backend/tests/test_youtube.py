from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.youtube import router


def youtube_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_comments_route_shares_fetcher_and_preserves_ranking():
    items = [{"snippet": {"topLevelComment": {
        "id": f"c{i}", "snippet": {
            "textDisplay": f"comment {i}", "likeCount": i,
            "publishedAt": "2026-10-23T12:00:00Z",
        },
    }}} for i in range(12)]
    with patch("app.youtube.YOUTUBE_API_KEY", "test-key"), \
         patch("app.youtube.fetch_video_comments", return_value={"items": items}) as fetch:
        response = youtube_client().get("/youtube/comments/abcdefghijk")
    assert response.status_code == 200
    result = response.json()
    assert result["sample_size"] == 12
    assert result["comment_count"] == 10
    assert [comment["like_count"] for comment in result["comments"]] == list(range(11, 1, -1))
    assert [comment["rank"] for comment in result["comments"]] == list(range(1, 11))
    fetch.assert_called_once_with("abcdefghijk", "test-key", 100, order="relevance")


def test_shared_fetcher_handles_transport_error_without_exposing_key():
    # Exercise the route through the real shared fetcher, with only HTTP mocked.
    with patch("app.youtube.YOUTUBE_API_KEY", "secret"), \
         patch("app.youtube.httpx.Client") as client_class:
        client = client_class.return_value.__enter__.return_value
        client.get.side_effect = httpx.ConnectError("https://example.com?key=secret")
        response = youtube_client().get("/youtube/comments/abcdefghijk")
    assert response.status_code == 502
    assert "secret" not in response.text


def test_shared_fetcher_preserves_upstream_status_for_youtube_route():
    with patch("app.youtube.YOUTUBE_API_KEY", "secret"), \
         patch("app.youtube.httpx.Client") as client_class:
        request = httpx.Request("GET", "https://example.com?key=secret")
        upstream = httpx.Response(403, request=request)
        client = client_class.return_value.__enter__.return_value
        client.get.return_value = upstream
        response = youtube_client().get("/youtube/comments/abcdefghijk")
    assert response.status_code == 403
    assert "secret" not in response.text
