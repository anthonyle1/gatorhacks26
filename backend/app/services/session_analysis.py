"""Classify only completed sessions; keep model calls out of event uploads."""

import asyncio
from contextlib import suppress
from datetime import datetime, timezone, timedelta
import hashlib
import json
import logging
from uuid import uuid4

from fastapi.concurrency import run_in_threadpool

from app.database import db
from analysis.ollama_client import OllamaError
from analysis.session_classification import classify_batch, pack_videos
from analysis.topic_store import TopicStore

logger = logging.getLogger(__name__)


def classify_session_data(session_id, user_id, videos, *, store=None, client=None):
    """Batch once after finish; cache successful batches for explicit retries."""
    store = store or TopicStore()
    eligible = [video for video in videos if (video.get("title", "").strip() or video.get("caption", "").strip())]
    unclassified = {video["video_id"] for video in videos} - {video["video_id"] for video in eligible}
    assignments, provenance, errors = {}, [], []
    for batch in pack_videos(eligible):
        fingerprint = hashlib.sha256(json.dumps(batch, sort_keys=True).encode()).hexdigest()
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
                unclassified.update(video["video_id"] for video in batch)
                continue
        assignments.update(cached["assignments"])
        unclassified.update(cached["unclassified"])
        provenance.append(cached["source"])
    status = "insufficient_data" if not eligible or (not assignments and not errors) else "partial" if errors and assignments else "failed" if errors else "complete"
    result = {"session_id": session_id, "status": status, "classification_scope": "completed_session",
              "assignments": assignments, "unclassified_video_ids": sorted(unclassified),
              "videos": [{key: video.get(key) for key in ("video_id", "source_id", "platform", "title", "metadata_status")} for video in videos],
              "batches": provenance, "errors": errors, "fallback_used": any(source["fallback_used"] for source in provenance),
              "completed_at": datetime.now(timezone.utc).isoformat()}
    store.save_session(session_id, user_id, result)
    return store.view(session_id, user_id)


async def collect_session_videos(session_id):
    events = await db.video_events.find({"session_id": session_id}).sort("sequence_number", 1).to_list(length=None)
    unique = {}
    for event in events:
        platform = event.get("platform", "youtube")
        key = f"{platform}:{event['video_id']}"
        unique.setdefault(key, event)
    videos = []
    for key, event in unique.items():
        platform = event.get("platform", "youtube")
        source_id = event["video_id"]
        if platform == "instagram":
            stored = await db.instagram_evidence.find_one({"video_id": source_id}) or {}
        else:
            stored = await db.video_analyses.find_one({"video_id": source_id, "platform": platform}) or {}
            if not stored:
                stored = await db.video_analyses.find_one({"video_id": source_id, "platform": {"$exists": False}}) or {}
        # Existing per-video background work normally fills this cache. Missing
        # metadata can be fetched now without a per-video topic/model call.
        if platform == "youtube" and not stored.get("metadata"):
            from app.config import settings
            from app.youtube import fetch_video_metadata, YouTubeError
            if settings.youtube_api_key:
                try:
                    stored["metadata"] = await run_in_threadpool(fetch_video_metadata, source_id, settings.youtube_api_key)
                except YouTubeError:
                    pass
        metadata = stored.get("metadata", {})
        title = metadata.get("title") or event.get("title", "")
        caption = metadata.get("caption") or event.get("caption", "")
        if title.strip().casefold() in {"youtube", "instagram", "youtube shorts", "instagram reels"}:
            title = ""
        roberta = stored.get("model_results", {}).get("roberta", {})
        assessment = stored.get("model_results", {}).get("custom", {}).get("result", {})
        videos.append({"video_id": key, "source_id": source_id, "platform": platform,
                       "title": title, "caption": caption, "context_summary": assessment.get("context_summary", ""),
                       "sentiment_balance": roberta.get("summary", {}).get("sentiment_balance"),
                       "comments": ([row["text"] for row in roberta.get("comments", []) if isinstance(row.get("text"), str)]
                                    or stored.get("comments", [])[:12]),
                       "metadata_status": "available" if title.strip() or caption.strip() else "insufficient"})
    return videos


async def process_session_analysis(session_id):
    run_id = str(uuid4())
    heartbeat = None
    try:
        session = await db.sessions.find_one_and_update(
            {"session_id": session_id, "status": "completed", "taxonomy_status": "pending"},
            {"$set": {"taxonomy_status": "processing", "taxonomy_started_at": datetime.now(timezone.utc), "taxonomy_run_id": run_id}})
        if not session:
            return

        async def keep_lease():
            while True:
                await asyncio.sleep(30)
                try:
                    await db.sessions.update_one({"session_id": session_id, "taxonomy_run_id": run_id, "taxonomy_status": "processing"},
                        {"$set": {"taxonomy_started_at": datetime.now(timezone.utc)}})
                except Exception:
                    logger.warning("Could not renew session classification lease")

        heartbeat = asyncio.create_task(keep_lease())
        videos = await collect_session_videos(session_id)
        result = await run_in_threadpool(classify_session_data, session_id, session["user_id"], videos)
        await db.sessions.update_one({"session_id": session_id, "taxonomy_run_id": run_id}, {"$set": {"taxonomy_status": result["status"]}})
    except asyncio.CancelledError:
        with suppress(Exception):
            await db.sessions.update_one({"session_id": session_id, "taxonomy_run_id": run_id, "taxonomy_status": "processing"}, {"$set": {"taxonomy_status": "pending"}})
        raise
    except Exception as exc:
        logger.warning("Session classification unavailable (%s)", type(exc).__name__)
        try:
            await db.sessions.update_one({"session_id": session_id, "taxonomy_run_id": run_id}, {"$set": {"taxonomy_status": "failed", "taxonomy_error": "Session classification could not complete; retry after checking backend connectivity."}})
        except Exception:
            logger.warning("Could not record session classification failure")
    finally:
        if heartbeat:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat


async def recover_session_jobs():
    """Resume durable pending jobs and expired claims after a backend restart."""
    while True:
        try:
            await db.sessions.update_many(
                {"status": "completed", "taxonomy_status": "processing",
                 "taxonomy_started_at": {"$lt": datetime.now(timezone.utc) - timedelta(minutes=15)}},
                {"$set": {"taxonomy_status": "pending"}})
            sessions = await db.sessions.find({"status": "completed", "taxonomy_status": "pending"}).to_list(length=20)
            for session in sessions:
                await process_session_analysis(session["session_id"])
        except Exception as exc:
            logger.warning("Session job recovery unavailable (%s)", type(exc).__name__)
        await asyncio.sleep(30)
