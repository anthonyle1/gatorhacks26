# GatorHacks 2026

## Healthy Doomscrolling

A Chrome extension that tracks YouTube Shorts and Instagram Reels, analyzes available comment sentiment, and discovers a dynamic topic tree after each completed scrolling session. Users can expand branches and save specific see-less preferences.

Real-time reminders for saved pruned topics use Groq. See [setup, behavior, and verification](pruned-topic-detection.md) for the backend key and the Settings detection-delay control.

## Development

Install the Python dependencies and configure the root `.env` using the
[backend setup](backend/analysis/README.md#setup), then run from the repository root:

```powershell
npm --prefix frontend ci
npm run dev
```

This starts the frontend's Vite server and the backend at `http://localhost:8000`
with auto-reload. Ctrl+C stops both servers. The launcher uses `backend/.venv`
when present, otherwise `python` on PATH; set `PYTHON` to override the interpreter.

Running `npm run dev` inside `frontend/`, `chrome-react/`, or `test-dashboard/`
starts that app alongside the same backend. Install that app's dependencies with
`npm ci` first. Use `npm run dev:ui` in an app directory to start only Vite when
the backend is already running. Provider services such as Ollama still run separately.

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
## How we measure hostility

Prune rates YouTube Shorts by **person-targeted hostility** in their comment
sections: comments that demean, mock, or attack a real person or their fans.
We found plain sentiment analysis is not enough: K-pop comment sections scored
47% positive by sentiment, yet still contained talent-shaming and fan-war
attacks buried among the praise.

**Pipeline**

1. Collect up to 100 Top and 100 Newest comments per Short with the YouTube Data API.
2. Run `cardiffnlp/twitter-roberta-base-sentiment-latest` on every comment.
   In our labeled tests, 32 of 34 hostile comments were labeled negative and none
   positive, so only negative comments go to the next step.
3. For each video with 20+ comments, sample up to 15 negative comments and ask
   Gemma 4 E2B (`google/gemma-4-E2B-it`) whether each is hostile, using the prompt in
   `research/prompt_hostility_v3_explain.txt` (definition, fandom slang glossary,
   rules for indirect hostility, and a one-sentence reason before the answer).
4. Video hostility rate = share of comments that are negative x share of sampled
   negatives Gemma flags as hostile. Videos get a calm / some / heavy level.

**Validation**

We tested against blind human labels on 100 comments from held-out videos the
prompt was never tuned on. The final prompt reached Cohen's kappa 0.58 (moderate
agreement), catching 11 of 14 hostile comments. Two off-the-shelf alternatives
failed: toxic-bert (kappa -0.06) and sentiment alone (kappa 0.18). Details,
labels, and limits: `research/validation/`.

**Data**

- Normal feed: 250 Shorts, 21,040 comments.
- High-conflict test feed: 373 Shorts (K-pop vocals, fancams and dance, influencer
  drama, YouTuber apologies, what-I-eat-in-a-day, outfit of the day), 35,255 comments.

## Use of AI tools

We used Claude (Anthropic) as a coding and research assistant: it helped write
the data-collection and analysis notebook, the hostility prompt, the
`/hostility` route, and the UI mockups. Gemma 4 E2B is the model that labels
comments. Team members chose the research question, collected the video list,
hand-labeled all test sets, made the design decisions, and ran and checked
every step.
