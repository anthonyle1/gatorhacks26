"""Parse YouTube comment resources and fetch bounded top-level samples."""

import json
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen


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
    """An upstream failure with a message safe to return without the API key."""


def fetch_video_comments(video_id: str, api_key: str, max_comments: int = 100) -> dict:
    """Fetch up to max_comments newest top-level comments with pagination."""
    if not 1 <= max_comments <= 1000:
        raise ValueError("max_comments must be between 1 and 1000.")
    items = []
    token = None
    seen_tokens = set()
    while len(items) < max_comments:
        params = {
            "key": api_key, "part": "snippet", "videoId": video_id,
            "textFormat": "plainText", "order": "time",
            "maxResults": min(100, max_comments - len(items)),
        }
        if token:
            params["pageToken"] = token
        try:
            with urlopen(
                "https://www.googleapis.com/youtube/v3/commentThreads?" + urlencode(params),
                timeout=20,
            ) as response:
                page = json.load(response)
        except HTTPError as exc:
            # Do not return the exception URL, which contains the API key.
            raise YouTubeError(
                f"YouTube returned HTTP {exc.code}. Check video availability, "
                "whether comments are enabled, and API key/quota settings."
            ) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise YouTubeError("Unable to retrieve YouTube comments.") from None
        if not isinstance(page, dict) or not isinstance(page.get("items"), list):
            raise YouTubeError("YouTube returned an invalid comment response.")
        items.extend(page["items"][:max_comments - len(items)])
        token = page.get("nextPageToken")
        if not token:
            break
        if not isinstance(token, str) or token in seen_tokens:
            raise YouTubeError("YouTube returned an invalid pagination token.")
        seen_tokens.add(token)
    return {"items": items, "nextPageToken": token}
