# Analysis: local Ollama prompting and YouTube reaction sentiment

## Ollama with Gemma 4

The integration in `ollama_client.py` defaults to `gemma4:e2b`. It sends prompts
to Ollama at `http://localhost:11434` using its
[chat API](https://docs.ollama.com/api/chat). No cloud API key is needed.
The existing `/analysis/comments` and `/analysis/videos/...` routes still use
the sentiment classifier described below; Gemma is available separately for
general prompts and custom analysis instructions.

Install [Ollama for Windows](https://ollama.com/download/windows), open a new
terminal, and download the exact local model:

```powershell
ollama pull gemma4:e2b
```

Keep Ollama running. If the desktop app is not serving requests, run
`ollama serve` in another terminal. This project uses the local E2B variant;
inference needs memory in addition to the downloaded model files.
Model installation alone does not confirm your machine can run inference.

Optional settings in `backend/.env` (defaults shown):

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:e2b
OLLAMA_TIMEOUT=300
```

`OLLAMA_MODEL` overrides the default for both console prompting and dashboard
assessments. Restart the backend after changing `backend/.env` so an existing
process does not retain the previous model setting. Assessment requests disable
model thinking to reserve the output budget for the validated JSON answer, and
use an 8192-token context window to accommodate comment evidence.

From `backend/`, use the project environment to verify installation and then
send an actual prompt. These commands do not require MongoDB or FastAPI startup:

```powershell
.\.venv\Scripts\python.exe -m analysis.ollama_client --check
.\.venv\Scripts\python.exe -m analysis.ollama_client "Reply with exactly: local prompting works"
.\.venv\Scripts\python.exe -m analysis.ollama_client "Explain this comment: Great editing!" --system "Answer concisely."
```

The first command only lists installed models. The second verifies prompting
when it prints an answer. Initial model loading can take time; increase
`OLLAMA_TIMEOUT` if necessary. Missing dependencies can be installed with
`python -m pip install httpx==0.28.1 python-dotenv==1.2.4` for standalone prompting,
or install the full backend requirements below.

With the backend running, `GET /analysis/ollama/status` checks connectivity and
returns `{"model":"gemma4:e2b","available":true}` when installed.
`POST /analysis/prompt` accepts:

```json
{
  "prompt": "Summarize the emotional tone of this comment: Great editing!",
  "system": "Answer concisely."
}
```

It returns `{"model":"gemma4:e2b","response":"..."}`. The `system` field is
optional. Blank prompts return 422; connection, missing model, inference, and
timeout failures return 503. This endpoint returns the complete answer without
streaming. You can also import `OllamaClient` from `analysis.ollama_client`
and call `OllamaClient().prompt("Your prompt")` from Python.

## Assess a video in the console

From `backend/`, after downloading `gemma4:e2b`, run:

```powershell
.\.venv\Scripts\python.exe -m analysis.video_assessment --title "Everyone is laughing at this person" --caption "Watch us humiliate a stranger for views." --sentiment-balance -0.7
```

You can supply audience comment text with repeated `--comment` arguments:

```powershell
.\.venv\Scripts\python.exe -m analysis.video_assessment --title "An unusual challenge" --caption "Trying something new" --sentiment-balance -0.4 --comment "This looks dangerous to copy." --comment "The creator explains the safety measures."
```

Up to 12 comments are accepted, with at most 300 characters per comment.
Comments are optional, so existing callers still work. The dashboard automatically
samples analyzed comments across the negative, neutral, and positive labels,
taking turns between labels until 12 comments are selected or the sample runs
out. It preserves order within each label and truncates each excerpt to 300
characters. The assessment's input details and JSON export show the exact sample.
This deliberately varied sample does not represent audience proportions; the
aggregate sentiment balance still comes from the entire analyzed comment sample.

Gemma uses comment text to interpret reactions, concerns, sarcasm, and topic
context. Classifier labels/confidence are estimates, and audience claims are
unverified. The prompt instructs it not to treat hostile comments as proof the
video is harmful, or comment instructions as commands. Comments go only to the
configured model endpoint; they are not added to web search queries.

This prints `Potentially negative for user: YES`, `NO`, or `UNCERTAIN`, followed
by the model's reason. The decision depends on the model response, not a fixed
score threshold. Supply the actual title and caption/description/transcript;
this command does not fetch video metadata. `--sentiment-balance` accepts the
existing analyzer's `summary.sentiment_balance`: mean positive score minus mean
negative score, from -1 to +1. Do not pass negative proportion or confidence as
this score. Omit it when no comments are available; an empty caption is allowed.

The fixed prompt is `SYSTEM_PROMPT` in `video_assessment.py`. It considers the
metadata and audience sentiment together, allows uncertainty, and avoids treating
negative comments or difficult educational topics as proof of harmful effects.
This is a tentative content assessment, not a prediction of an individual's
mental health or experience.

Code guardrails apply independently of the prompt instructions:

- Title and caption are serialized as untrusted JSON data, separate from the
  fixed system instructions, with input length and numeric range validation.
- The request uses Ollama's [structured output schema](https://docs.ollama.com/capabilities/structured-outputs)
  and a generation limit. Local validation accepts only the three decisions,
  bounded reasons, and up to five unique allowed category IDs; malformed
  responses and extra keys fail without a decision.
- The model has no tools. Its output is never passed to `eval`, `exec`, a shell,
  file operations, or repository edits. Even malicious text inside a valid
  reason remains data. Console output escapes terminal control characters.

Prompt injection can still influence an assessment; these guardrails prevent
output execution, not incorrect decisions. The existing sentiment and general
prompt routes are unchanged. Python callers can use
`assess_video(title, caption, sentiment_balance)` from `analysis.video_assessment`.

The test dashboard uses `POST /analysis/video-assessment` with JSON fields
`title`, `caption`, and `sentiment_balance` (number or null). It returns
`negative_for_user`, `reason`, `categories`, `category_reason`, `subcategories`,
`content_signals`, `taxonomy_version`, and `web_search`,
using the same prompt and validation as the
console command. Invalid input returns 422; Ollama failures return 503. The
dashboard fetches the title and description from `/youtube/video/{video_id}`
and uses the description as the caption, without fetching a transcript.

The endpoint also accepts optional `comments`, an array of up to 12 objects:

```json
{
  "text": "This tutorial helped me understand the topic.",
  "sentiment": "positive",
  "confidence": 0.9
}
```

Each `text` is required and limited to 300 characters. `sentiment` is optional
(`negative`, `neutral`, `positive`, or null), and `confidence` is optional (0–1
or null). Oversized samples and invalid scores are rejected with 422.
Python callers can pass `comments=[AssessmentComment(text="...")]` to
`assess_video(...)`. No code or network actions are driven by comment text.

If `/analysis/video-assessment` returns 503, read the JSON response's `detail`
in the dashboard or browser Network panel. The backend also logs the sanitized
failure reason. Rejected model responses log field names and validation error
types without logging prompts or raw model output. A 503 access-log line alone
does not distinguish a missing model, timeout, or response validation failure.

## Topic categories and optional web context

The console and dashboard now include topic categories independently of the
negative-content decision. The fixed taxonomy in `VideoCategory` provides stable
IDs for future preference matching:

```text
technology, programming, science, education, gaming, sports, fitness, health,
mental_health, food, travel, music, film_tv, comedy, news, politics, finance,
business, lifestyle, fashion_beauty, diy, gardening, animals, nature, automotive,
relationships, other
```

The model chooses zero to five unique categories, most relevant first, and
explains them in `category_reason`. An empty list means insufficient evidence;
`other` is used alone for a clear topic outside the taxonomy. Category assignments
are estimates, not verified labels. No user preferences or relevance score are
used yet. For example, a gardening tutorial might include:

```json
{
  "negative_for_user": "no",
  "reason": "The metadata describes a constructive tutorial.",
  "categories": ["gardening", "education"],
  "category_reason": "The title and description explain how to grow herbs.",
  "subcategories": [{"id": "gardening.indoor_plants", "evidence": "The caption describes growing herbs indoors."}],
  "content_signals": [],
  "taxonomy_version": "1",
  "web_search": {"status": "disabled", "query": null, "sources": [], "warning": null}
}
```

### Specific labels for future avoidance preferences

The response includes up to eight `subcategories` and four `content_signals`,
each with a stable `id` and a short `evidence` explanation. Parent category IDs
are unchanged. Subcategories must belong to a selected parent; unknown IDs,
duplicates, mismatched parents, and blank or oversized evidence are rejected.
Specific labels are optional when the available data does not support them.

Examples of the distinction:

| Broad category | Specific topic ID | Independent content signal, if supported |
| --- | --- | --- |
| `music` | `music.kpop` | `appearance_comparison` |
| `fitness` | `fitness.weight_loss` | `body_shaming` |
| `finance` | `finance.cryptocurrency` | `financial_hype` |
| `comedy` | `comedy.pranks` | `humiliation` |

The topic alone never implies the signal. A K-pop performance can have no
appearance-comparison signal, and educational weight-loss content does not
automatically imply body shaming. Commenter behavior is not treated as evidence
of the video's behavior. Empty signal lists mean no supported signal was found
in the supplied data, not proof of safety. Labels are estimates based on limited
metadata, excerpts, and optional search context.

`GET /analysis/taxonomy` returns the complete versioned parent-to-subcategory
mapping and content-signal IDs, defined in `analysis/taxonomy.py`. Responses and
exports include `taxonomy_version`. Examples of future preference semantics:
avoiding `music` would match all videos in that parent category; avoiding
`music.kpop` would match just that subcategory; avoiding `appearance_comparison`
would apply across topics when that signal is present. Match stable IDs exactly,
not substrings of labels or free-form evidence. Unknown specificity should be
treated as unknown, rather than assuming the absence of an avoided topic.

The dashboard shows the selected category hierarchy, evidence, and independent
content signals. This change supplies classification data for future controls;
it does not store avoidance preferences, recommend personal restrictions, or
block videos. Users will choose what they wish to avoid. The JSON answer budget
is 1536 tokens and the response size is capped at 12000 characters; model output
is still validated and never executed.

Categorization works with local metadata alone. To add optional context from
[Ollama's web search API](https://docs.ollama.com/capabilities/web-search), obtain
an [Ollama API key](https://ollama.com/settings/keys) and set these in `backend/.env`:

```dotenv
OLLAMA_WEB_SEARCH_ENABLED=true
OLLAMA_API_KEY=your_api_key_here
```

Restart the backend after changing configuration. This is a hosted search API,
separate from the locally running Gemma model: a query containing at most the
first 200 title characters and 300 caption characters is sent to `ollama.com`.
The key stays on the backend and is never included in model prompts, browser
responses, or exports. Leave the flag false for metadata-only local assessment.

The backend makes one request to the fixed HTTPS search endpoint, with a
15-second timeout and at most three results. Result titles and snippets are
bounded before inclusion in the prompt. It never follows result URLs or lets
the model request network actions. Snippets are untrusted data; the prompt
instructs Gemma to ignore injected instructions and unrelated results, prioritize
the video's metadata, and avoid assuming search results verify video content.

Missing keys, failed searches, and malformed responses fall back to metadata-only
assessment with a warning. `web_search.status` is `disabled`, `used`, `no_results`,
or `unavailable`; source provenance is supplied by backend code, not the model.
The dashboard displays search status and expandable sources, and JSON exports
include the categories and search context. No web search is added to the general
`/analysis/prompt` endpoint.

## YouTube reaction sentiment setup

From `backend/`, install the backend dependencies (including model dependencies):

```powershell
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Use the project's virtual environment. The requirements skip `uvloop` on Windows.
The API still requires the existing `MONGODB_URI` setting at startup.
Analysis does not read or write MongoDB. Add `YOUTUBE_API_KEY` to `backend/.env`
only if you want the API to fetch comments itself.

YouTube parsing and fetching are shared through `app/youtube.py`. Both the
analysis video route and `/youtube/comments/{video_id}` use its fetcher. The
YouTube comments route keeps its top-ten ranking by likes within a relevance
sample; the analysis route samples newest comments with pagination.

The first nonempty request downloads the public model from Hugging Face. Later
requests reuse it in memory and subsequent starts use the Hugging Face disk cache.
Inference runs locally on CPU. Long comments are truncated to 512 model tokens;
only that prefix affects sentiment. No model download occurs for empty input or
at application startup.

## Analyze already parsed YouTube comments

`POST /analysis/comments` accepts a JSON body:

```json
{
  "youtube_response": {
    "items": [
      {"id": "c1", "snippet": {"textOriginal": "This video made my day!"}},
      {"id": "c2", "snippet": {"textOriginal": "This was upsetting to watch."}}
    ]
  },
  "negative_threshold": 0.5
}
```

Pass the parsed response from `comments.list` or `commentThreads.list` directly
as `youtube_response`. The parser prefers `snippet.textOriginal`, otherwise
converts `textDisplay` HTML to text. Empty comments are skipped; duplicate IDs
within a response are counted once. Thread responses include any supplied
embedded replies, which YouTube does not guarantee are complete. This endpoint
analyzes only the supplied page; it does not follow `nextPageToken`.

## Fetch and analyze a video

```text
GET /analysis/videos/VIDEO_ID_11?max_comments=100&negative_threshold=0.5
```

Replace `VIDEO_ID_11` with the 11-character video ID. This uses
`commentThreads.list(videoId=..., part=snippet, textFormat=plainText)` and follows
pagination up to `max_comments` (1–1000, default 100). It samples newest top-level
comments, excludes replies, and reports whether more top-level comments exist.
To analyze replies, retrieve them with `comments.list(parentId=...)` and send
their response to the POST endpoint. Upstream failures return 502, missing API
keys/model dependencies return 503, and invalid input returns 422.

## Reading the result

Each comment includes its original text, sentiment label, winning score as
`confidence`, and all three scores. The summary includes counts, proportions,
mean model scores, and `sentiment_balance` (mean positive minus mean negative,
from -1 to +1). These model scores are not calibrated certainty estimates.

`is_negative_reaction` is true when the fraction of comments classified negative
meets `negative_threshold` **and** negative comments outnumber positive comments.
At the default threshold, a 50/50 negative/positive split is not flagged, while
a 50/50 negative/neutral split is flagged. The threshold is a configurable
heuristic, not a validated content-safety rule. No comments produces
`assessment: "insufficient_data"` and `is_negative_reaction: null`.

This English sentiment model was trained on tweets. It estimates the emotional
tone of comments, not toxicity, harmfulness, psychological effects, or whether
the video caused the reactions. Sarcasm, other languages, and the sampled
audience can affect results. Negative reactions alone cannot establish that a
video contains harmful content.

Sources: [model card](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest),
[comments.list](https://developers.google.com/youtube/data/reference/rest/v3/comments/list),
[commentThreads.list](https://developers.google.com/youtube/data/reference/rest/v3/commentThreads/list).

Run the tests from `backend/` or the repository root with the project's virtual
environment active (no model download required). Tests live in `backend/tests`;
the root `pytest.ini` configures discovery and backend imports.

Install test dependencies from `backend/`, then run pytest:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest -q
```
