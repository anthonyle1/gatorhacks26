# GatorHacks 2026

## Healthy Doomscrolling

A Chrome extension that tracks YouTube Shorts viewing activity and analyzes comment sentiment to help users better understand their scrolling habits.

## Local AI prompting

The backend supports local Ollama prompting with `gemma4:e2b` through
`POST /analysis/prompt`. See [analysis setup and prompt verification](backend/analysis/README.md)
for installation, configuration, and a standalone prompt command.

## How to Install the Chrome Extension

### Step 1: Open Chrome Extensions
1. Open Google Chrome.
2. Enter `chrome://extensions/` in the address bar.

### Step 2: Enable Developer Mode
1. Find the **Developer mode** toggle in the top-right corner.
2. Turn it **ON**.

### Step 3: Load the Extension
1. Click **Load unpacked** in the top-left corner.
2. Navigate to your local `gatorhacks26` project folder.
3. Select the **`chrome`** folder containing `manifest.json`.

### Step 4: Test the Extension
1. Open [YouTube Shorts](https://www.youtube.com/shorts).
2. Click the **puzzle-piece icon** in Chrome's toolbar.
3. Select the **Healthy Doomscrolling** extension to open its popup.
4. Scroll through YouTube Shorts to test the extension.

## Updating the Extension

After making changes to the extension code:

1. Go to `chrome://extensions/`.
2. Find **Healthy Doomscrolling**.
3. Click the **Reload** icon.
4. Refresh your YouTube Shorts tab to apply the changes.

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