# Session review Chrome extension

This is the extension UI for tracking YouTube Shorts/Instagram Reels and reviewing topic trees after a scrolling session. The plain `chrome/` folder retains the tracker scripts; use this React build for category controls.

Start the backend on port 8000, configure MongoDB and Ollama, and seed `demo_user` following [analysis setup](../backend/analysis/README.md).

```powershell
cd chrome-react
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose **chrome-react/dist**. Reload the extension and refresh video tabs after rebuilding. `npm run dev` provides a UI preview; session controls require the installed extension.

Scroll through videos, open the popup, and choose **Finish and review session**. The extension flushes the last video and queues topic discovery only after the backend accepts all events. You can close the popup while discovery runs. Failed uploads retain queued events; fix backend connectivity and try Finish again.

Expand topic branches to inspect unique video counts and source videos. Check a category to save a **See less** preference; a parent includes all descendants, while a child affects only that branch. **Manage category** supports rename, move, and merge while preserving saved identities/preferences. Start a new session after finishing. The latest completed session remains available for review. Preferences are saved for matching; automatic feed hiding/recommendation changes are not implemented.

The popup flags accepted Gemini fallback results and exposes the session JSON. Partial/failed classifications can be retried without repeating successful batches. Raw titles, captions, comments, and model responses are treated as text/data.

```powershell
npm run build
npm run lint
node --test --experimental-test-isolation=none tests/session-flow.test.cjs
```

The flow tests execute the background worker with mocked Chrome/API objects to check final-video upload order and failure preservation. Manual verification in Chrome is still needed for platform DOM changes and cross-tab behavior.
