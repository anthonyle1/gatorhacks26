# Analysis and completed-session topics

While scrolling, the extension records video identities, dwell time, and available titles/captions. The extension keeps events and captured Instagram comments in Chrome storage. On completion the local backend fetches available YouTube metadata/comments, computes RoBERTa sentiment, assesses individual content, and discovers session topics without MongoDB. No topic discovery runs on event upload or on an individual video assessment.

**Finish and review session** uploads the last video, completes the backend session, and queues topic discovery. Gemma groups the session's videos into a dynamic tree. The React extension shows expandable branches, unique video counts, source videos, saved **See less** preferences, and the validated session JSON. Selecting a parent includes descendants; selecting a child affects that branch. Preferences persist for future matching. The extension does not yet hide videos or modify platform recommendations.

## Setup

From the repository root in PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env # Only if .env does not already exist
```

Configure `YOUTUBE_API_KEY` in `backend/.env` for YouTube metadata and comment fetching. The extension's default review path requires **no MongoDB URI, connection, or seeded user**. Without a YouTube key, captured title/caption data can still support topics; missing comment/context results are explicitly marked unavailable.

`MONGODB_URI`/`MONGODB_DB` are optional for legacy `/sessions`, `/videos`, and Instagram persistence endpoints. `MONGODB_SESSION_JOBS_ENABLED=true` enables recovery of legacy MongoDB jobs; it defaults to false. The local session worker runs independently.

Install Ollama and download the configured local model:

```powershell
ollama pull gemma4:e2b
```

Keep Ollama running; run `ollama serve` if needed. These settings apply to content assessment and session discovery:

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:e2b
OLLAMA_TIMEOUT=300
GEMINI_FALLBACK_ENABLED=true
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT=60
```

Gemini requires a server-side key with access to the configured model. After a local failure, hosted fallback receives the same bounded video evidence and candidate category metadata. Set `GEMINI_FALLBACK_ENABLED=false` to keep model evidence local. Restart the backend after configuration changes. Do not put API keys in extension files.

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

`GET /local-sessions/health` verifies local storage and returns `mongodb_required: false`. The older `GET /health` checks MongoDB only; its 503 does not block extension session reviews. The model checks below work independently of MongoDB:

```powershell
python -m analysis.ollama_client --check
python -m analysis.ollama_client "Reply with exactly: local prompting works"
```

The first lists installation status; the second verifies inference. `GET /analysis/ollama/status` and `POST /analysis/prompt` provide equivalent API access.

Build and load [the React extension](../../chrome-react/README.md) to finish and review sessions. The single-video [test dashboard](../../test-dashboard/README.md) remains available for inspecting comment sentiment and content assessment.

## Contracts and pipeline

`POST /analysis/video-assessment` accepts `title`, `caption`, optional `sentiment_balance`, and up to 12 comment objects (`text`, optional sentiment/confidence). It returns:

```json
{
  "negative_for_user": "uncertain",
  "reason": "The available evidence does not establish a negative impact.",
  "context_summary": "A tutorial demonstrates React components.",
  "content_signals": [],
  "signal_polarities": {},
  "web_search": {"status": "disabled", "query": null, "sources": [], "warning": null},
  "provider": "ollama",
  "model": "gemma4:e2b",
  "fallback_used": false,
  "fallback_reason": null
}
```

There are no topic, category, or subcategory fields in this response. Existing clients expecting the old topic schema need updating. `taxonomy.py` now defines only fixed content signals and their positive/negative polarity. `GET /analysis/taxonomy` exposes those signals and declares `classification_scope: completed_session`; its legacy `categories` list is empty.

RoBERTa's aggregate sentiment balance remains `(positive_count - negative_count) / (positive_count + negative_count)`, excluding neutral comments. Empty/all-neutral samples have null balance. The balance measures direction, not severity or sample size. Comments are supporting context, not verified evidence of a video's subject.

The assessment can also be run directly:

```powershell
python -m analysis.video_assessment --title "A React tutorial" --caption "Building reusable components" --sentiment-balance 0.5 --comment "Helpful explanation"
```

`OLLAMA_WEB_SEARCH_ENABLED=true` and server-side `OLLAMA_API_KEY` optionally enable the existing bounded web search for individual content assessment. Search is disabled by default. Session discovery does not issue web searches; it uses collected evidence and supported metadata. The model cannot choose URLs, run tools, or execute commands.

The extension now uses these MongoDB-free endpoints:

| Request | Behavior |
| --- | --- |
| `POST /local-sessions/{uuid}/finish` | Accept an immutable snapshot of `events` (existing video event format) and optional `instagram` evidence, persist locally, and queue analysis. Returns 202 immediately. Repeating an identical snapshot is safe; changing it under the same ID returns 409. |
| `GET /local-sessions/{uuid}/taxonomy` | Read progress, the topic tree, unique video counts, and individual `videos[].analysis` results. |
| `POST /local-sessions/{uuid}/taxonomy/retry` | Retry a partial/failed review, preserving successful work and reusing unchanged model evidence. |
| `PATCH /local-sessions/{uuid}/taxonomy/preferences` | Save a category preference. |
| `PATCH /local-sessions/{uuid}/taxonomy/categories/{id}` | Rename, move, or merge a local category. |

Local review jobs and results use the same `backend/.cache/session_topics.sqlite3` file as category identities. Each video's analysis contains its content assessment (including provider/fallback flags), sentiment summary, bounded comment sample, and explicit errors for unavailable evidence/providers. Failures preserve videos and available results; they do not fabricate scores or discard the whole summary. Video identities, repeat-view counts, and dwell time remain separate from topic membership. Individual assessments do not output topic labels.

A local worker polls pending jobs every 10 seconds and renews processing leases every 30 seconds. Expired leases older than 15 minutes can be resumed after restart. Successful individual assessments are reused on retries with unchanged evidence; topic batches are checkpointed by evidence fingerprint. Closing the popup does not interrupt backend work. The latest fetched summary is cached in Chrome for offline viewing. Reopening a popup after a backend restart will refresh it from local storage.

Legacy MongoDB sessions remain available separately through these endpoints:

| Request | Behavior |
| --- | --- |
| `POST /sessions` | Create an active session for an existing user. |
| `POST /sessions/{id}/events` | Persist events and queue metadata/sentiment work, without topic discovery. |
| `PATCH /sessions/{id}/finish` | Complete and queue discovery atomically; repeating finish does not queue another job. |
| `GET /sessions/{id}/taxonomy` | Read processing status, tree, assignments, video identities, preferences, and provider provenance. Active sessions return 409. |
| `POST /sessions/{id}/taxonomy/retry` | Retry failed/partial discovery, reusing successful batches. |
| `PATCH /sessions/{id}/taxonomy/preferences` | Save `{"category_id":"stable-id","reduce":true}` for the session owner. |
| `PATCH /sessions/{id}/taxonomy/categories/{category_id}` | Rename with `{"name":"React Tutorials"}`, move with `{"move":true,"parent_id":"parent-id"}` (null for root), or merge with `{"merge_into":"target-id"}`. |

Topic results contain `status` (`pending`, `processing`, `complete`, `partial`, `failed`, or `insufficient_data`), a recursive `tree`, `assignments` mapping video IDs to stable category IDs, `unclassified_video_ids`, and source `videos`. Nodes contain `id`, `name`, `description`, `parent_id`, `video_count`, `video_ids`, `children`, and preference flags `selected`, `inherited`, and `reduce`. Parent counts use the union of descendant video identities, even when videos belong to multiple branches. Video identities include their platform (`youtube:ID` or `instagram:ID`).

Each accepted batch reports provider/model/fallback provenance in `batches`; `fallback_used` summarizes accepted Gemini results. The popup flags Gemini use. Failed batches remain explicitly unclassified and retain their error instead of accepting malformed output.

## Dynamic identities and bounded discovery

`session_classification.py` discovers topics from the completed session, with no fixed topic list. It requests meaningful variable depth, reusable genres/game titles/interests, and supported distinctions rather than categories describing individual clips. Sparse groups use general supported categories (for example Programming, Gaming, or Music). The prompt normally asks for at least two distinct related videos before creating a niche label; repeat views do not provide extra support. Larger sessions may mix broad categories for isolated interests with niche branches for recurring interests. This is model guidance, not a hard-coded topic list or a guarantee of perfect granularity. The eight-level depth limit is a safety ceiling, not a required hierarchy shape. Comments alone cannot make a metadata-free video eligible.

Large sessions are split into batches of at most 12 videos and 7,000 serialized evidence characters. Individual evidence fields are excerpted; identities are retained. Each batch includes up to 24 candidate categories within a separate 5,000-character budget. Discovery uses a 16,384-token context window and bounded output. Thus large sessions require multiple bounded calls after completion, rather than one call per video. Earlier batches feed the persistent catalog used by later batches. Grouping quality depends on available excerpts and model output.

`topic_store.py` stores the user-scoped catalog, aliases, preferences, batch checkpoints, and completed results in `backend/.cache/session_topics.sqlite3` using SQLite and parameterized statements. Keep this file when restarting or updating the app: deleting it loses category identities and preferences. Back it up along with MongoDB. It is ignored by Git. This local store assumes backend processes share the same disk; a distributed deployment would need a shared transactional store.

The catalog first retrieves candidates using lexical overlap. Gemma/Gemini then compares meanings and explicitly references existing stable IDs for semantic reuse. Exact normalized names/aliases under the same parent provide another duplicate check. This is model-assisted semantic matching, not an embedding index, and can miss synonyms outside the bounded candidate set. Users can merge duplicates in the popup. Rename/reparent preserve IDs; merge aliases redirect old assignments/preferences to the surviving ID. Reusing a category without supplying its ancestors preserves its existing parent.

Structured JSON is validated before persistence: duplicate keys, unknown IDs, extra fields, cycles, orphan parents, empty unsupported nodes, incomplete coverage, duplicate assignments, and invalid category references are rejected. One local regeneration is allowed, then Gemini is tried for provider failures or invalid output. Output is data only; it is never evaluated or executed. React displays text/JSON without HTML injection. No model-generated network actions are allowed.

MongoDB records pending/processing/final session status. An atomic claim prevents duplicate workers. Startup recovery polls every 30 seconds; processing leases older than 15 minutes are retried, with a heartbeat while work runs. Successful batch checkpoints avoid repeated inference on explicit retries. Insufficient metadata produces an explicit result without calling the topic model. Finishing does not wait for every in-flight per-video sentiment job; discovery uses evidence available at collection time and fetches missing YouTube metadata when possible.

Local reviews use the `local_extension` catalog on this backend; legacy MongoDB sessions retain their existing user identities. This development app does not provide account authentication.

## Checks

From `backend/`:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest tests -q -p no:cacheprovider
```

Tests cover content-only assessment, strict output handling, fallback provenance, session lifecycle, hierarchy integrity, identity reuse, parent/child preference behavior, catalog edits, input bounds, partial retries, and batch caching. Provider failure tests use mocks; they do not establish hosted service availability.

## Guaranteed video coverage

Every nonempty completed review assigns every video to at least one category. Broad, supported topics are preferred when niche evidence is sparse. Videos without usable metadata, model abstentions, and videos in failed provider batches are assigned by application code to a stable **General / Other** category. This category describes an unavailable topic, rather than inventing one. `fallback_video_ids` identifies these application-assigned videos; `unclassified_video_ids` is empty in completed review results. Provider errors and partial/failed/insufficient-data status remain visible, and retry can replace the fallback with a supported topic. Historical saved reviews are not regenerated automatically.
