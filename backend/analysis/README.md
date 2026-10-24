# YouTube reaction sentiment

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
