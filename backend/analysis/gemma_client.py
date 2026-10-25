"""Together-compatible hosted Gemma; no browsing or tools, strict local validation."""
import json
from functools import lru_cache
from threading import BoundedSemaphore
from urllib.parse import urlsplit
from time import monotonic
import httpx

from app.config import settings
from .ollama_client import OllamaError


@lru_cache(maxsize=8)
def limiter(count):
    return BoundedSemaphore(count)


class GemmaClient:
    def __init__(self):
        self.model = settings.gemma_model
        self.provider = "gemma"
        self.deadline = monotonic() + settings.gemma_timeout

    def prompt(self, prompt, system, *, response_format, max_tokens=1536, **ignored):
        endpoint = urlsplit(settings.gemma_endpoint)
        if endpoint.scheme != "https" or not endpoint.hostname or endpoint.username or endpoint.password or not settings.gemma_api_key:
            raise OllamaError("Hosted Gemma requires an HTTPS endpoint and backend API key.")
        payload = {"model": self.model, "temperature": 0, "max_tokens": max_tokens,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                   "response_format": {"type": "json_schema", "json_schema": {"name": "assessment", "schema": response_format}}}
        gate = limiter(settings.gemma_concurrency)
        if not gate.acquire(timeout=max(0, self.deadline-monotonic())):
            raise OllamaError("Hosted Gemma queue deadline exceeded.")
        try:
            with httpx.Client(timeout=settings.gemma_timeout, trust_env=False, follow_redirects=False) as client:
                # One retry for transient service errors, no unbounded rate-limit sleeps.
                for attempt in range(2):
                    remaining = self.deadline-monotonic()
                    if remaining <= 0:
                        raise OllamaError("Hosted Gemma deadline exceeded.")
                    with client.stream("POST", settings.gemma_endpoint,
                                       headers={"Authorization": "Bearer " + settings.gemma_api_key}, json=payload, timeout=remaining) as response:
                        if response.status_code in {429, 500, 502, 503, 504} and attempt == 0:
                            continue
                        response.raise_for_status()
                        data = bytearray()
                        for chunk in response.iter_bytes():
                            data.extend(chunk)
                            if monotonic() >= self.deadline:
                                raise OllamaError("Hosted Gemma deadline exceeded.")
                            if len(data) > 128_000:
                                raise OllamaError("Hosted Gemma response size exceeded.")
                    choice = json.loads(data)["choices"][0]
                    if choice.get("finish_reason") != "stop" or choice["message"].get("tool_calls"):
                        raise OllamaError("Hosted Gemma output was incomplete.")
                    return {"response": choice["message"]["content"]}
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            raise OllamaError("Hosted Gemma request failed; local evidence was retained.") from None
        finally:
            gate.release()
