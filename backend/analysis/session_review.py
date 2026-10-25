"""Session classification shared by local and MongoDB session transports."""

from datetime import datetime, timezone

from .ollama_client import OllamaError
from .session_classification import classify_batch, pack_videos
from .topic_store import TopicStore
from .versions import versions, fingerprint as evidence_fingerprint
from .session_classification import SESSION_PROMPT, SessionDiscovery


def classify_session_data(session_id, user_id, videos, *, store=None, client=None):
    """Batch once after finish; cache successful batches for explicit retries."""
    store = store or TopicStore()
    eligible = []
    for video in videos:
        if video.get("title", "").strip() or video.get("caption", "").strip() or video.get("transcripts"):
            eligible.append({**video, "caption": video.get("caption") or " ".join(row["text"] for row in video.get("transcripts", []))[:500]})
    assignments, provenance, errors = {}, [], []
    for batch in pack_videos(eligible):
        fingerprint = evidence_fingerprint([versions("topics"), SESSION_PROMPT, SessionDiscovery.model_json_schema(), batch])
        cached = store.cached_batch(session_id, user_id, fingerprint)
        if cached is None:
            catalog = store.candidates(user_id, " ".join(video["title"] + " " + video["caption"] for video in batch))
            try:
                discovery, source = classify_batch(batch, catalog, client=client)
                cached = {"assignments": store.apply_discovery(user_id, discovery),
                          "unclassified": discovery.unclassified_video_ids, "source": source}
                store.save_batch(session_id, user_id, fingerprint, cached)
            except (OllamaError, ValueError) as exc:
                errors.append({"video_ids": [video["video_id"] for video in batch],
                               "detail": str(exc) if isinstance(exc, OllamaError) else "Invalid category relationships; no batch assignments accepted."})
                continue
        assignments.update(cached["assignments"])
        provenance.append(cached["source"])
    # Enforce coverage in application code even if every model/provider fails.
    all_ids = {video["video_id"] for video in videos}
    missing = all_ids - {video_id for video_id, ids in assignments.items() if ids}
    status = "insufficient_data" if not eligible else "partial" if errors and assignments else "failed" if errors else "partial" if missing else "complete"
    if missing:
        category_id = store.fallback_category(user_id)
        for video_id in missing:
            assignments[video_id] = [category_id]
    result = {"session_id": session_id, "status": status, "classification_scope": "completed_session",
              "assignments": assignments, "unclassified_video_ids": [],
              "fallback_video_ids": sorted(missing),
              "videos": [{key: video.get(key) for key in ("video_id", "video_session_id", "source_id", "platform", "title", "caption", "metadata_status", "analysis", "dwell_seconds", "watch_count", "coverage", "transcripts", "missing_evidence", "excluded_evidence", "evidence_version")} for video in videos],
              "batches": provenance, "errors": errors, "fallback_used": any(source["fallback_used"] for source in provenance),
              "completed_at": datetime.now(timezone.utc).isoformat()}
    store.save_session(session_id, user_id, result)
    return store.view(session_id, user_id)

