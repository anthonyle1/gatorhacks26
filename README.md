# Prune

**Your social media feed is a tree. Prune the branches of the categories that tear people down.**

Prune is a Chrome extension and website for YouTube Shorts and Instagram Reels. It watches what you scroll, uses Gemma 4 to sort those videos into a tree of topics, and colors each branch by how negative its comments and content are relative to each other. You decide which branches to cut back, and Prune reminds you when a video from a pruned topic appears on your feed.

Built in 48 hours at Gator Hack V (UF AI Days 2026) by a team from three UF departments: Computer Science, Computer Engineering, and Psychology.

## What it does

- **Tracks your session.** Records each Short or Reel you watch: title, caption, comments, watch time, and (optionally) the video's speech.
- **Grows a topic tree.** When you finish a session, Gemma 4 sorts every video into topics such as Music > K-pop. The tree keeps growing across sessions.
- **Colors branches by negativity.** Each leaf mixes the share of negative comments with Gemma's warning signs (for example outrage bait or public shaming). Colors are relative to your own tree, and clicking a topic shows the counts behind its color.
- **Scores personal attacks in comments.** The "Today so far" meter rates Shorts as calm, some, or heavy by how many comments attack a real person, using a method validated against human labels (see below).
- **Lets you prune.** Cutting a branch saves your choice. When a video from a pruned topic plays, a short reminder appears on top of it.
- **Keeps a calendar.** Daily summaries show what you scrolled each day, in the side panel and on the website.

## How it works

1. **Chrome extension** (`chrome-react/`): content scripts read the YouTube or Instagram page, optional tab-audio capture records speech, and the side panel shows the session, tree, meter, and calendar.
2. **Backend** (`backend/`): a FastAPI server on your machine saves sessions in a local SQLite database and fetches YouTube comments.
3. **AI models**, each with one job:
   - `cardiffnlp/twitter-roberta-base-sentiment-latest` labels every comment as positive, neutral, or negative.
   - Whisper (`faster-whisper`, `base.en`) turns video speech into text. English only.
   - Gemma 4 31B (`gemma-4-31b-it`), through UF NaviGator, builds the topic tree and flags warning and positive signals for each video, with a short reason.
   - Gemma 4 E2B (`google/gemma-4-E2B-it`) labels which negative comments attack a person (see How we measure hostility).
   - Groq (`openai/gpt-oss-20b`) checks in real time whether a playing video belongs to a pruned topic.
4. **Website** (`frontend/`): a React app with Garden, Growth Journey, Insights, and Settings pages, plus a How we measure explanation.

## Built with

Python, FastAPI, SQLite, React, TypeScript, Vite, Chrome Extensions (Manifest V3), Hugging Face Transformers, faster-whisper, Gemma 4 via UF NaviGator, Groq, and YouTube Data API.

## Team

| Name | Major | Built |
| --- | --- | --- |
| Anthony Le | Computer Science | AI pipeline: sentiment, Gemma topic tree and video assessment, audio transcription, tree visualization, pruned-topic reminders |
| Ivette Saldana Hernandez | Computer Science | Backend, database, session tracking, Instagram comment storage, calendar insights, website design |
| Zhiting Li | Computer Engineering | Chrome extension, YouTube and Instagram integration, first website |
| Helena | Psychology | Hostility definition and prompt, data collection, blind human validation, video scores, wireframes |

## Getting started

You need Python 3.12+, Node.js, and Google Chrome 116+ on Windows, macOS, or Linux. Commands below are for Windows PowerShell.

**1. Keys.** Copy the template, then fill in the keys in the new `.env` file in the repository root (never in `.env.example`, which is public):

```powershell
Copy-Item .env.example .env
```

| Key | Needed for | Where to get it |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Comments and video details | Google Cloud Console, YouTube Data API v3 |
| `NAVIGATOR_TOOLKIT_API_KEY` | Topic tree and video assessment (Gemma 4) | https://api.ai.it.ufl.edu/ui with a UF GatorLink |
| `GROQ_API_KEY` | Optional: pruned-topic reminders | https://console.groq.com/keys |

**2. Install the backend.**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
cd ..
```

**3. Install and start everything.** From the repository root:

```powershell
npm --prefix frontend ci
npm run dev
```

This starts the backend at `http://localhost:8000` and the website at `http://localhost:5173`. Keep this terminal open; Ctrl+C stops both.

**4. Load the extension.** A ready-built copy is in `chrome-react/dist`.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `chrome-react/dist` folder.
3. Pin **Prune** from the puzzle-piece menu.

To rebuild after code changes: `npm --prefix chrome-react ci`, then `npm --prefix chrome-react run build`, then click the reload arrow on the extension card and refresh your YouTube tabs.

**5. Try it.**

1. Open a YouTube Short and click the **Prune** icon in Chrome's toolbar. The side panel opens. (Clicking the toolbar icon on the video tab is also what allows audio capture.)
2. Press **Start session** and watch a few Shorts or Reels.
3. Press **Finish & review**. After a minute or two, your feed tree grows.
4. Click a topic to see why it has its color, and prune it if you want less of it.

Scored example Shorts for the comment meter: `youtube.com/shorts/7MVYNSRDvqc` (calm) and `youtube.com/shorts/i2rqPaoY2eQ` (heavy).

## How we measure hostility

Prune rates YouTube Shorts by **person-targeted hostility** in their comment
sections: comments that demean, mock, or attack a real person or their fans.
We found plain sentiment analysis is not enough: K-pop comment sections scored
47% positive by sentiment yet still contained talent-shaming and fan-war
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

## Limitations

- **Pruning reminds; it doesn't remove.** A pruned topic triggers a reminder on screen; YouTube and Instagram still show those videos.
- **Comment scores cover analyzed videos only.** The personal-attack meter uses scores for 408 Shorts computed ahead of time. Scoring new videos live would need a GPU server.
- **Small validation set.** One human labeler and 14 hostile examples, so the true agreement could plausibly sit anywhere from about 0.4 to 0.75. Gemma over-flags borderline comments, so rates lean high.
- **English works best.** Speech-to-text is English only, and the prompts were tuned on English comments.
- **Tree colors are relative.** Red means "highest in your tree", not a diagnosis of harm.

## Use of AI tools

**AI models inside Prune:** RoBERTa (comment sentiment), Whisper (speech to text), Gemma 4 31B through UF NaviGator (topic tree and video assessment), Gemma 4 E2B (personal-attack labels), and Groq `openai/gpt-oss-20b` (pruned-topic reminders).

**AI tools used to build Prune:**

- Claude (Anthropic) and GPT (OpenAI) were used as coding and research assistants. Claude helped write the data-collection and analysis notebook, the hostility prompt, the `/hostility` route, and the UI mockups.

Team members chose the research question, collected the video list, hand-labeled all test sets, made the design decisions, and ran and checked every step.

## More documentation

- [Backend setup and analysis contracts](backend/analysis/README.md), including the optional local Ollama provider
- [Audio pipeline and UF NaviGator configuration](backend/analysis/AUDIO_PIPELINE.md)
- [Pruned-topic reminders](pruned-topic-detection.md)
- [Chrome extension](chrome-react/README.md)

## License

MIT. See [LICENSE](LICENSE).