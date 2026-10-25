"""UF NaviGator chat completions. Credentials and all requests stay server-side."""
import argparse
import json
import logging
from time import monotonic
from urllib.parse import urlsplit

import httpx

from app.config import settings
from .gemma_client import limiter
from .ollama_client import OllamaError

logger = logging.getLogger(__name__)


class NavigatorError(OllamaError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


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
            raise NavigatorError("NaviGator request deadline exceeded.", "navigator_timeout")
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
            return NavigatorError("NaviGator authentication or model access failed; check your Toolkit key and allowed models.", "navigator_authentication")
        if status == 404:
            return NavigatorError("NaviGator model or endpoint was not found; check NAVIGATOR_MODEL and NAVIGATOR_BASE_URL.", "navigator_model_unavailable")
        if status == 429:
            return NavigatorError("NaviGator rate limit or quota reached; retry later.", "navigator_rate_limit")
        return NavigatorError(f"NaviGator request failed (HTTP {status}); local evidence was retained.", "navigator_http_error")

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
                length_retry = False
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
                        logger.warning("navigator http_status=%d", status)
                        raise self._error(status)
                    choice = json.loads(raw)["choices"][0]
                    message = choice["message"]
                    if choice.get("finish_reason") == "length":
                        if not length_retry and payload["max_tokens"] < 8192:
                            length_retry = True
                            payload["max_tokens"] = min(8192, payload["max_tokens"] * 2)
                            logger.warning("navigator output_truncated retry_max_tokens=%d", payload["max_tokens"])
                            continue
                        raise NavigatorError("NaviGator reached its output limit; no incomplete assessment was accepted.", "navigator_output_limit")
                    if choice.get("finish_reason") != "stop" or message.get("tool_calls") or message.get("refusal") or message.get("function_call"):
                        raise NavigatorError("NaviGator returned incomplete or refused output; no assessment was accepted.", "navigator_refused_output")
                    content = message["content"]
                    if not isinstance(content, str) or not content.strip():
                        raise OllamaError("NaviGator returned no answer text.")
                    return {"response": content}
                raise OllamaError("NaviGator retry limit reached; local evidence was retained.")
        except httpx.TimeoutException:
            raise NavigatorError("NaviGator request timed out; local evidence was retained.", "navigator_timeout") from None
        except httpx.HTTPError:
            raise NavigatorError("NaviGator could not be reached; local evidence was retained.", "navigator_connection") from None
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            raise NavigatorError("NaviGator returned an invalid response; local evidence was retained.", "navigator_invalid_response") from None
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
