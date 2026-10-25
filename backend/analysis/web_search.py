"""Bounded, optional Ollama web search; the model never chooses network actions."""

import os
from app.environment import ENV_FILE
from typing import Literal
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

SEARCH_URL = "https://ollama.com/api/web_search"


class WebSource(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: str = Field(max_length=200)
    url: str = Field(max_length=2048)
    content: str = Field(max_length=1200)


class WebContext(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["disabled", "used", "no_results", "unavailable"] = "disabled"
    query: str | None = None
    sources: list[WebSource] = Field(default_factory=list, max_length=3)
    warning: str | None = None


def get_web_context(title: str, caption: str) -> WebContext:
    load_dotenv(ENV_FILE)
    if os.getenv("OLLAMA_WEB_SEARCH_ENABLED", "false").lower() != "true":
        return WebContext()
    key = os.getenv("OLLAMA_API_KEY", "").strip()
    if not key:
        return WebContext(status="unavailable", warning="Web search enabled but OLLAMA_API_KEY is missing; using video metadata only.")
    # A single application-built query, never a model-generated URL or command.
    query = " ".join(f"{title[:200]} {caption[:300]} video topic context".split())
    try:
        with httpx.Client(timeout=15, trust_env=False, follow_redirects=False) as client:
            response = client.post(SEARCH_URL, headers={"Authorization": f"Bearer {key}"},
                                   json={"query": query, "max_results": 3})
            response.raise_for_status()
            if len(response.content) > 128_000:
                raise ValueError("Search response too large")
            data = response.json()
        rows = data.get("results") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise ValueError("Invalid search response")
        sources = []
        for row in rows[:3]:
            if not isinstance(row, dict) or not all(isinstance(row.get(k), str) for k in ("title", "url", "content")):
                raise ValueError("Invalid search result")
            url = row["url"]
            parsed = urlsplit(url)
            # Returned links are displayed, never fetched; reject unsafe schemes.
            if len(url) > 2048 or parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                continue
            sources.append(WebSource(title=row["title"][:200], url=url, content=row["content"][:1200]))
        return WebContext(status="used" if sources else "no_results", query=query, sources=sources)
    except (httpx.HTTPError, ValueError):
        # Never return provider errors, request headers, or API keys to the model/UI.
        return WebContext(status="unavailable", query=query,
                          warning="Web search failed; using video metadata only. Check the API key and network connection.")
