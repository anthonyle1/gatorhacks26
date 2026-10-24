
import os
import httpx

from dataclasses import dataclass
from html.parser import HTMLParser
from starlette.concurrency import run_in_threadpool

from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException

load_dotenv()

router = APIRouter(prefix="/youtube", tags=["YouTube"])

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")


@router.get("/comments/{video_id}")
async def get_youtube_comments(video_id: str):

    if not YOUTUBE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="YouTube API key is missing"
        )

    try:
        data = await run_in_threadpool(
            fetch_video_comments, video_id, YOUTUBE_API_KEY, 100, order="relevance"
        )
    except YouTubeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None

    comments = []

    for item in data.get("items", []):
        comment = item["snippet"]["topLevelComment"]
        snippet = comment["snippet"]

        comments.append({
            "comment_id": comment["id"],
            "video_id": video_id,
            "comment_text": snippet["textDisplay"],
            "like_count": snippet.get("likeCount", 0),
            "published_at": snippet["publishedAt"],
            "fetched_at": datetime.now(
                timezone.utc
            ).isoformat()
        })

    # Sort the sampled comments by likes
    comments.sort(
        key=lambda comment: comment["like_count"],
        reverse=True
    )

    # Keep only the top 10 from this sample
    top_10 = comments[:10]

    for rank, comment in enumerate(top_10, start=1):
        comment["rank"] = rank

    return {
        "video_id": video_id,
        "ranking_method": "likes_within_relevance_sample",
        "sample_size": len(comments),
        "comment_count": len(top_10),
        "comments": top_10
    }


@dataclass(frozen=True)
class Comment:
    id: str | None
    text: str


class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in {"br", "p", "div"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"p", "div"}:
            self.parts.append(" ")


def parse_comments(response: dict) -> list[Comment]:
    """Accept comments.list or commentThreads.list; deduplicate resource IDs.

    Embedded replies are included when supplied. They may be incomplete;
    use comments.list(parentId=...) to retrieve all replies separately.
    """
    if not isinstance(response, dict) or not isinstance(response.get("items"), list):
        raise ValueError("YouTube response must contain an items array.")
    comments = []
    seen = set()

    def add(resource):
        if not isinstance(resource, dict) or not isinstance(resource.get("snippet"), dict):
            raise ValueError("Each comment must contain a snippet object.")
        snippet = resource["snippet"]
        # Original text is plain text: do not strip literal angle brackets.
        text = snippet.get("textOriginal")
        if not isinstance(text, str):
            display = snippet.get("textDisplay")
            if not isinstance(display, str):
                raise ValueError("Comment snippet must contain textOriginal or textDisplay.")
            parser = _PlainText()
            parser.feed(display)
            text = "".join(parser.parts)
        text = text.strip()
        comment_id = resource.get("id")
        if comment_id is not None and not isinstance(comment_id, str):
            raise ValueError("Comment ID must be a string.")
        if not text or (comment_id and comment_id in seen):
            return
        if comment_id:
            seen.add(comment_id)
        comments.append(Comment(id=comment_id, text=text))

    for item in response["items"]:
        if not isinstance(item, dict) or not isinstance(item.get("snippet"), dict):
            raise ValueError("Each item must contain a snippet object.")
        if "topLevelComment" in item["snippet"]:
            add(item["snippet"]["topLevelComment"])
            replies = item.get("replies", {})
            if not isinstance(replies, dict) or not isinstance(replies.get("comments", []), list):
                raise ValueError("Thread replies must contain a comments array.")
            for reply in replies.get("comments", []):
                add(reply)
        else:
            add(item)
    return comments


class YouTubeError(RuntimeError):
    """An upstream failure safe to return without exposing the API key."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def fetch_video_metadata(video_id: str, api_key: str) -> dict:
    try:
        with httpx.Client(timeout=20) as client:
            response = client.get("https://www.googleapis.com/youtube/v3/videos",
                                  params={"part": "snippet", "id": video_id, "key": api_key})
            response.raise_for_status()
            items = response.json().get("items", [])
            if not items:
                raise YouTubeError("Video metadata is unavailable", status_code=404)
            snippet = items[0]["snippet"]
            return {"title": snippet.get("title", "")[:1000], "caption": snippet.get("description", "")[:16000]}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise YouTubeError("Could not fetch video metadata; check availability and API configuration") from None


def fetch_video_comments(
    video_id: str, api_key: str, max_comments: int = 100, *, order: str = "time"
) -> dict:
    """Fetch a bounded, paginated top-level sample for either API route.

    Synchronous callers run in FastAPI's thread pool; async callers must offload
    this function with run_in_threadpool.
    """
    if not 1 <= max_comments <= 1000:
        raise ValueError("max_comments must be between 1 and 1000.")
    if order not in {"time", "relevance"}:
        raise ValueError("order must be time or relevance.")
    items = []
    token = None
    seen_tokens = set()
    try:
        with httpx.Client(timeout=20) as client:
            while len(items) < max_comments:
                params = {
                    "key": api_key, "part": "snippet", "videoId": video_id,
                    "textFormat": "plainText", "order": order,
                    "maxResults": min(100, max_comments - len(items)),
                }
                if token:
                    params["pageToken"] = token
                response = client.get(
                    "https://www.googleapis.com/youtube/v3/commentThreads", params=params
                )
                response.raise_for_status()
                page = response.json()
                if not isinstance(page, dict) or not isinstance(page.get("items"), list):
                    raise YouTubeError("YouTube returned an invalid comment response.")
                items.extend(page["items"][:max_comments - len(items)])
                token = page.get("nextPageToken")
                if not token:
                    break
                if not isinstance(token, str) or token in seen_tokens:
                    raise YouTubeError("YouTube returned an invalid pagination token.")
                seen_tokens.add(token)
    except httpx.HTTPStatusError as exc:
        raise YouTubeError(
            f"YouTube returned HTTP {exc.response.status_code}. Check video availability, "
            "whether comments are enabled, and API key/quota settings.",
            status_code=exc.response.status_code,
        ) from None
    except (httpx.RequestError, ValueError):
        raise YouTubeError("Unable to retrieve YouTube comments.") from None
    return {"items": items, "nextPageToken": token}
