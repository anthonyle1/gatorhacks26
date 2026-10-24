"""Durable local session reviews. This module never reads or writes MongoDB."""

import asyncio
from contextlib import suppress
from datetime import datetime, timezone, timedelta
import json
import hashlib
import logging
from uuid import uuid4

from fastapi.concurrency import run_in_threadpool

from analysis.analyzer import get_analyzer, ModelUnavailableError
from analysis.ollama_client import OllamaError
from analysis.session_review import classify_session_data
from analysis.topic_store import TopicStore
from analysis.video_assessment import assess_video, AssessmentComment
from app.config import settings
from app.youtube import fetch_video_metadata, fetch_video_comments, Comment, YouTubeError

logger = logging.getLogger(__name__)
LOCAL_USER = "local_extension"


def now():
    return datetime.now(timezone.utc).isoformat()


class LocalSessions:
    def __init__(self, store=None):
        self.store = store or TopicStore()
        with self.store.connection() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS local_review_jobs (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
                videos TEXT NOT NULL DEFAULT '[]', detail TEXT, updated_at TEXT NOT NULL,
                run_id TEXT)""")

    def get(self, session_id):
        with self.store.connection() as connection:
            row = connection.execute("SELECT * FROM local_review_jobs WHERE id=?", (session_id,)).fetchone()
        return dict(row) if row else None

    def enqueue(self, session_id, payload):
        encoded = json.dumps(payload, sort_keys=True)
        with self.store.connection() as connection:
            row = connection.execute("SELECT payload FROM local_review_jobs WHERE id=?", (session_id,)).fetchone()
            if row and row[0] != encoded:
                raise ValueError("This session already has a different snapshot")
            connection.execute("INSERT OR IGNORE INTO local_review_jobs(id,payload,status,updated_at) VALUES (?,?,'pending',?)",
                               (session_id, encoded, now()))

    def retry(self, session_id):
        with self.store.connection() as connection:
            return connection.execute("UPDATE local_review_jobs SET status='pending',detail=NULL,updated_at=? WHERE id=? AND status IN ('failed','partial')",
                                      (now(), session_id)).rowcount == 1

    def claim(self, session_id):
        token = str(uuid4())
        with self.store.connection() as connection:
            changed = connection.execute("UPDATE local_review_jobs SET status='processing',run_id=?,detail=NULL,updated_at=? WHERE id=? AND status='pending'",
                                         (token, now(), session_id)).rowcount
        return (self.get(session_id), token) if changed else (None, None)

    def update(self, session_id, token, *, videos=None, status="processing", detail=None):
        with self.store.connection() as connection:
            if videos is None:
                connection.execute("UPDATE local_review_jobs SET status=?,detail=?,updated_at=? WHERE id=? AND run_id=? AND status='processing'",
                                   (status, detail, now(), session_id, token))
            else:
                connection.execute("UPDATE local_review_jobs SET videos=?,status=?,detail=?,updated_at=? WHERE id=? AND run_id=? AND status='processing'",
                                   (json.dumps(videos), status, detail, now(), session_id, token))

    def pending(self):
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        with self.store.connection() as connection:
            connection.execute("UPDATE local_review_jobs SET status='pending' WHERE status='processing' AND updated_at < ?", (cutoff,))
            return [row[0] for row in connection.execute("SELECT id FROM local_review_jobs WHERE status='pending' ORDER BY updated_at LIMIT 20")]

    def view(self, session_id):
        job = self.get(session_id)
        if not job:
            return None
        result = self.store.view(session_id, LOCAL_USER) or {"session_id": session_id, "tree": [], "assignments": {}, "errors": [], "fallback_used": False}
        result.update(status=job["status"], videos=json.loads(job["videos"]), storage="local", detail=job["detail"])
        result["analyzed_count"] = len(result["videos"])
        events = json.loads(job["payload"])["events"]
        result["video_count"] = len({(event["platform"], event["video_id"]) for event in events})
        result["fallback_used"] = result["fallback_used"] or any(video.get("analysis", {}).get("assessment", {}).get("fallback_used", False) for video in result["videos"])
        return result


def aggregate(payload):
    unique = {}
    for event in payload["events"]:
        key = event["platform"] + ":" + event["video_id"]
        if key not in unique:
            unique[key] = {"video_id": key, "source_id": event["video_id"], "platform": event["platform"],
                           "title": event["title"], "caption": event["caption"], "dwell_seconds": 0, "watch_count": 0}
        video = unique[key]
        video["dwell_seconds"] += event.get("dwell_seconds") or 0
        video["watch_count"] += 1
        video["title"] = event["title"] or video["title"]
        video["caption"] = event["caption"] or video["caption"]
    reels = {item["video_id"]: item for item in payload["instagram"]}
    for video in unique.values():
        reel = reels.get(video["source_id"], {}) if video["platform"] == "instagram" else {}
        video["comments"] = reel.get("comments", [])
        video["title"] = reel.get("title") or video["title"]
        video["caption"] = reel.get("caption") or video["caption"]
    return list(unique.values())


def analyze_video(video, previous=None):
    errors = []
    comments = [Comment(id=None, text=text) for text in video.get("comments", [])]
    if video["platform"] == "youtube":
        if settings.youtube_api_key:
            try:
                video.update(fetch_video_metadata(video["source_id"], settings.youtube_api_key))
            except YouTubeError:
                errors.append("YouTube metadata unavailable; using the captured page metadata.")
            try:
                from app.youtube import parse_comments
                comments = parse_comments(fetch_video_comments(video["source_id"], settings.youtube_api_key, 20))
            except YouTubeError:
                errors.append("YouTube comments unavailable; metadata can still support classification.")
        else:
            errors.append("YOUTUBE_API_KEY is not configured; using captured metadata without YouTube comments.")
    if video["title"].strip().casefold() in {"youtube", "youtube shorts", "instagram", "instagram reels"}:
        video["title"] = ""
    analysis = {"status": "complete", "errors": errors, "sentiment": None, "comments": []}
    try:
        sentiment = get_analyzer().analyze(comments)
        analysis["sentiment"] = sentiment["summary"]
        analysis["comments"] = [{**row, "text": row["text"][:300]} for row in sentiment["comments"][:12]]
    except (ModelUnavailableError, RuntimeError):
        errors.append("Comment sentiment is unavailable; no sentiment score was invented.")
    video["sentiment_balance"] = (analysis["sentiment"] or {}).get("sentiment_balance")
    video["comments"] = [comment.text[:300] for comment in comments[:12]]
    video["metadata_status"] = "available" if video["title"].strip() or video["caption"].strip() else "insufficient"
    if video["metadata_status"] == "available":
        try:
            evidence = [AssessmentComment(text=text) for text in video["comments"] if text.strip()]
            evidence_key = hashlib.sha256(json.dumps([video["title"], video["caption"][:4000], video["sentiment_balance"], video["comments"]]).encode()).hexdigest()
            old = (previous or {}).get("analysis", {})
            if old.get("evidence_key") == evidence_key and old.get("assessment"):
                analysis["assessment"] = old["assessment"]
            else:
                assessment = assess_video(video["title"] or "Video with caption only", video["caption"][:4000], video["sentiment_balance"], comments=evidence)
                analysis["assessment"] = assessment.model_dump()
            analysis["evidence_key"] = evidence_key
            video["context_summary"] = analysis["assessment"]["context_summary"]
        except (OllamaError, ValueError):
            errors.append("Content assessment unavailable; session topics will still be attempted from metadata.")
    else:
        errors.append("No usable title or caption was captured for this video.")
    if errors:
        analysis["status"] = "partial"
    video["analysis"] = analysis
    return video


def build_review(jobs, job, token):
    session_id = job["id"]
    previous = {video["video_id"]: video for video in json.loads(job["videos"])}
    videos = []
    for video in aggregate(json.loads(job["payload"])):
        cached = previous.get(video["video_id"])
        videos.append(cached if cached and cached.get("analysis", {}).get("status") == "complete" else analyze_video(video, cached))
        jobs.update(session_id, token, videos=videos)
    result = classify_session_data(session_id, LOCAL_USER, videos, store=jobs.store)
    status = result["status"]
    if status == "complete" and any(video["analysis"]["status"] != "complete" for video in videos):
        status = "partial"
    jobs.update(session_id, token, videos=videos, status=status)


async def process_local_session(session_id, jobs=None):
    jobs = jobs or LocalSessions()
    job, token = await run_in_threadpool(jobs.claim, session_id)
    if not job:
        return

    async def heartbeat():
        while True:
            await asyncio.sleep(30)
            await run_in_threadpool(jobs.update, session_id, token)

    pulse = asyncio.create_task(heartbeat())
    try:
        await run_in_threadpool(build_review, jobs, job, token)
    except asyncio.CancelledError:
        # The last heartbeat expires if the process exits; preserve the snapshot.
        raise
    except Exception as error:
        logger.warning("Local session review failed (%s)", type(error).__name__)
        await run_in_threadpool(jobs.update, session_id, token, status="failed",
            detail="Session review could not complete. Check backend logs and retry; recorded videos are preserved.")
    finally:
        pulse.cancel()
        with suppress(asyncio.CancelledError):
            await pulse


async def recover_local_sessions():
    while True:
        try:
            jobs = await run_in_threadpool(LocalSessions)
            for session_id in await run_in_threadpool(jobs.pending):
                await process_local_session(session_id, jobs)
        except Exception as error:
            logger.warning("Local session recovery unavailable (%s)", type(error).__name__)
        await asyncio.sleep(10)
