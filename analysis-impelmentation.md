# Analysis improvement implementation plan

Implement the recommendations in [analysis-improvements.md](analysis-improvements.md) in measurable phases. Keep audio transcription and RoBERTa local, use Redis for reusable evidence and inference results, and call hosted Gemma 4 from the backend for the final video assessment.

This plan incorporates the following product decisions: video sessions begin on playback and use platform-prefixed source IDs; every reuse boundary checks versions; usable metadata supports assessment when transcripts are absent or vague; audio segments use MP3 with media-relative intervals and wall-clock timestamps; evidence citations are validated against the submitted snapshot; and assessment web search is disabled. These decisions supersede conflicting recommendations in the source report. Expanded privacy, retention/deletion workflows, and storage-migration work are outside this single-user project's scope; existing bounded queues, recovery, and temporary-audio cleanup remain part of pipeline operation.

## 1. Define the baseline and configuration

- Measure metadata fetching, comment fetching, model startup, RoBERTa inference, individual assessment, and session topic discovery separately.
- Record median/p95 latency, queue wait, browser/backend CPU and memory, uploaded bytes, and cache hits. Separate cold startup from warm execution.
- Create representative fixtures: short clips, rapid swipes, repeated videos, speech with background music, silence, weak metadata, and unsupported languages.
- Choose configurable transcript latency, minimum useful speech duration, maximum audio budget, upload limits, and worker concurrency. Establish acceptable browser overhead and assessment-quality thresholds before tuning.
- Confirm the hosted Gemma 4 provider, exact model ID, API format, structured-output support, rate limits, and evidence-retention behavior. Keep credentials in backend environment configuration.

**Completion criteria:** a reproducible baseline and explicit targets exist; provider-specific assumptions are documented before integration.

## 2. Define evidence contracts and durable job ownership

Suggested locations: `backend/app/models/`, `backend/app/routes/local_sessions.py`, `backend/app/services/local_sessions.py`, and a new audio ingestion service.

- Begin a video session when a detected video starts playing, rather than waiting for Finish. Supply its ID with the playback/detection event: `yt_<source_id>` for YouTube and `ig_<source_id>` for Instagram. For example, `/shorts/yiHuaBpxCnk` yields `yt_yiHuaBpxCnk`, and `/reels/De2LqqehV3x/` yields `ig_De2LqqehV3x`. URL detection alone must not imply playback or captured audio.
- Treat these IDs as stable identities unique to a platform/video. Repeated playback uses the same video-session ID and separate occurrence IDs linking the review session, tab, and capture generation. Preserve separate replay/loop capture occurrences, even when their media intervals overlap.
- Keep the existing aggregate scrolling/review session UUID distinct from the video-session ID. Define both fields explicitly in ingestion, persistence, and UI contracts; preserve the UUID-based finish endpoint and immutable review snapshots.
- Register active video-session occurrences before accepting incremental evidence. When the backend is offline, queue the registration and associated evidence within the existing bounds and register before uploading segments. Keep unfinished occurrences separate from finalized reviews.
- Define segment records with occurrence ID, index, planned/captured media-relative intervals, wall-clock start/end timestamps, playback-rate changes, gaps, audio hash, language, transcript, processing state, and errors. Keep recorder elapsed time distinct from media time.
- Keep capture states separate from processing states: unavailable audio, silent audio, queued transcription, completed inference, and failed processing describe different conditions.
- Store durable segment/job references in SQLite. Use Redis as an optional cache, with SQLite retaining the session, accepted evidence, and final results.
- Add incremental audio ingestion before building the full capture path. Require bounded binary uploads and idempotent segment IDs; reject reuse of an ID with different content.
- Include the expected segment/evidence manifest in session finalization. Stop capture, flush pending segments, and either wait to a deadline or explicitly mark missing evidence. Preserve immutable finish snapshots.
- Version evidence so late workers cannot overwrite newer assessments. Recover interrupted jobs without duplicating accepted results.
- Evidence arriving after a review's cutoff must not mutate that snapshot or its topic tree. Retain explicit missing-evidence status for that review; any later reassessment must use a new evidence version.

**Completion criteria:** fixture audio can be ingested, retried, recovered, and linked to a finalized session without changing the existing finish-only workflow for sessions without audio.

## 3. Implement a duration-based segmentation policy

Suggested location: a pure segmentation module shared through a documented contract between the extension and backend.

Use known finite video duration `D` and a benchmark-derived target duration `t`:

```text
n = max(1, ceil(D / t))
segment_length = D / n
start(i) = i * D / n
end(i) = (i + 1) * D / n
```

- Derive `t` from measured transcription speed and the latency target, using the report's overhead/real-time-factor approximation as a starting point.
- Reserve latency for decoding, upload, queueing, and downstream processing. Do not present the approximation as a guaranteed deadline.
- Reject invalid durations, impossible budgets, and counts that create empty sample ranges. Use shared integer sample boundaries to prevent rounding gaps.
- Keep full-coverage segmentation and sparse sampling as explicit modes. For sparse sampling, use evenly spaced regions and cap total selected audio using the report's budget formula.
- Ensure samples remain long enough for usable speech context. If latency and minimum duration conflict, change the model or target rather than creating many tiny chunks.
- For unknown duration, use rolling windows and flush a partial final segment. Freeze the plan per encounter and version changes caused by seeking or duration updates.
- If the viewer leaves early, preserve captured portions and mark later regions unavailable. Never capture unwatched regions by silently seeking.

Use media-relative timing with wall-clock timestamps for each actual capture interval:

| Event | Required behavior |
| --- | --- |
| Pause | Media time freezes; capture clock continues. Paused wall time does not count as traversed media coverage. |
| Buffering | Mark a gap; do not assume audio was captured. |
| Playback speed | Track the actual media-time interval traversed and the rate changes needed to map transcript offsets back to media time. |
| Seek forward | Create a new interval; do not invent skipped audio. |
| Replay/loop | Preserve separate capture occurrences with overlapping media intervals. |
| Tab switch | Continue only if audio is genuinely captured. |
| Audio interruption | Mark the interval as missing or uncertain. |

- Map ASR offsets from decoded segment time to the recorded media intervals rather than adding one fixed start offset across discontinuities. Calculate coverage from captured intervals, not wall-clock duration; report repeat capture separately from unique media coverage.

**Completion criteria:** boundaries cover the intended intervals without gaps or unintended overlap; short clips, early exits, seeking, unknown duration, and sample-budget limits behave predictably.

## 4. Benchmark and integrate local transcription

Suggested location: a new backend ASR module and worker, with configuration/dependencies in the existing backend files.

- Benchmark Whisper `base.en` through faster-whisper with CPU INT8 as the initial candidate. Compare `tiny.en` for latency and `small.en` for accuracy; evaluate multilingual alternatives when needed.
- Measure transcription through full iteration of returned segments. Include model loading separately, and keep the selected model warm between jobs.
- Compare transcript accuracy and processing time over several chunk durations. Tune voice activity detection and decoding settings using actual clip audio.
- Preserve timestamps and explicit silence/failure results. Avoid treating a missing transcript as proof that no speech occurred.
- Define and version a transcript-usability gate using benchmarked recognition quality and contextual specificity. Missing, failed, unsupported-language, or vague transcripts are excluded from sentiment and assessment inputs, with an explicit exclusion reason. Do not invent transcript content or count excluded text as analyzed speech.
- When transcripts are unusable, evaluate using the other available evidence, including title, caption, source metadata, and comments. Mark assessment evidence insufficient only when the remaining evidence is also vague or unusable. A usable transcript can support assessment without a usable title/caption; remove the current metadata-only eligibility gate. Topic eligibility remains a separate decision in phase 8.
- Start with bounded ASR concurrency and a reusable model instance. Check contention with local RoBERTa before increasing workers.
- Delete raw audio after successful processing or expiry according to a documented policy; retain bounded text evidence and provenance.

**Completion criteria:** the selected model meets the agreed quality/latency targets on the target machine, and queue growth remains bounded during continuous playback.

## 5. Add Redis caches and the RoBERTa analysis map

Suggested locations: a new cache adapter, `backend/analysis/analyzer.py`, and `backend/app/services/local_sessions.py`.

- Cache comment snapshots by user scope, platform, video, query parameters, and freshness window.
- Cache text inference by pinned RoBERTa revision, preprocessing version, language, and normalized-text hash. Include ASR model/configuration in transcript cache identities.
- Build `analysis_by_id`, keyed by comment or transcript evidence ID. Store source text, source type, label, all sentiment scores, text hash, model revision, and timestamps where applicable.
- Separate reusable inference identities from encounter-specific evidence identities so repeated text reuses computation without losing attribution.
- Use bounded Redis hashes or individual keys with TTLs. Prevent concurrent misses from starting duplicate work, and do not store failures as successful empty analyses.
- Preserve one loaded RoBERTa instance with a serialized inference boundary initially. Microbatch comment and transcript requests with a maximum queue wait.
- Keep transcript and audience-comment aggregates separate. Preserve explicit token limits and truncation indicators.
- Fall back to bounded computation when Redis is unavailable. Persist the accepted assessment evidence in SQLite.
- Require evidence, model, and prompt/schema version checks at every reuse boundary, including completed-video shortcuts, final assessments, and topic checkpoints. Include preprocessing, transcript-usability, and evidence-selection versions where applicable. For stages without a prompt, record that explicitly. A `complete` status alone never permits reuse; missing legacy version information is a cache miss.

**Completion criteria:** unchanged evidence skips inference; edited text and model/preprocessing changes invalidate reuse; Redis failure does not lose sessions or block all reviews.

## 6. Integrate hosted Gemma 4 and evidence selection

Suggested locations: a new provider adapter, `backend/analysis/model_output.py`, `backend/analysis/video_assessment.py`, backend configuration, and UI response types.

- Add a hosted Gemma provider with configured endpoint/model, bounded timeouts, concurrency, retries, and output size. Keep keys exclusively in the backend.
- Disable assessment web search to reduce latency: bypass the existing `get_web_context` call, send no search snippets, and enable no provider browsing/search tools. Report web context as disabled and include this policy in the assessment configuration fingerprint. Verify that assessment makes no search requests even when the old web-search environment flag is enabled.
- Update provider enums and error handling while preserving strict JSON/schema validation and provenance. Treat hosted Gemma as distinct from the existing Gemini fallback.
- Select a bounded supporting-comment sample from the analysis map using relevance, sentiment diversity, and deduplication. Retain neutral and positive context alongside negative reactions.
- Send metadata, usable transcript excerpts, segment coverage, supporting comment text and scores, separate sentiment summaries, and missing/excluded-evidence flags. Use the metadata fallback from phase 4 when transcripts are absent or vague.
- Require evidence references for assessment explanations and distinguish speech from unverified audience claims. RoBERTa sentiment should support interpretation rather than serve as a harmfulness verdict.
- Validate cited IDs against the exact evidence snapshot submitted to that request. Reject unknown or excluded evidence IDs and transcript ranges outside the submitted excerpt or crossing missing/uncertain intervals; validate occurrence ownership when media intervals overlap. Apply the existing untrusted-input rules to transcripts as well as metadata/comments, and test embedded instructions in speech and comments.
- Fingerprint all meaningful inputs: transcript/comment hashes, model identity, prompt/schema, and evidence-selection version.
- Produce one final assessment per finalized evidence version. Publish incremental local results while waiting, and retain them when the hosted call fails.
- Keep completed-session topic discovery separate. Decide explicitly whether its model provider also changes; preserve hierarchy validation and bounded evidence packing.

**Completion criteria:** hosted assessments accept the intended evidence, reject malformed output, retain provenance, and can be retried without discarding local analysis.

## 7. Add Chrome audio capture and incremental delivery

Suggested locations: `chrome-react/public/manifest.json`, `background.js`, `content.js`, and new offscreen document/script files.

- Add audio capture behind a feature flag, initially for one selected tab. Use an explicit supported extension invocation and show recording state and stop controls.
- Add `tabCapture`/`offscreen` permissions and let an offscreen document own the stream and encoder. Preserve normal playback audio and release tracks on stop.
- Synchronize video identity and media timestamps with the recorder. Supplement URL polling with playback/navigation signals and generation IDs.
- Finalize independently decodable `.mp3` audio segments with `audio/mpeg` content. Select and benchmark an actual MP3 encoder/conversion path; renaming another container to `.mp3` does not satisfy the contract. Document the chosen channel count, sample rate, and bitrate, validate decoded audio at ingestion, and bound decoded duration as well as uploaded bytes. Include encoding/conversion latency and encoder delay in timing validation.
- Split or reject chunks spanning uncertain video boundaries instead of guessing their owner. Preserve the media/wall-clock mapping and interruption behavior defined in phase 3 through encoding and transcription.
- Send completed segments to the incremental ingestion path while metadata/comments are collected. Bound pending uploads, bytes, retry attempts, and local retention.
- Preserve metadata-only operation when capture is unavailable or disabled. When the backend is offline, use a bounded temporary audio queue with explicit expiry/drop status; do not grow an unlimited backlog.
- Flush on finish, tab closure, or navigation. Show actual captured/transcribed coverage and incomplete evidence in both review interfaces that expose session results.

**Completion criteria:** rapid scrolling never silently attributes speech to the wrong video; playback stays usable; closing the popup does not stop backend processing; capture stops cleanly.

## 8. Tune parallelism and integrate the final review

- Overlap metadata/comment I/O with capture and ASR. Feed completed text to RoBERTa while later audio is collected.
- Give ASR, RoBERTa, hosted calls, and uploads separate concurrency limits. Keep CPU-heavy work outside the FastAPI event loop.
- Add queue backpressure and fair scheduling so a long clip does not block every short encounter.
- Benchmark worker counts and batch sizes with both local models active. Increase parallelism only when it improves measured latency/throughput.
- Aggregate repeat views without duplicating unique-video topic counts. Define which accepted encounter evidence contributes to the unique video's final assessment.
- Finalize topic discovery only after the session evidence cutoff. Include bounded transcript-derived context for transcript-only videos if supported, and preserve retry checkpoints and coverage rules.

**Completion criteria:** evidence dependencies are respected, processing makes progress under load, and final review/tree behavior remains consistent with recorded sessions.

## 9. Validate and roll out incrementally

Compare four configurations using the same fixtures: current pipeline, cached/microbatched text processing, hosted Gemma without audio, and the complete audio pipeline.

| Validation area | Required checks |
| --- | --- |
| Segmentation and timing | Equal boundaries, partial clips, sample budgets, unknown duration, pauses, buffering, speed changes, seeks/loops, tab switches, interruptions, and MP3 offset mapping |
| Attribution and identity | Playback-triggered registration, `yt_`/`ig_` namespaces, repeat occurrences, fast swipes, advertisements, stale messages, navigation, and tab closure |
| ASR and sentiment | Silence, noisy speech, language handling, transcript accuracy, vague-transcript exclusion, metadata fallback, transcript-only assessment, and separate source aggregates |
| Cache correctness | Hits, expiry, edited text, evidence/model/prompt-version changes at every boundary, completed-video reuse, topic checkpoints, legacy unversioned results, duplicate misses, and Redis outage |
| Recovery | Restart during ingestion/inference, duplicate uploads, immutable finish snapshots, and late results |
| Hosted assessment | Invalid output, unknown evidence IDs, invalid transcript ranges, prompt injection in speech/comments, disabled web search, deadlines, rate limits, retained local evidence, and evidence-version caching |
| Performance | Median/p95 latency, sustained queue depth, browser CPU/memory, playback quality, and hosted cost |

- Add focused unit tests for segmentation/cache identities and integration tests for evidence ingestion, recovery, and provider failure behavior.
- Run existing backend and extension lifecycle tests to protect session completion, category identities, preferences, and partial retries.
- Enable caching first, hosted assessment second, and audio capture last. Keep each capability independently configurable.
- Update setup documentation with Redis, model downloads, provider settings, capture permissions, retention, and measured limitations.
- Keep audio capture experimental until quality improves without exceeding agreed browser overhead and latency targets. Roll back individual features when their criteria fail.

**Final acceptance:** demonstrate measured results against the baseline, preserve recoverable sessions and valid topic trees, and document the actual sampling coverage, supported languages, hardware, model revisions, and provider used.
