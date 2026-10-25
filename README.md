# GatorHacks 2026

## Healthy Doomscrolling

A Chrome extension that tracks YouTube Shorts and Instagram Reels, analyzes available comment sentiment, and discovers a dynamic topic tree after each completed scrolling session. Users can expand branches and save specific see-less preferences.

## Local AI prompting

The backend supports local Ollama prompting with `gemma4:e2b` through
`POST /analysis/prompt`. See [analysis setup and prompt verification](backend/analysis/README.md)
for installation, configuration, and a standalone prompt command.

## How to Install the Chrome Extension

Build the session review popup first:

```powershell
cd chrome-react
npm ci
npm run build
```

Start the backend and Ollama using [the analysis setup](backend/analysis/README.md). The extension records sessions locally and shows completed reviews without MongoDB.

### Step 1: Open Chrome Extensions
1. Open Google Chrome.
2. Enter `chrome://extensions/` in the address bar.

### Step 2: Enable Developer Mode
1. Find the **Developer mode** toggle in the top-right corner.
2. Turn it **ON**.

### Step 3: Load the Extension
1. Click **Load unpacked** in the top-left corner.
2. Navigate to your local `gatorhacks26` project folder.
3. Select the **`chrome-react/dist`** folder containing `manifest.json`.

### Step 4: Test the Extension
1. Open [YouTube Shorts](https://www.youtube.com/shorts).
2. Click the **puzzle-piece icon** in Chrome's toolbar.
3. Select the **Healthy Doomscrolling** extension to open its popup.
4. Scroll through videos, then select **Finish and review session** in the popup.
5. Expand topic branches to see videos, inspect **Analyzed video results**, or click **Open full summary**. Select **See less** to save preferences. Parent selections include descendants; child selections affect that branch only. These preferences do not yet modify the platform feed.

## Updating the Extension

After making changes to the extension code:

1. Rebuild with `npm run build` from `chrome-react/`, then go to `chrome://extensions/`.
2. Find **Healthy Doomscrolling**.
3. Click the **Reload** icon.
4. Refresh your YouTube Shorts tab to apply the changes.

# Experimental analysis pipeline

See [audio and hosted assessment setup](backend/analysis/AUDIO_PIPELINE.md) for Redis caching, local ASR, UF NaviGator configuration, Chrome audio capture, evidence cutoffs, and benchmark commands. Audio is enabled by default and falls back to metadata/comments if transcription fails. Set `NAVIGATOR_TOOLKIT_API_KEY` in the repository-root `.env` to use the default hosted Gemma model.
