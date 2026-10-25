"""SQLite owns accepted segments and leases. Redis is only reusable computation."""
import asyncio
from datetime import datetime, timezone
import json
from uuid import uuid4
from fastapi.concurrency import run_in_threadpool

from analysis.topic_store import TopicStore
from analysis.versions import fingerprint, versions
from analysis.segmentation import coverage
from analysis.cache import get_cache
from analysis.transcription import transcribe, map_transcript
from app.config import settings


def timestamp():
    return datetime.now(timezone.utc).timestamp()


class AudioIngestion:
    def __init__(self, store=None):
        self.store = store or TopicStore()
        with self.store.connection() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS audio_occurrences (
                    id TEXT PRIMARY KEY, review_id TEXT NOT NULL, video_id TEXT NOT NULL, metadata TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audio_segments (
                    id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL, identity TEXT NOT NULL,
                    metadata TEXT NOT NULL, raw BLOB, status TEXT NOT NULL, result TEXT,
                    error TEXT, created REAL NOT NULL, updated REAL NOT NULL, token TEXT);
                CREATE TABLE IF NOT EXISTS review_audio (
                    review_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audio_review_state (
                    review_id TEXT PRIMARY KEY, reason TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS segment_queue ON audio_segments(status, updated);
            """)

    def audio_status(self, review_id):
        from analysis.transcription import installation_status
        from collections import Counter
        with self.store.connection() as c:
            row = c.execute("SELECT reason FROM audio_review_state WHERE review_id=?", (str(review_id),)).fetchone()
            segments = c.execute("SELECT s.status,s.result FROM audio_segments s JOIN audio_occurrences o ON o.id=s.occurrence_id WHERE o.review_id=?", (str(review_id),)).fetchall()
            frozen = c.execute("SELECT snapshot FROM review_audio WHERE review_id=?", (str(review_id),)).fetchone()
        counts, exclusions, excerpt_count = Counter(), Counter(), 0
        for segment in segments:
            counts[segment["status"]] += 1
            result = json.loads(segment["result"]) if segment["result"] else {}
            excerpt_count += len(result.get("excerpts", []))
            if result.get("exclusion_reason"):
                exclusions[result["exclusion_reason"]] += 1
            elif result.get("usable") and result.get("segments") and not result.get("excerpts"):
                exclusions["unmapped_or_uncertain_speech"] += 1
        frozen_excerpts = sum(len(segment.get("result", {}).get("excerpts", [])) for occurrence in json.loads(frozen[0])["occurrences"]
                              for segment in occurrence["segments"] if segment.get("result")) if frozen else 0
        return {"enabled": settings.audio_enabled and row is None,
                "disabled_reason": row[0] if row else None if settings.audio_enabled else "Audio is disabled in backend configuration.",
                "disable_on_failure": settings.audio_disable_on_failure, "asr": installation_status(),
                "uploaded_segments": len(segments), "processing_states": dict(counts), "usable_transcript_excerpts": excerpt_count,
                "excluded_segments": dict(exclusions), "finalized": frozen is not None,
                "review_transcript_excerpts": frozen_excerpts, "late_transcript_excerpts": max(0, excerpt_count-frozen_excerpts) if frozen else 0}

    def disable_audio(self, review_id, reason, *, connection=None):
        def disable(c):
            c.execute("INSERT OR IGNORE INTO audio_review_state VALUES (?,?)", (str(review_id), reason))
            c.execute("UPDATE audio_segments SET status='skipped',raw=NULL,error=?,token=NULL WHERE status='queued' AND occurrence_id IN (SELECT id FROM audio_occurrences WHERE review_id=?)", (reason, str(review_id)))
        if connection is not None:
            disable(connection)
        else:
            with self.store.connection() as c:
                disable(c)

    def register(self, occurrence):
        data = occurrence.model_dump(mode="json")
        encoded = json.dumps(data, sort_keys=True)
        with self.store.connection() as c:
            c.execute("BEGIN IMMEDIATE")
            old = c.execute("SELECT metadata FROM audio_occurrences WHERE id=?", (data["occurrence_id"],)).fetchone()
            if old:
                if old[0] != encoded:
                    raise ValueError("Occurrence ID already has different ownership")
                return data
            if c.execute("SELECT 1 FROM review_audio WHERE review_id=?", (data["review_session_id"],)).fetchone():
                raise ValueError("Review evidence cutoff has already been frozen")
            if c.execute("SELECT COUNT(*) FROM audio_occurrences WHERE review_id=?", (data["review_session_id"],)).fetchone()[0] >= 5000:
                raise ValueError("Occurrence limit exceeded")
            c.execute("INSERT INTO audio_occurrences VALUES (?,?,?,?)", (data["occurrence_id"], data["review_session_id"], data["video_session_id"], encoded))
        return data

    def accept(self, segment, raw):
        if not settings.audio_enabled:
            raise ValueError("Audio ingestion is disabled")
        if not raw or len(raw) > settings.audio_max_upload_bytes:
            raise ValueError("Audio upload size exceeded")
        metadata = segment.model_dump(mode="json")
        metadata.update(audio_hash=fingerprint_bytes(raw), uploaded_bytes=len(raw))
        identity = fingerprint([metadata, fingerprint_bytes(raw)])
        with self.store.connection() as c:
            old = c.execute("SELECT identity,status FROM audio_segments WHERE id=?", (str(segment.segment_id),)).fetchone()
            if old:
                if old[0] != identity:
                    raise ValueError("Segment ID reused with different content")
                return old[1]
        from analysis.transcription import decode_mp3
        audio = decode_mp3(raw)
        if metadata["intervals"][-1]["audio_end"] + segment.encoder_delay_seconds > len(audio)/16000 + .15:
            raise ValueError("Capture intervals exceed decoded audio")
        with self.store.connection() as c:
            c.execute("BEGIN IMMEDIATE")
            owner = c.execute("SELECT metadata FROM audio_occurrences WHERE id=?", (str(segment.occurrence_id),)).fetchone()
            if owner is None:
                raise ValueError("Register occurrence before uploading segments")
            if c.execute("SELECT 1 FROM audio_review_state WHERE review_id=?", (json.loads(owner[0])["review_session_id"],)).fetchone():
                raise ValueError("Audio is disabled for this review after transcription failed")
            if json.loads(owner[0])["plan_version"] != segment.plan_version:
                raise ValueError("Segment plan version differs from its occurrence")
            duration = json.loads(owner[0]).get("duration")
            if duration and any(interval.media_end > duration + .35 for interval in segment.intervals):
                raise ValueError("Captured interval exceeds the known video duration")
            old = c.execute("SELECT identity,status FROM audio_segments WHERE id=?", (str(segment.segment_id),)).fetchone()
            if old:
                if old[0] != identity:
                    raise ValueError("Segment ID reused with different content")
                return old[1]
            if c.execute("SELECT COUNT(*) FROM audio_segments WHERE status IN ('queued','processing')").fetchone()[0] >= settings.audio_max_pending:
                raise ValueError("Audio processing queue is full")
            if c.execute("SELECT COUNT(*) FROM audio_segments WHERE occurrence_id=?", (str(segment.occurrence_id),)).fetchone()[0] >= 1000:
                raise ValueError("Occurrence segment limit exceeded")
            c.execute("INSERT INTO audio_segments VALUES (?,?,?,?,?,'queued',NULL,NULL,?,?,NULL)",
                      (str(segment.segment_id), str(segment.occurrence_id), identity, json.dumps(metadata), raw, timestamp(), timestamp()))
        return "queued"

    def freeze(self, review_id, manifest, *, connection):
        """Called within the finish transaction; late workers cannot change this JSON."""
        c = connection
        existing = c.execute("SELECT snapshot FROM review_audio WHERE review_id=?", (review_id,)).fetchone()
        if existing:
            return json.loads(existing[0])
        entries, seen = [], set()
        for item in manifest:
            occurrence_id = str(item["occurrence_id"])
            owner = c.execute("SELECT * FROM audio_occurrences WHERE id=? AND review_id=?", (occurrence_id, review_id)).fetchone()
            if owner is None:
                raise ValueError("Manifest occurrence does not belong to review")
            entry = {"occurrence_id": occurrence_id, "video_session_id": owner["video_id"], "capture_state": item["capture_state"], "segments": []}
            for segment_id in item["segment_ids"]:
                segment_id = str(segment_id)
                if segment_id in seen:
                    raise ValueError("Duplicate manifest segment")
                seen.add(segment_id)
                row = c.execute("SELECT * FROM audio_segments WHERE id=?", (segment_id,)).fetchone()
                if row and row["occurrence_id"] != occurrence_id:
                    raise ValueError("Manifest segment belongs to another occurrence")
                accepted = {"segment_id": segment_id, "status": "missing"}
                if row:
                    accepted.update(status=row["status"], metadata=json.loads(row["metadata"]), error=row["error"])
                    if row["result"]:
                        accepted["result"] = json.loads(row["result"])
                entry["segments"].append(accepted)
            entries.append(entry)
        snapshot = {"cutoff": timestamp(), "evidence_version": fingerprint(entries), "occurrences": entries}
        c.execute("INSERT INTO review_audio VALUES (?,?)", (review_id, json.dumps(snapshot)))
        return snapshot

    def evidence(self, review_id):
        with self.store.connection() as c:
            row = c.execute("SELECT snapshot FROM review_audio WHERE review_id=?", (review_id,)).fetchone()
        return json.loads(row[0]) if row else {"occurrences": []}

    def progress(self, review_id):
        """Live evidence is explicitly distinct from a finalized immutable review."""
        with self.store.connection() as c:
            rows = c.execute("SELECT o.video_id,o.id AS occurrence_id,s.id,s.status,s.result,s.error FROM audio_occurrences o LEFT JOIN audio_segments s ON s.occurrence_id=o.id WHERE o.review_id=? ORDER BY s.created LIMIT 5000", (review_id,)).fetchall()
        return {"review_session_id": review_id, "finalized": False, "audio": self.audio_status(review_id), "segments": [
            {"video_session_id": row["video_id"], "occurrence_id": row["occurrence_id"], "segment_id": row["id"],
             "processing_state": row["status"], "result": json.loads(row["result"]) if row["result"] else None, "error": row["error"]}
            for row in rows]}

    def process_one(self):
        token = str(uuid4())
        with self.store.connection() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("UPDATE audio_segments SET status='expired',raw=NULL,error='Audio expired' WHERE raw IS NOT NULL AND created<?", (timestamp()-settings.audio_expiry_seconds,))
            c.execute("UPDATE audio_segments SET status='queued',token=NULL WHERE status='processing' AND updated<?", (timestamp()-300,))
            # Oldest work first, one segment per lease, no video owns the worker indefinitely.
            row = c.execute("SELECT s.*,o.review_id FROM audio_segments s JOIN audio_occurrences o ON o.id=s.occurrence_id WHERE s.status='queued' ORDER BY s.updated LIMIT 1").fetchone()
            if row is None:
                return False
            c.execute("UPDATE audio_segments SET status='processing',token=?,updated=? WHERE id=?", (token, timestamp(), row["id"]))
        try:
            from analysis.metrics import record
            record("asr_queue_wait", timestamp()-row["created"])
            identity = {"audio_hash": fingerprint_bytes(row["raw"]), "versions": versions("transcription"), "prompt": None}
            result = get_cache().get_or_compute(identity, lambda: transcribe(row["raw"]), ttl=settings.analysis_cache_ttl) if settings.asr_revision != "main" else transcribe(row["raw"])
            result["excerpts"] = map_transcript(result, json.loads(row["metadata"])) if result["usable"] else []
            status, error = "complete", None
        except Exception:
            result, status, error = None, "failed", "Local transcription failed; no speech content was invented."
        with self.store.connection() as c:
            c.execute("BEGIN IMMEDIATE")
            accepted = c.execute("UPDATE audio_segments SET status=?,result=?,error=?,raw=CASE WHEN ?='complete' OR ? THEN NULL ELSE raw END,updated=? WHERE id=? AND token=? AND status='processing'",
                      (status, json.dumps(result) if result else None, error, status, settings.audio_disable_on_failure, timestamp(), row["id"], token)).rowcount
            if accepted and status == "failed" and settings.audio_disable_on_failure:
                self.disable_audio(row["review_id"], "Transcription failed. Audio is disabled for this session; metadata and comments remain available.", connection=c)
        if accepted and status == "complete" and result["excerpts"]:
            # Publish speech before optional sentiment/model startup can delay Finish.
            from analysis.analyzer import get_analyzer, ModelUnavailableError
            from app.youtube import Comment
            try:
                result["sentiment"] = get_analyzer().analyze([Comment(f"transcript:{row['id']}:{i}", excerpt["text"]) for i, excerpt in enumerate(result["excerpts"])])
            except (ModelUnavailableError, RuntimeError):
                result["sentiment"] = None
            with self.store.connection() as c:
                c.execute("UPDATE audio_segments SET result=? WHERE id=? AND token=? AND status='complete'", (json.dumps(result), row["id"], token))
        return True


def fingerprint_bytes(raw):
    import hashlib
    return hashlib.sha256(raw).hexdigest()


def video_evidence(snapshot, video_session_id):
    transcripts, missing, excluded, captured, transcribed = [], [], [], [], []
    for occurrence in snapshot["occurrences"]:
        if occurrence["video_session_id"] != video_session_id:
            continue
        if not occurrence["segments"] and occurrence["capture_state"] != "disabled":
            missing.append({"occurrence_id": occurrence["occurrence_id"], "status": occurrence["capture_state"]})
        for segment in occurrence["segments"]:
            for interval in segment.get("metadata", {}).get("intervals", []):
                if interval["certain"]:
                    captured.append((interval["media_start"], interval["media_end"]))
            if segment["status"] != "complete":
                missing.append({"segment_id": segment["segment_id"], "status": segment["status"]})
                continue
            result = segment["result"]
            if not result["usable"]:
                excluded.append({"segment_id": segment["segment_id"], "reason": result["exclusion_reason"]})
                continue
            if not result["excerpts"]:
                excluded.append({"segment_id": segment["segment_id"], "reason": "unmapped_or_uncertain_speech"})
            for index, excerpt in enumerate(result["excerpts"]):
                text = excerpt["text"][:1500]
                # A truncated sentence has no trustworthy end range: exclude it.
                if len(text) != len(excerpt["text"]):
                    continue
                transcripts.append({"id": f"transcript:{segment['segment_id']}:{index}", "occurrence_id": occurrence["occurrence_id"], **excerpt})
                transcribed.append((excerpt["media_start"], excerpt["media_end"]))
    return {"transcripts": transcripts[:24], "missing_evidence": missing[:1000], "excluded_evidence": excluded[:1000],
            "coverage": {"captured": coverage(captured), "transcribed": coverage(transcribed),
                         "submitted": coverage(transcribed[:24]), "omitted_transcript_excerpts": max(0, len(transcripts)-24),
                         "missing_count": len(missing), "excluded_count": len(excluded)},
            "evidence_version": snapshot.get("evidence_version")}


async def recover_audio():
    while True:
        try:
            worked = await run_in_threadpool(AudioIngestion().process_one) if settings.audio_enabled else False
        except Exception:
            worked = False
        await asyncio.sleep(.05 if worked else 1)
