"""UF NaviGator chat completions. Credentials and all requests stay server-side."""
import argparse
import json
from time import monotonic
from urllib.parse import urlsplit

import httpx

from app.config import settings
from .gemma_client import limiter
from .ollama_client import OllamaError


class NavigatorClient:
    provider = "navigator"

    def __init__(self, *, stage="assessment"):
        self.model = (settings.navigator_topic_model or settings.navigator_model) if stage == "topics" else settings.navigator_model
        self.base_url = settings.navigator_base_url.rstrip("/")
        endpoint = urlsplit(self.base_url)
        if endpoint.scheme != "https" or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
            raise OllamaError("NAVIGATOR_BASE_URL must be an HTTPS API base URL without credentials, query or fragment.")
        self.deadline = monotonic() + settings.navigator_timeout

    def _headers(self):
        if not settings.navigator_toolkit_api_key.strip():
            raise OllamaError("NaviGator requires NAVIGATOR_TOOLKIT_API_KEY in the repository-root .env.")
        return {"Authorization": "Bearer " + settings.navigator_toolkit_api_key.strip(), "Content-Type": "application/json"}

    def _request(self, client, method, path, **kwargs):
        remaining = self.deadline - monotonic()
        if remaining <= 0:
            raise OllamaError("NaviGator request deadline exceeded.")
        with client.stream(method, self.base_url + path, headers=self._headers(), timeout=remaining, **kwargs) as response:
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw) > 128_000 or monotonic() >= self.deadline:
                    raise OllamaError("NaviGator response exceeded its size or time limit.")
            return response.status_code, bytes(raw)

    @staticmethod
    def _error(status):
        if status in {401, 403}:
            return OllamaError("NaviGator authentication or model access failed; check your Toolkit key and allowed models.")
        if status == 404:
            return OllamaError("NaviGator model or endpoint was not found; check NAVIGATOR_MODEL and NAVIGATOR_BASE_URL.")
        if status == 429:
            return OllamaError("NaviGator rate limit or quota reached; retry later.")
        return OllamaError(f"NaviGator request failed (HTTP {status}); local evidence was retained.")

    @staticmethod
    def _unsupported_format(status, raw):
        if status not in {400, 422}:
            return False
        # Inspect only to select protocol compatibility; never expose provider bodies.
        message = raw.decode("utf-8", errors="replace").casefold()
        return any(word in message for word in ("response_format", "json_schema", "json_object", "structured output")) and any(
            word in message for word in ("unsupported", "not supported", "not support", "not available", "not implemented", "unknown", "unrecognized"))

    def prompt(self, prompt, system, *, response_format, max_tokens=1536, **ignored):
        mode = settings.navigator_response_format
        mode = "json_schema" if mode == "auto" else mode
        instruction = system + "\nReturn only JSON matching this application schema:\n" + json.dumps(response_format, ensure_ascii=True)
        payload = {"model": self.model, "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": prompt}],
                   "temperature": 0, "max_tokens": max_tokens, "stream": False}
        gate = limiter(settings.navigator_concurrency)
        if not gate.acquire(timeout=max(0, self.deadline-monotonic())):
            raise OllamaError("NaviGator queue deadline exceeded.")
        try:
            with httpx.Client(trust_env=False, follow_redirects=False) as client:
                transient_retry = False
                for _ in range(4):
                    if mode == "json_schema":
                        payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "analysis_result", "schema": response_format}}
                    elif mode == "json_object":
                        payload["response_format"] = {"type": "json_object"}
                    else:
                        payload.pop("response_format", None)
                    status, raw = self._request(client, "POST", "/chat/completions", json=payload)
                    if settings.navigator_response_format == "auto" and self._unsupported_format(status, raw) and mode != "text":
                        mode = "json_object" if mode == "json_schema" else "text"
                        continue
                    if status in {429, 500, 502, 503, 504} and not transient_retry:
                        transient_retry = True
                        continue
                    if status != 200:
                        raise self._error(status)
                    choice = json.loads(raw)["choices"][0]
                    message = choice["message"]
                    if choice.get("finish_reason") != "stop" or message.get("tool_calls") or message.get("refusal") or message.get("function_call"):
                        raise OllamaError("NaviGator returned incomplete or refused output; no assessment was accepted.")
                    content = message["content"]
                    if not isinstance(content, str) or not content.strip():
                        raise OllamaError("NaviGator returned no answer text.")
                    return {"response": content}
                raise OllamaError("NaviGator retry limit reached; local evidence was retained.")
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, AttributeError):
            raise OllamaError("NaviGator returned an invalid response or could not be reached; local evidence was retained.") from None
        finally:
            gate.release()

    def list_models(self):
        try:
            with httpx.Client(trust_env=False, follow_redirects=False) as client:
                status, raw = self._request(client, "GET", "/models")
            if status != 200:
                raise self._error(status)
            return [row["id"] for row in json.loads(raw)["data"] if isinstance(row.get("id"), str)]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            raise OllamaError("Could not read NaviGator's available models.") from None


def main():
    parser = argparse.ArgumentParser(description="Check Toolkit authentication and configured model access without sending video data.")
    parser.parse_args()
    try:
        client = NavigatorClient()
        models = client.list_models()
        missing = {settings.navigator_model, settings.navigator_topic_model or settings.navigator_model} - set(models)
        if missing:
            parser.exit(1, "Configured NaviGator models are unavailable to this key: " + ", ".join(sorted(missing)) + "\n")
    except OllamaError as error:
        parser.exit(1, str(error) + "\n")
    print(json.dumps({"status": "ok", "provider": "navigator", "model": client.model, "available_models": models}, indent=2))


if __name__ == "__main__":
    main()
