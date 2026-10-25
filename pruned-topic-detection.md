# Pruned-topic reminders

Real-time detection uses **Groq only**, defaulting to `openai/gpt-oss-20b`. Errors and timeouts produce no reminder; detection does not fall back to Gemma, Gemini, Navigator, or Ollama. Existing end-of-session assessment and discovery retain their configured providers. Groq also checks proposed taxonomy meanings against pruning constraints before persistence.

## Setup

1. Set `GROQ_API_KEY` in the repository root `.env`. The key is read only by the backend.
2. Optionally configure the settings below; their defaults are in `.env.example`.
3. Restart the backend using the existing development launcher.
4. Build with `npm --prefix chrome-react run build`, then reload `chrome-react/dist` on `chrome://extensions`. Refresh existing YouTube/Instagram tabs so they load the new content scripts.
5. Prune a topic in your saved tree, start tracking, and watch an eligible video. Under Settings, **Detection delay** accepts 1.5–10 seconds in 0.5-second increments, defaulting to 1.5 seconds. Changes apply to open tabs immediately and restart the wait; session collection thresholds remain independent.

| Backend environment variable | Default |
| --- | --- |
| `GROQ_API_KEY` | Unset; required for inference |
| `GROQ_DETECTION_MODEL` | `openai/gpt-oss-20b` |
| `DETECTION_TIMEOUT_SECONDS` | `6` |
| `DETECTION_COMMENT_TIMEOUT_SECONDS` | `0.75` |
| `DETECTION_CONFIDENCE_THRESHOLD` | `0.85` |

No new dependencies are required. The implementation uses `httpx`, Pydantic, and browser APIs. The Groq request follows its [structured output contract](https://console.groq.com/docs/structured-outputs).

## Runtime behavior

The detector independently tracks IDLE → WAITING → ANALYZING → COMPLETED, with invalidation on video changes, lost visibility, paused/buffering playback, preference changes, or delay changes. It reuses active-video selection and DOM ownership checks, with navigation/media/scroll events and a mutation observer rather than another polling interval.

After the configured delay, the content script supplies attributable metadata and up to ten available Instagram comments. The backend can fetch a bounded YouTube comment sample with a short deadline. Comments are optional supporting context. Audio, transcripts, images, and sentiment are excluded from detection.

`GET /detection/state` reports the authoritative blacklist version, topic count, and whether Groq is configured. `POST /detection/check` loads the blacklist server-side, validates model output and topic IDs, and rechecks the version after inference. Only a valid `MATCH` above the configured threshold can set `notify: true`.

The background worker owns one abortable request per tab. It deduplicates identical requests and stores at most 200 completed results in session storage, using platform/video/version keys. Normal results expire after 30 minutes; uncertain results after 15 seconds, and added evidence can bypass an uncertain cache entry. Evidence signatures are hashed. The content script allows one timed uncertain/error retry per visit, checks current identity again before display, and deduplicates reminders by viewing session/video. The overlay is dismissible, lasts four seconds, and does not control playback.

Browser debug logs report evidence and total request duration. Backend logs report inference duration, total duration, and outcomes without logging collected text or credentials.

## Persistent pruning

`TopicStore` remains authoritative. Its existing categories, aliases, descriptions, preference records, and hierarchy survive normal pruning. A blacklist fingerprint changes with category semantics and pruning decisions. Preference writes publish this version through Chrome storage, invalidate browser work immediately, and pause detection while the update is pending. Pending markers have a recovery deadline in case a review page closes during a write.

Parent pruning covers descendants. Child pruning preserves its parents and siblings. Exact identities/names/aliases resolve first. Groq then checks other proposed meanings, with cached comparison results. Confirmed equivalents resolve to the pruned identity; earlier equivalent records receive a suppression relationship while retaining their history. Known ancestors are broader by hierarchy and do not require semantic inference.

If a new category cannot be checked because Groq is unavailable, evidence and the category record are retained, but the new branch is deferred from the visible graphical tree while the relevant pruning remains active. Existing broader/sibling categories are preserved during outages. Deferred checks can be reassessed in later discovery or released by restoring the relevant pruning preference. A full tree reset intentionally clears preferences, guards, and comparison caches, following existing reset behavior.

Session evidence and audio recording remain independent of reminders. Detection does not create categories, update preferences, or write session evidence.

## Files

- `backend/analysis/pruned_detection.py`: Groq matching and category comparison.
- `backend/app/routes/detection.py`: state and detection endpoints; registered in `backend/app/main.py`.
- `backend/analysis/topic_store.py`: blacklist snapshots, versions, semantic comparison cache, and persistent suppression relationships.
- `backend/analysis/session_review.py`: pruning semantics included in completed-session batch cache identity.
- `backend/app/config.py`, `.env.example`: backend configuration.
- `chrome-react/public/detection-core.js`: independent timing lifecycle and setting validation.
- `chrome-react/public/detection.js`: page evidence adapter, invalidation, reminder UI, and deduplication.
- `chrome-react/public/detection-background.js`: request ownership, cancellation, cache, and version checks.
- `chrome-react/public/background.js`, `chrome-react/public/manifest.json`: worker registration and content script loading.
- `chrome-react/sidepanel.html`, `chrome-react/public/sidepanel.js`: accessible persistent delay setting.
- `chrome-react/src/tree/TopicGarden.tsx`, `chrome-react/src/tree/types.ts`: preference synchronization.
- `backend/tests/test_pruned_detection.py`, `chrome-react/tests/detection*.test.cjs`: provider/API/store and browser timing/worker tests.
- `backend/analysis/benchmark_pruned_detection.py`, `backend/tests/fixtures/pruned_detection_examples.json`: opt-in labeled live evaluation.
- `chrome-react/dist`: generated extension build.

## Verification

Initial automated validation on October 25, 2026: **155 backend tests and 60 subtests passed; 14 JavaScript lifecycle/worker tests passed; extension lint and production build passed.** After fixing Groq's nullable topic-ID wire schema, **26 focused backend tests passed**, and the live Groq evaluation produced **8/8 expected outcomes**. Interactive Chrome behavior remains unverified.

The Groq wire schema uses `type: ["string", "null"]` and an enum containing candidate IDs plus null. The previous nested `anyOf`/enum schema caused HTTP 400 `json_validate_failed` for valid non-match results with a null topic ID. Backend validation still checks allowed IDs and status/topic consistency. Provider failures log only HTTP status and a bounded machine error code; response bodies and generated text are excluded.

From the repository root:

```powershell
backend/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
node chrome-react/tests/detection.test.cjs
node chrome-react/tests/detection-background.test.cjs
npm --prefix chrome-react run lint
npm --prefix chrome-react run build
```

To evaluate real matching with a configured key, run from `backend`:

```powershell
.venv/Scripts/python.exe -m analysis.benchmark_pruned_detection
```

Live evaluation uses Groq credits and prints per-case outcomes without raw comments. Mocked tests verify request handling and suppression decisions, not model accuracy.

Manually verify both Shorts and Reels: rapid skipping; watching beyond the selected delay; scrolling away during inference; returning to a cached video; changing the delay or pruning during inference; missing comments; dismissal; restoration; and finishing/reviewing a session with audio enabled.

## Limits

- This follows the repository's **single local user** (`local_extension`) flow. There is no account authentication or cross-device isolation. Client-supplied user IDs are rejected. A shared deployment needs server-verified identity throughout preference and detection endpoints.
- All pruned topics are included while their serialized snapshot fits 24,000 characters. Larger inputs return uncertain rather than declaring no match from incomplete lexical candidates. No vector database is introduced.
- Semantic decisions and confidence remain model estimates. The labeled examples are a small starting evaluation set, not calibrated accuracy guarantees.
- Metadata extraction depends on host-page DOM ownership. Missing or uncertain attribution produces no reminder rather than guessing from a stale page title. Platform DOM changes require manual verification and may require selector updates.
- Chrome storage synchronizes this extension's preference writes. External API writers are detected at the next state refresh or detection request; there is no server push channel.
- Aborting the browser request does not guarantee cancellation of Groq's work. Stale results are discarded independently.
- Live evaluation covers only eight synthetic examples and does not establish general accuracy. Interactive Chrome checks still require a loaded extension; no interactive browser tooling was available during implementation.
