# Session review Chrome extension

This is the extension UI for tracking YouTube Shorts/Instagram Reels and reviewing topic trees after a scrolling session. The plain `chrome/` folder retains the tracker scripts; use this React build for category controls.

Start the backend on port 8000, following [analysis setup](../backend/analysis/README.md). UF NaviGator is the default LLM provider; configure its key in the repository-root `.env`. **MongoDB and a demo user are not required.** Set `YOUTUBE_API_KEY` to fetch YouTube titles and comments; without it, reviews use captured page metadata and explicitly report unavailable comment analysis.

```powershell
cd chrome-react
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose **chrome-react/dist**. Reload the extension and refresh video tabs after rebuilding. `npm run dev` provides a UI preview; session controls require the installed extension.

For audio capture, switch from `chrome://extensions` to your actual YouTube/Instagram video tab and click the Prune extension icon in Chrome's toolbar. This user invocation grants access to that exact page and opens the side panel. Press Start tracking; if tracking is already active, the toolbar click retries capture automatically. A button inside an already-open side panel cannot grant Chrome's `activeTab` permission. If the monitor says **PERMISSION NEEDED**, click the toolbar icon again on the video tab. Chrome internal pages and the extension's summary page cannot be captured. Audio is on by default; the monitor distinguishes an authorized tab stream, actual sampled audio, uploaded segments and usable transcripts.

Scroll through videos, open the popup, and choose **Finish and review session**. Videos and captured Instagram comments are recorded in Chrome storage while you scroll, even if the backend is offline. Finishing flushes the last video and sends a completed-session snapshot to `/local-sessions/{id}/finish`. The backend stores the job and review locally in SQLite, analyzes individual videos, and then discovers the session topics. You can close the popup while discovery runs. Failed submissions retain the exact snapshot for retry. The latest fetched review is also cached in Chrome and can be read if the backend later stops.

Expand topic branches to see the actual linked videos under each category. **Analyzed video results** lists individual content decisions, reasons, summaries, sentiment counts/balance, comment samples, and JSON. Results appear progressively while work runs. Use **Open full summary** to view the tree and results in a full browser tab. Check a category to save a **See less** preference; a parent includes all descendants, while a child affects only that branch. **Manage category** supports rename, move, and merge while preserving saved identities/preferences. Start a new session after finishing. The latest completed session remains available for review. Preferences are saved for matching; automatic feed hiding/recommendation changes are not implemented.

The popup flags accepted Gemini fallback results and exposes the session JSON. Partial/failed classifications can be retried without repeating successful batches. Raw titles, captions, comments, and model responses are treated as text/data.

```powershell
npm run build
npm run lint
node --test --experimental-test-isolation=none tests/session-flow.test.cjs
```

The flow tests execute the background worker with mocked Chrome/API objects to check offline recording, snapshot submission/retries, cached summaries, metadata identity, and failure preservation. Manual verification in Chrome is still needed for platform DOM changes and cross-tab behavior.
