# Real-Time Pruned-Topic Detection Implementation Plan

Implementation is in the extension and backend. See [setup, behavior, verification, and limitations](pruned-topic-detection.md). Live Groq matching and interactive browser acceptance checks still require a configured key and a loaded extension.

## Goal

Remind users when a video substantially matches a topic they previously pruned. Analyze only after a user-configurable duration of continuous visible playback, defaulting to 1.5 seconds and adjustable from 1.5 to 10 seconds in the extension's Settings tab. Use Groq with `openai/gpt-oss-20b` and show a dismissible reminder for four seconds after a confident match.

Preserve session recording, evidence collection, audio capture, and existing end-of-session analysis. Detection must never pause, skip, hide, blur, or otherwise control videos.

## Existing repository integration points

| Area | Existing files and behavior |
| --- | --- |
| Video lifecycle | `chrome-react/public/content.js`: `getCurrentVideo()`, `trackScrolling()`, `getActiveInstagramVideo()`, and `mediaClock()` identify videos and inspect playback. Tracking currently uses intervals. |
| Video evidence | `content.js`: `readVideoMetadata()` and Instagram comment extraction. `backend/app/youtube.py` contains YouTube metadata/comment utilities. |
| Extension requests | `chrome-react/public/background.js`: `apiRequest()`, runtime message handlers, local recording, and session completion. |
| Persistent preferences | `backend/analysis/topic_store.py`: SQLite categories, descriptions, aliases, stable IDs, hierarchy, and `topic_preferences`. Parent pruning already propagates through `view()`. |
| Preference UI | `chrome-react/src/tree/TopicGarden.tsx`: reads and updates `/local-sessions/taxonomy/preferences`, then caches tree data in Chrome storage. |
| Tree rendering | `chrome-react/src/tree/TopicTree.tsx`: filters reduced branches from the graphical tree and supports restoration. |
| Session classification | `backend/analysis/session_classification.py`, `backend/analysis/session_review.py`, and `backend/app/services/local_sessions.py`. |
| API registration | `backend/app/main.py`: FastAPI application and router registration. |

The backend is FastAPI, not Django. The current extension path uses `LOCAL_USER = "local_extension"`; it does not provide authenticated accounts. The MVP can follow this local ownership model, but must not claim authenticated per-user isolation. Supporting multiple users requires server-verified identity for both preference writes and detection reads; a client-supplied user ID is insufficient.

## Step 1 — Confirm lifecycle and ownership boundaries

- Trace active-video changes on YouTube Shorts and Instagram Reels, including SPA navigation, rapid scrolling, pauses, buffering, tab switches, and page exit.
- Verify that title/caption extraction belongs to the active video. Page-level Open Graph metadata can lag during SPA navigation; prefer active-video container metadata when available and treat uncertain attribution as missing evidence.
- Confirm the existing pruning, restore, rename, merge, move, and full-tree-reset behavior.
- Keep real-time detection independent of `VIDEO_EVENT`, `INSTAGRAM_COMMENTS`, the session `syncQueue`, audio state, and session classification jobs.
- Limit source edits to `chrome-react` and the backend; generated extension files in `chrome-react/dist` should come from the build.

## Step 2 — Expose the authoritative blacklist and its version

Extend `backend/analysis/topic_store.py` rather than creating another preference store.

- Add a method returning explicitly pruned categories with IDs, names, descriptions, aliases, ancestor context, and relevant descendant context.
- Reuse existing preference inheritance: pruning a parent covers descendants; pruning a child leaves its parent and siblings eligible.
- Preserve category records even when they disappear from the visible graphical tree.
- Add a durable version or deterministic fingerprint covering effective pruning semantics, including relevant hierarchy, aliases, and descriptions.
- Ensure prune, restore, relevant rename/move/merge changes, and reset update that version.
- Return the version with taxonomy/preference responses and a lightweight blacklist-state response, without requiring a completed review session.
- Keep full-tree reset as the existing explicit operation that clears preferences; ordinary pruning must not clear history.

## Step 3 — Define a bounded detection API

Create `backend/app/routes/detection.py` and register it in `backend/app/main.py`.

- Add `POST /detection/check` with strict Pydantic request and response models.
- Accept platform, stable video ID, unique request ID, expected blacklist version, title, caption, and a bounded comment sample.
- Load authoritative topics on the server. Do not trust topics or user ownership supplied by the extension.
- Return `MATCH`, `NO_MATCH`, or `UNCERTAIN`, along with matched topic ID or null, confidence, a brief reason, request identity, and the blacklist version used.
- Validate confidence bounds, status/topic consistency, text lengths, and candidate IDs.
- Reject or explicitly mark outdated blacklist versions. Recheck the version before returning an actionable match.
- When no topics are pruned, skip inference entirely.
- Treat provider failures as unavailable/uncertain outcomes; never convert failure into a confident `NO_MATCH`.

## Step 4 — Add a separate Groq matching service

Create `backend/analysis/pruned_detection.py`; add a small provider module only if it makes the implementation clearer.

- Use the existing `httpx` dependency and backend settings conventions.
- Configure the API key through backend environment variables, with a default model of `openai/gpt-oss-20b`.
- Verify the provider's current request and structured-output contract before implementing its HTTP call.
- Send a compact prompt asking only whether the video substantially concerns a supplied pruned topic.
- Treat title/caption as primary evidence and comments as supporting context. Comment sentiment and incidental mentions must not establish a match.
- Mark all supplied text as untrusted data; do not follow embedded instructions.
- Use short connection/request deadlines and a bounded output token budget. Validate JSON and returned topic IDs independently of provider formatting controls.
- Start notification eligibility at confidence `0.85`; document that model confidence is uncalibrated.
- Return `UNCERTAIN` for ambiguous or insufficient evidence, malformed output, invalid topic IDs, timeouts, and rate limits.
- Keep this service separate from Gemma/Gemini assessment and taxonomy discovery.

For the MVP, send the full blacklist when it fits a bounded input budget. Existing `TopicStore.candidates()` is lexical retrieval, not embedding search. Do not assume its top three to five results cover all semantic matches. If the blacklist exceeds the budget, use a broader bounded strategy or return `UNCERTAIN` when coverage is incomplete; do not add a vector database for this feature.

## Step 5 — Add an independent engagement lifecycle

Integrate a small detector into `chrome-react/public/content.js`, or a dedicated public script loaded by the manifest if that keeps the lifecycle easier to review.

- Implement `IDLE`, `WAITING`, `ANALYZING`, `COMPLETED`, and `INVALIDATED` states.
- Reuse existing video identity and visible-media selection without reusing mutable audio/session occurrence state.
- Require continuous visible, active playback for the saved detection delay (default 1.5 seconds; range 1.5–10 seconds). Reset eligibility on video changes, hidden documents, pause, buffering, or loss of visibility.
- Use navigation, visibility, media, and intersection events for timely invalidation, with the current tracker as an additional reconciliation signal.
- Avoid a new background polling loop. Rebind observers/listeners when the active media element changes and clean them up on exit.
- Give each visit/request a fresh generation or request ID. Re-visiting the same video must not make an earlier visit's response current again.
- Cancel the engagement timer and remove any reminder immediately when the video becomes inactive.
- Keep this threshold independent of the existing configurable session collection threshold.

### Settings tab — Detection delay

- Add a labeled **Detection delay** slider to the existing extension Settings view in `chrome-react/sidepanel.html`, with behavior in `chrome-react/public/sidepanel.js` and styles following the existing settings controls.
- Set the minimum to **1.5 seconds**, maximum to **10 seconds**, and increment to **0.5 seconds**. Show the selected duration beside the slider, including a seconds unit.
- Explain the setting with: “Wait this long while a video is visibly playing before checking for topics you've pruned.”
- Persist the preference as `detectionDelaySeconds` in `chrome.storage.local`. Default missing or invalid values to 1.5 seconds; validate finite numbers, range, and supported increments before saving or using the value.
- Restore the saved value when Settings opens and provide accessible labeling, keyboard operation, and save/error feedback consistent with existing controls.
- Apply a successfully saved change immediately across open video tabs through `chrome.storage.onChanged`, without requiring a new tracking session or page reload.
- When the delay changes, invalidate pending detection, clear any reminder, and restart the engagement timer for the current eligible video from zero using the new delay. Do not launch inference directly from the setting-change event. Cached results may be reused only after the new delay is satisfied, and session reminder deduplication still applies.
- Keep this setting separate from `minimumWatchSeconds` and `sessionMinimumWatchSeconds`; changing detection timing must not change session evidence collection or audio policy.

## Step 6 — Reuse evidence with a short comment deadline

- Snapshot metadata only after confirming the active video identity.
- Reuse available comments and cached evidence; select approximately five to ten nonempty, deduplicated comments within strict length limits.
- For YouTube, reuse backend fetch helpers with a smaller bounded sample and deadline, avoiding a second browser-to-backend request where practical.
- For Instagram, reuse extraction and evidence already collected by the extension. Detection should not open comment dialogs or wait for the current collector's entire multi-second workflow.
- Proceed with available title/caption when comments are missing, delayed, or unavailable.
- Verify the request generation after every asynchronous evidence operation.
- Send no audio, transcripts, frames, images, web-search results, or sentiment analysis to this detector.

## Step 7 — Add request cancellation, deduplication, and caching

Extend `chrome-react/public/background.js` with detection-specific message handlers and state.

- Associate requests with the sender tab, platform, video ID, request ID, and blacklist version.
- Maintain at most one active detection request per tab. A new request or explicit invalidation aborts the previous fetch through `AbortController`.
- Ensure aborts and late completion cannot delete or overwrite a newer request's state.
- Deduplicate identical in-flight work without coupling cancellation between unrelated tabs.
- Cache validated results by ownership scope, platform, video ID, and blacklist version. Bound cache size and lifetime.
- Give `UNCERTAIN` results a short lifetime and allow retry when useful new evidence appears.
- Store validated completed cache entries in service-worker-safe storage if reuse must survive worker suspension; do not rely on in-memory state for notification correctness.
- Before showing a result, revalidate the content script's active video, request generation, visibility/playback, and current blacklist version.
- Do not require server-side inference cancellation for correctness. Abort browser work and discard stale results even if provider work continues.

## Step 8 — Synchronize preference changes

Update `chrome-react/src/tree/TopicGarden.tsx` and the existing preference response/cache flow.

- Publish the authoritative blacklist version in Chrome storage after a successful preference update or taxonomy refresh.
- Have background and content scripts observe version changes to invalidate pending requests, cached results, and visible reminders.
- Invalidate local detection immediately when pruning/restoration begins; resume only after authoritative preference state is known, including after a failed update.
- Refresh blacklist state when tracking starts or resumes so a restarted worker does not use stale preferences.
- Apply the same invalidation behavior to reset and relevant category edits.
- For the local MVP, document that immediate cross-client updates outside the extension require an additional server notification mechanism; do not promise synchronization that storage events cannot provide.

## Step 9 — Render the reminder

- Render a small DOM overlay from the content script, optionally isolated with a shadow root to avoid host-page style collisions.
- Use existing Prune colors and visual conventions.
- Display the canonical saved topic name with a dismiss button and four-second automatic dismissal.
- Use safe text rendering such as `textContent`; never insert model or page text as HTML.
- Make only the reminder controls interactive so normal scrolling and video controls remain usable.
- Show reminders only for validated `MATCH` results meeting the configured threshold.
- Deduplicate reminders per video within the viewing session, including revisits and manual dismissal.
- Remove the overlay on navigation, preference changes, tracking stop, and page exit.

## Step 10 — Prevent semantic duplicates in regenerated trees

Add enforcement around discovery resolution and persistence, using `backend/analysis/session_review.py`, `backend/analysis/session_classification.py`, and `TopicStore.apply_discovery()` as integration points.

- Apply canonical ID, alias, and hierarchy checks before introducing semantic checks.
- Supply persistent pruned identities as constraints when considering genuinely new categories, even if normal candidate retrieval omitted them.
- Check whether proposed new categories are equivalent to, or fall within, a pruned subject; preserve legitimate broader categories and unrelated siblings.
- Resolve confirmed equivalent categories to the existing identity. Keep confirmed covered categories under the appropriate pruned hierarchy or attach a persistent suppression relationship when reparenting would distort the taxonomy.
- Recheck deterministic pruning constraints at persistence and view construction so model suggestions cannot bypass saved decisions.
- If semantic equivalence cannot be resolved reliably, defer the questionable new category from the visible tree while preserving its evidence and a path to reassessment.
- Keep hidden categories available for restoration and future matching.
- Preserve historical evidence and assignments; detection itself must never write taxonomy changes.
- Leave existing inference providers and assessment behavior intact. The required session change is enforcement of pruning constraints around taxonomy updates.

Semantic suppression requires labeled examples and regression tests. A prompt alone does not guarantee that renamed equivalents will remain hidden.

## Step 11 — Add configuration and lightweight measurements

Update `backend/app/config.py`, `.env.example`, and relevant setup documentation.

Proposed settings:

| Setting | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Backend-only provider credential. |
| `GROQ_DETECTION_MODEL` | Default `openai/gpt-oss-20b`. |
| `DETECTION_TIMEOUT_SECONDS` | Inference deadline. |
| `DETECTION_COMMENT_TIMEOUT_SECONDS` | Maximum comment wait. |
| `DETECTION_CONFIDENCE_THRESHOLD` | Default `0.85`. |
| `detectionDelaySeconds` (Chrome local storage) | User-facing Settings slider: 1.5–10 seconds in 0.5-second increments; default 1.5 seconds. Applies immediately and independently of session collection settings. |
| Extension detector configuration | Reminder duration, comment limits, and cache lifetimes. |

Record engagement eligibility, evidence duration, inference duration, total latency, cache hits, outcomes, cancellations, and timeouts. Do not log raw comments, secrets, or full prompts. Define configuration in one place per runtime and avoid unrelated settings UI changes.

## Step 12 — Verify behavior and regressions

Add focused backend tests and extension lifecycle tests using existing tooling where available.

- Rapid skips never initiate inference; continuous eligible playback does.
- Settings defaults to 1.5 seconds, accepts 1.5–10 seconds in 0.5-second increments, persists across reopening/restarts, and rejects invalid stored/input values safely.
- Changing the delay updates all open video tabs, invalidates in-flight work, and requires the full new delay before detection or cached-result display. Verify both increasing and decreasing the delay, including at 10 seconds.
- Detection-delay changes leave session collection thresholds and audio policy unchanged; the control supports keyboard operation and clearly displays its value and save state.
- Pauses, buffering, hidden tabs, navigation, and changed media ownership reset or invalidate detection.
- Out-of-order responses and A → B → A navigation cannot produce stale reminders.
- Blacklist changes during evidence gathering, inference, and response delivery invalidate old work.
- Missing/delayed comments do not block detection or get attributed to the next video.
- Provider errors, rate limits, malformed JSON, invalid IDs, and low confidence produce no reminder.
- Cache reuse, expiry, evidence-aware uncertain retries, bounds, and per-session reminder deduplication behave correctly.
- Parent pruning covers descendants; child pruning preserves parents and siblings.
- Pruned equivalents remain hidden after regeneration; broader related categories remain eligible; restoration works.
- Session recording, collection thresholds, audio capture, finish/retry, and existing analysis remain operational.
- Any authenticated mode rejects access to another user's preferences; the local mode is explicitly documented as single-user.

Run the relevant backend tests, then `npm --prefix chrome-react run build` and `npm --prefix chrome-react run lint`. Perform manual checks on both YouTube Shorts and Instagram Reels with the built extension loaded. Evaluate real Groq matching against labeled positive, negative, incidental-mention, and ambiguous examples when credentials are available; mocked provider tests verify orchestration, not matching accuracy.

## Completion checklist

- [ ] Independent real-time detector and validated backend endpoint work end to end.
- [ ] Engagement, cancellation, stale-result checks, and preference invalidation are verified.
- [ ] Settings exposes a persistent 1.5–10-second detection delay that applies immediately across open video tabs.
- [ ] Reminders are dismissible, temporary, and never control playback.
- [ ] Persistent pruning survives ordinary sessions and renamed equivalents.
- [ ] Existing session analysis and evidence remain operational.
- [ ] Credentials stay on the backend.
- [ ] Setup instructions, configuration, measured latency, and ownership limitations are documented.
- [ ] Final report lists changed files, executed checks, results, and remaining limitations without claiming unrun tests passed.
