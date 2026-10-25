"""Durable local session reviews. This module never reads or writes MongoDB."""

import asyncio
from contextlib import suppress
from datetime import datetime, timezone, timedelta
import json
import logging
import re
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from fastapi.concurrency import run_in_threadpool

from analysis.analyzer import get_analyzer, ModelUnavailableError
from analysis.ollama_client import OllamaError
from analysis.session_review import classify_session_data
from analysis.topic_store import TopicStore
from analysis.video_assessment import assess_video, AssessmentComment, assessment_identity
from app.config import settings
from app.youtube import fetch_video_metadata, fetch_video_comments, Comment, YouTubeError
from app.services.audio_ingestion import AudioIngestion, video_evidence
from analysis.versions import versions, fingerprint
from analysis.cache import get_cache
from analysis.metrics import measure

logger = logging.getLogger(__name__)
LOCAL_USER = "local_extension"


def now():
    return datetime.now(timezone.utc).isoformat()


def cached_metadata(source_id):
    with measure("metadata_fetch"):
        return get_cache().get_or_compute({"scope": LOCAL_USER, "platform": "youtube", "source": source_id,
            "kind": "metadata", "version": "1"}, lambda: fetch_video_metadata(source_id, settings.youtube_api_key), ttl=300)


def cached_comments(source_id):
    with measure("comments_fetch"):
        return get_cache().get_or_compute({"scope": LOCAL_USER, "platform": "youtube", "source": source_id,
            "query": {"limit": 20}, "version": "1"}, lambda: fetch_video_comments(source_id, settings.youtube_api_key, 20), ttl=300)


def prefetch_occurrence(occurrence):
    """Warm bounded evidence caches during playback; no final assessment or topics."""
    if occurrence.platform == "youtube" and settings.youtube_api_key:
        for fetch in (cached_metadata, cached_comments):
            try:
                fetch(occurrence.source_id)
            except YouTubeError:
                pass


class LocalSessions:
    def __init__(self, store=None):
        self.store = store or TopicStore()
        self.audio = AudioIngestion(self.store)
        with self.store.connection() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS local_review_jobs (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
                videos TEXT NOT NULL DEFAULT '[]', detail TEXT, updated_at TEXT NOT NULL,
                run_id TEXT)""")

    def get(self, session_id):
        with self.store.connection() as connection:
            row = connection.execute("SELECT * FROM local_review_jobs WHERE id=?", (session_id,)).fetchone()
        return dict(row) if row else None

    def reset_tree(self):
        with self.store.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM local_review_jobs WHERE status IN ('pending','processing') LIMIT 1").fetchone():
                raise ValueError("Wait for session analysis to finish before resetting the tree.")
            self.store.reset_tree(LOCAL_USER, connection=connection)

    def enqueue(self, session_id, payload):
        encoded = json.dumps(payload, sort_keys=True)
        with self.store.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT payload FROM local_review_jobs WHERE id=?", (session_id,)).fetchone()
            if row and row[0] != encoded:
                raise ValueError("This session already has a different snapshot")
            self.audio.freeze(session_id, payload.get("evidence_manifest", []), connection=connection)
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
        audio = self.audio.evidence(session_id)
        result["evidence_version"] = audio.get("evidence_version")
        result["evidence_cutoff"] = audio.get("cutoff")
        result["audio"] = self.audio.audio_status(session_id)
        result["analyzed_count"] = sum(video.get("analysis", {}).get("status") != "processing" for video in result["videos"])
        result["local_analysis_count"] = len(result["videos"])
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
            unique[key]["video_session_id"] = ("yt_" if event["platform"] == "youtube" else "ig_") + event["video_id"]
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


def analyze_video(video, previous=None, *, publish=None):
    errors = []
    captured_key = fingerprint([video["title"], video["caption"], video.get("comments", [])])
    accepted = (previous or {}).get("accepted_text_evidence", {})
    comments = [Comment(id=None, text=text) for text in video.get("comments", [])]
    if accepted.get("version") == "1" and accepted.get("captured_key") == captured_key:
        video.update(title=accepted["title"], caption=accepted["caption"])
        comments = [Comment(id=row["id"], text=row["text"]) for row in accepted["comments"]]
        errors.extend(accepted.get("errors", []))
    elif video["platform"] == "youtube":
        if settings.youtube_api_key:
            try:
                video.update(cached_metadata(video["source_id"]))
            except YouTubeError:
                errors.append("YouTube metadata unavailable; using the captured page metadata.")
            try:
                from app.youtube import parse_comments
                response = cached_comments(video["source_id"])
                comments = parse_comments(response)
            except YouTubeError:
                errors.append("YouTube comments unavailable; metadata can still support classification.")
        else:
            errors.append("YOUTUBE_API_KEY is not configured; using captured metadata without YouTube comments.")
    # Persist the first accepted text snapshot in each video checkpoint; retries never
    # refresh comments underneath an immutable finalized review.
    video["accepted_text_evidence"] = {"version": "1", "prompt": None, "captured_key": captured_key,
        "title": video["title"], "caption": video["caption"],
        "comments": [{"id": comment.id, "text": comment.text} for comment in comments], "errors": list(errors)}
    if video["title"].strip().casefold() in {"youtube", "youtube shorts", "instagram", "instagram reels"}:
        video["title"] = ""
    analysis = {"status": "complete", "errors": errors, "sentiment": None, "comments": []}
    analysis["versions"] = versions()
    transcripts = video.get("transcripts", [])
    analysis["transcript_sentiment"] = None
    analysis["analysis_by_id"] = {}
    try:
        sentiment = get_analyzer().analyze(comments)
        analysis["sentiment"] = sentiment["summary"]
        analysis["comments"] = [{**row, "text": row["text"][:300]} for row in sentiment["comments"][:12]]
        for index, row in enumerate(sentiment["comments"]):
            evidence_id = "comment:" + str(row.get("id") or index)
            analysis["analysis_by_id"][evidence_id] = {**row, "id": evidence_id, "source_type": "comment"}
        if transcripts:
            speech = get_analyzer().analyze([Comment(row["id"], row["text"]) for row in transcripts])
            analysis["transcript_sentiment"] = speech["summary"]
            for row in speech["comments"]:
                analysis["analysis_by_id"][row["id"]] = {**row, "source_type": "transcript"}
    except (ModelUnavailableError, RuntimeError):
        errors.append("Comment sentiment is unavailable; no sentiment score was invented.")
    video["sentiment_balance"] = (analysis["sentiment"] or {}).get("sentiment_balance")
    video["comments"] = [comment.text[:300] for comment in comments]
    video["metadata_status"] = "available" if video["title"].strip() or video["caption"].strip() else "insufficient"
    if publish:
        analysis["status"] = "processing"
        video["analysis"] = analysis
        publish(video)
    if video["metadata_status"] == "available" or transcripts or any(text.strip() for text in video["comments"]):
        try:
            # Round-robin sentiment buckets preserve positive and neutral context.
            buckets = {label: [] for label in ("negative", "neutral", "positive", None)}
            seen = set()
            for index, text in enumerate(video["comments"]):
                if not text.strip() or text.casefold() in seen:
                    continue
                seen.add(text.casefold())
                row = next((row for row in analysis["analysis_by_id"].values() if row["source_type"] == "comment" and row["text"][:300] == text), {})
                buckets[row.get("sentiment")].append(AssessmentComment(id=row.get("id", f"comment:{index}"), text=text,
                    sentiment=row.get("sentiment"), confidence=row.get("confidence"), scores=row.get("scores")))
            keywords = set(re.findall(r"\w{4,}", (video["title"] + " " + video["caption"]).casefold()))
            for bucket in buckets.values():
                bucket.sort(key=lambda item: len(keywords & set(re.findall(r"\w{4,}", item.text.casefold()))), reverse=True)
            evidence = []
            while any(buckets.values()) and len(evidence) < 12:
                for bucket in buckets.values():
                    if bucket and len(evidence) < 12:
                        evidence.append(bucket.pop(0))
            video["comments"] = [item.text for item in evidence]
            evidence_key = fingerprint([assessment_identity(), video["title"], video["caption"][:4000], video["sentiment_balance"],
                [row.model_dump() for row in evidence], transcripts, video.get("coverage"), video.get("evidence_version"),
                video.get("missing_evidence", []), video.get("excluded_evidence", []), analysis["transcript_sentiment"]])
            old = (previous or {}).get("analysis", {})
            if old.get("versions") == versions() and old.get("evidence_key") == evidence_key and old.get("assessment"):
                analysis["assessment"] = old["assessment"]
            else:
                with measure("individual_assessment"):
                    assessment = assess_video(video["title"], video["caption"][:4000], video["sentiment_balance"], comments=evidence,
                        transcripts=transcripts, coverage=video.get("coverage", {}),
                        missing_evidence=video.get("missing_evidence", []), excluded_evidence=video.get("excluded_evidence", []),
                        transcript_sentiment=analysis["transcript_sentiment"])
                analysis["assessment"] = assessment.model_dump()
            analysis["evidence_key"] = evidence_key
            video["context_summary"] = analysis["assessment"]["context_summary"]
        except (OllamaError, ValueError):
            errors.append("Content assessment unavailable; session topics will still be attempted from metadata.")
    else:
        errors.append("No usable metadata, transcript, or comments were captured for this video.")
    analysis["status"] = "partial" if errors else "complete"
    video["analysis"] = analysis
    return video


def build_review(jobs, job, token):
    session_id = job["id"]
    previous = {video["video_id"]: video for video in json.loads(job["videos"])}
    videos = []
    checkpoints, checkpoint_lock = {}, Lock()
    candidates = aggregate(json.loads(job["payload"]))
    for video in candidates:
        video.update(video_evidence(jobs.audio.evidence(session_id), video["video_session_id"]))
    def publish(video):
        with checkpoint_lock:
            checkpoints[video["video_id"]] = json.loads(json.dumps(video))
            jobs.update(session_id, token, videos=[checkpoints[item["video_id"]] for item in candidates if item["video_id"] in checkpoints])
    def process(video):
        try:
            # Re-fetch current evidence before any reuse; status alone is insufficient.
            analyzed = analyze_video(video, previous.get(video["video_id"]), publish=publish)
        except Exception as error:
            logger.warning("Individual video analysis unavailable (%s)", type(error).__name__)
            analyzed = video
            analyzed["analysis"] = {"status": "failed", "sentiment": None, "comments": [],
                "errors": ["Individual analysis could not complete; the video is retained for session classification."]}
        return analyzed
    # I/O overlaps with capture/ASR, while each CPU model keeps its own serialized boundary.
    with ThreadPoolExecutor(max_workers=settings.review_video_workers) as pool:
        for analyzed in pool.map(process, candidates):
            videos.append(analyzed)
            publish(analyzed)
    with measure("session_topic_discovery"):
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
