"""Local Gemma prompting through Ollama's HTTP API.

From backend/: python -m analysis.ollama_client "Reply with OK"
"""

import argparse
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

DEFAULT_MODEL = "gemma4:e2b"


class OllamaError(RuntimeError):
    """Ollama is unavailable or could not complete a prompt."""


class OllamaClient:
    def __init__(self, base_url=None, model=None, timeout=None):
        # Resolve the backend .env consistently, including for standalone use.
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", DEFAULT_MODEL)
        self.timeout = float(timeout if timeout is not None else os.getenv("OLLAMA_TIMEOUT", "300"))
        if self.timeout <= 0:
            raise ValueError("OLLAMA_TIMEOUT must be positive.")

    def _request(self, method, path, **kwargs):
        try:
            with httpx.Client(base_url=self.base_url, timeout=self.timeout, trust_env=False) as client:
                response = client.request(method, path, **kwargs)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException:
            raise OllamaError("Ollama timed out. Model loading can be slow; increase OLLAMA_TIMEOUT.") from None
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404 and path == "/api/chat":
                raise OllamaError(f"Model unavailable. Run: ollama pull {self.model}") from None
            raise OllamaError(f"Ollama returned HTTP {exc.response.status_code}. Check the Ollama server logs.") from None
        except httpx.RequestError:
            raise OllamaError(f"Cannot connect to Ollama at {self.base_url}. Start Ollama or run ollama serve.") from None
        except ValueError:
            raise OllamaError("Ollama returned invalid JSON.") from None
        if not isinstance(data, dict) or data.get("error"):
            raise OllamaError("Ollama returned an unsuccessful response. Check the Ollama server logs.")
        return data

    def status(self):
        data = self._request("GET", "/api/tags")
        models = data.get("models")
        if not isinstance(models, list) or any(not isinstance(row, dict) for row in models):
            raise OllamaError("Ollama returned an invalid model list.")
        return {
            "model": self.model,
            "available": any(row.get("name") == self.model or row.get("model") == self.model for row in models),
        }

    def prompt(self, prompt: str, system: str | None = None, *, response_format=None, max_tokens=None, think=None, context_length=None):
        if not prompt.strip():
            raise ValueError("Prompt must not be blank.")
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload = {
            "model": self.model, "messages": messages, "stream": False,
        }
        if response_format is not None:
            payload["format"] = response_format
        options = {}
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if context_length is not None:
            options["num_ctx"] = context_length
        if options:
            payload["options"] = options
        if think is not None:
            payload["think"] = think
        data = self._request("POST", "/api/chat", json=payload)
        message = data.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str) or not message["content"].strip():
            raise OllamaError("Ollama returned no answer text.")
        return {"model": self.model, "response": message["content"]}


def main():
    parser = argparse.ArgumentParser(description=f"Prompt the local Ollama model (default: {DEFAULT_MODEL}).")
    parser.add_argument("prompt", nargs="?", default="Reply with exactly: local prompting works")
    parser.add_argument("--system", help="Optional system instruction")
    parser.add_argument("--check", action="store_true", help="Check model installation without running inference")
    args = parser.parse_args()
    try:
        client = OllamaClient()
        if args.check:
            status = client.status()
            if not status["available"]:
                raise OllamaError(f"Model not installed. Run: ollama pull {client.model}")
            print(f"{client.model} is installed. Run without --check to verify prompting.")
        else:
            print(client.prompt(args.prompt, args.system)["response"])
    except (OllamaError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
