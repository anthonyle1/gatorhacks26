"""Explicit identities for every reusable pipeline boundary."""
import hashlib
import json
from uuid import uuid4

_PROCESS_VERSION = str(uuid4())


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def versions(stage="assessment"):
    from app.config import settings
    import os
    provider = settings.topic_provider if stage == "topics" else settings.assessment_provider if stage == "assessment" else "ollama"
    model = (settings.navigator_topic_model or settings.navigator_model) if stage == "topics" else settings.navigator_model
    return {
        "evidence": "2", "preprocessing": "1", "usability": "1", "selection": "1",
        "schema": "2", "stage": stage, "web_context": "disabled",
        "roberta": settings.roberta_revision, "asr": [settings.asr_model, settings.asr_revision, "cpu-int8-vad-beam1"],
        "provider": provider,
        "model": model if provider == "navigator" else settings.gemma_model if provider == "gemma"
                 else os.getenv("OLLAMA_MODEL", "gemma4:e2b"),
        "endpoint": settings.navigator_base_url if provider == "navigator" else settings.gemma_endpoint if provider == "gemma"
                    else os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        "response_format": [settings.navigator_response_format, "navigator-v1"] if provider == "navigator" else None,
        "fallback": [os.getenv("GEMINI_FALLBACK_ENABLED", "true"), os.getenv("GEMINI_MODEL", "gemini-3.8-flash")] if provider == "ollama" else None,
        # Mutable development revisions may reuse within one process only.
        "mutable_revision_process": _PROCESS_VERSION if "main" in {settings.roberta_revision, settings.asr_revision} else None,
    }
