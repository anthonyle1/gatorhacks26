"""Validated model data with bounded Ollama retry and hosted Gemini fallback."""

import json
import logging

from pydantic import ValidationError

from .gemini_client import GeminiClient, GeminiError
from .ollama_client import OllamaClient, OllamaError

logger = logging.getLogger(__name__)


class DuplicateJSONKeyError(ValueError):
    pass


class ModelOutputError(OllamaError):
    code = "invalid_model_output"

    def __init__(self, issues):
        super().__init__("The configured model returned invalid output after one regeneration.")
        self.diagnostics = issues


def validation_issues(error, schema):
    """Return bounded diagnostic codes/declared fields, never evidence or output."""
    fields = set()
    def collect(node):
        if isinstance(node, dict):
            fields.update(node.get("properties", {}))
            for child in node.values():
                collect(child)
        elif isinstance(node, list):
            for child in node:
                collect(child)
    collect(schema)
    if isinstance(error, ValidationError):
        return [{"code": row["type"], "path": [part if isinstance(part, int) or part in fields else "*" for part in row["loc"]]}
                for row in error.errors(include_input=False, include_context=False)[:8]]
    rules = {
        "Assessment explanations require evidence references": "missing_evidence_reference",
        "Unknown or excluded evidence reference": "unknown_evidence_reference",
        "Transcript citation must identify its occurrence and interval": "missing_transcript_coordinates",
        "Citation falls outside submitted speech interval": "transcript_interval_out_of_bounds",
        "Non-speech evidence cannot have speech coordinates": "unexpected_speech_coordinates",
        "Response size limit": "response_size_limit",
    }
    code = "invalid_json" if isinstance(error, json.JSONDecodeError) else "duplicate_json_key" if isinstance(error, DuplicateJSONKeyError) else rules.get(str(error), "invalid_value")
    return [{"code": code}]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJSONKeyError("Duplicate JSON key")
        result[key] = value
    return result


def generate_validated(data, system, schema, validate, *, client=None, max_tokens=4096, max_chars=60000, context_length=8192, provider=None):
    """Only validated data leaves this function. No model tools are enabled."""
    prompt = json.dumps(data, ensure_ascii=True)

    def parse(raw):
        if not isinstance(raw, str) or len(raw) > max_chars:
            raise ValueError("Response size limit")
        return validate(json.loads(raw, object_pairs_hook=unique_object))

    if client is None and provider == "navigator":
        from .navigator_client import NavigatorClient
        client = NavigatorClient(stage="topics")
    elif client is None and provider == "gemma":
        from .gemma_client import GemmaClient
        client = GemmaClient()
    local = client or OllamaClient()
    try:
        for attempt in range(2):
            response = local.prompt(prompt, system, response_format=schema, max_tokens=max_tokens,
                                    think=False, context_length=context_length, temperature=0.0)
            try:
                result = parse(response["response"])
                model = getattr(local, "model", None)
                provider = getattr(local, "provider", "ollama")
                return result, {"provider": provider if isinstance(provider, str) else "ollama", "model": model if isinstance(model, str) else None,
                                "fallback_used": False, "fallback_reason": None}
            except (ValidationError, ValueError, KeyError, TypeError) as exc:
                issues = validation_issues(exc, schema)
                logger.warning("Rejected model response (attempt %s/2): %s", attempt + 1, issues)
                if attempt == 0:
                    system += "\nRegenerate the complete object using the original evidence. Respect schema limits, unique IDs, valid references, and coverage rules. Do not invent evidence."
                    system += "\nCorrect these validation issues (codes and schema fields only): " + json.dumps(issues)
                else:
                    raise ModelOutputError(issues) from None
    except OllamaError as local_error:
        if getattr(local, "provider", None) in {"gemma", "navigator"}:
            raise
        try:
            gemini = GeminiClient()
            if not gemini.enabled:
                raise local_error
            logger.warning("Using Gemini fallback after Ollama failed")
            raw = gemini.prompt(prompt, system, schema)
            try:
                result = parse(raw)
            except (ValidationError, ValueError, KeyError, TypeError):
                raise GeminiError("Gemini returned invalid output; no result was accepted.") from None
            return result, {"provider": "gemini", "model": gemini.model,
                            "fallback_used": True, "fallback_reason": str(local_error)}
        except GeminiError as exc:
            raise OllamaError(f"{local_error} Gemini fallback unavailable: {exc}") from None
