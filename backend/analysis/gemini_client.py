"""Server-side Gemini fallback with no tool execution or client-side API key."""

import os
from pathlib import Path
import re

import httpx
from dotenv import load_dotenv

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


class GeminiError(RuntimeError):
    pass


def _gemini_schema(schema):
    """Inline local references and omit unsupported generation-only keywords.

    The original Pydantic schema is still used for strict local validation.
    """
    definitions = schema.get("$defs", {})

    def convert(value):
        if isinstance(value, list):
            return [convert(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "$ref" in value:
            return convert(definitions[value["$ref"].removeprefix("#/$defs/")])
        return {key: ({name: convert(child) for name, child in item.items()} if key == "properties"
                      else convert(item)) for key, item in value.items()
                if key not in ("$defs", "title", "uniqueItems")}

    return convert(schema)


class GeminiClient:
    def __init__(self):
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
        self.enabled = os.getenv("GEMINI_FALLBACK_ENABLED", "true").lower() == "true"
        self.api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        if not self.enabled:
            return
        try:
            self.timeout = float(os.getenv("GEMINI_TIMEOUT", "60"))
        except ValueError:
            raise GeminiError("GEMINI_TIMEOUT must be a positive number.") from None
        if not 0 < self.timeout <= 300:
            raise GeminiError("GEMINI_TIMEOUT must be between 0 and 300 seconds.")
        if not re.fullmatch(r"[A-Za-z0-9.-]{1,100}", self.model):
            raise GeminiError("GEMINI_MODEL must be a model ID without a URL or path.")

    def prompt(self, prompt, system, schema):
        if not self.enabled:
            raise GeminiError("Gemini fallback is disabled.")
        if not self.api_key:
            raise GeminiError("Gemini fallback requires GEMINI_API_KEY in backend/.env.")
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0, "maxOutputTokens": 8192,
                "responseMimeType": "application/json",
                "responseJsonSchema": _gemini_schema(schema),
            },
        }
        if self.model == DEFAULT_GEMINI_MODEL:
            # Classification does not require the model's default medium effort.
            payload["generationConfig"]["thinkingConfig"] = {"thinkingLevel": "low"}
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        try:
            with httpx.Client(timeout=self.timeout, trust_env=False, follow_redirects=False) as client:
                response = client.post(url, headers={"x-goog-api-key": self.api_key}, json=payload)
                response.raise_for_status()
                if len(response.content) > 256_000:
                    raise GeminiError("Gemini returned an oversized response.")
                data = response.json()
        except httpx.TimeoutException:
            raise GeminiError("Gemini fallback timed out.") from None
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (401, 403):
                raise GeminiError("Gemini authentication failed; check GEMINI_API_KEY.") from None
            if status == 429:
                raise GeminiError("Gemini quota or rate limit reached.") from None
            if status in (500, 502, 503, 504):
                raise GeminiError(f"Gemini service temporarily unavailable (HTTP {status}); try again later.") from None
            raise GeminiError(f"Gemini returned HTTP {status}; check model access and API configuration.") from None
        except httpx.RequestError:
            raise GeminiError("Could not connect to Gemini.") from None
        except ValueError:
            raise GeminiError("Gemini returned invalid JSON.") from None
        try:
            candidate = data["candidates"][0]
            if candidate.get("finishReason") != "STOP":
                raise GeminiError("Gemini did not complete an assessment (blocked or truncated output).")
            parts = candidate["content"]["parts"]
            # Exclude thought parts and never interpret tool calls as executable.
            text = "".join(part["text"] for part in parts
                           if isinstance(part, dict) and isinstance(part.get("text"), str) and not part.get("thought"))
        except (KeyError, IndexError, TypeError, AttributeError):
            raise GeminiError("Gemini returned no usable assessment.") from None
        if not text.strip():
            raise GeminiError("Gemini returned no answer text.")
        return text
