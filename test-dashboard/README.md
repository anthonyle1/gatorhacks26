# Comment Lab

A local dashboard for exercising the live YouTube → parsing → CardiffNLP sentiment
pipeline. Enter an 11-character video ID, choose a sample size and negative
threshold, and run an analysis. It displays every returned comment, its label,
winning model score, all three probabilities, aggregate sentiment, and response
consistency checks. Search/filter/sort comments, inspect the raw response, and
export the result as JSON. No sample results or mocked model scores are used.

After comment analysis, the dashboard fetches the video's title and description
and submits them with `summary.sentiment_balance` to `POST /analysis/video-assessment`.
This balance is `(positive_count - negative_count) / (positive_count + negative_count)`;
neutral labels are excluded. Empty and all-neutral samples have null balance.
The dashboard checks this ratio against the full sample's returned counts and
explains it in the assessment inputs. Negative reaction thresholds and the
audience distribution still use all comments, including neutral labels.
It also sends up to 12 analyzed comment excerpts, limited to 300 characters each,
with their classifier labels and confidence. Selection rotates between negative,
neutral, and positive labels, preserving order within each label, so the model
sees contrasting reactions. This sample does not represent audience proportions.
The aggregate score still describes the entire analyzed sample. Expand the input
details to inspect the exact comments sent; JSON exports include them as well.
Comment text is untrusted context, never instructions, and is not sent to web
search. The model uses it alongside metadata without treating audience claims as
verified video content.
The Video assessment panel displays the validated YES / NO / UNCERTAIN decision,
its reason, and expandable inputs. The description is used as the caption;
the dashboard does not download subtitles or transcripts. Model or metadata
failures appear in this panel without discarding the comment analysis.
JSON exports include the assessment, input evidence, and any assessment error.
Expand **Inspect Ollama assessment JSON** in the Video assessment panel to see
the full validated assessment response, including categories, subcategories,
content signals, taxonomy version, and search context. JSON is formatted and
rendered as plain text. The separate comment analysis JSON viewer remains below
the comment results.
If Ollama cannot produce an accepted assessment, the backend can use Gemini as
a hosted backup. The panel shows **Gemini fallback used**, the model name, and an
expandable reason. The JSON viewer changes to **Gemini fallback assessment JSON**;
responses and exports include `provider`, `model`, `fallback_used`, and
`fallback_reason` so backup results can be identified programmatically.
The panel also displays up to five topic categories and their explanation.
Under each category it shows supported specific subcategories and evidence,
such as Music → K-pop. Independent content signals (for example appearance
comparison or outrage bait) have their own evidence notes; topics are not
automatically treated as harmful. All labels and the taxonomy version are
included in JSON exports. `GET /analysis/taxonomy` exposes the full list of
stable IDs for future preference controls. No blocking or avoidance preferences
are enabled yet.
Taxonomy version 2 adds more topic families and both positive and negative
signals. The panel separates **Potential concerns to review** from
**Constructive signals**, using the backend's `signal_polarities` mapping rather
than guessing from model text. The taxonomy endpoint exposes both the flat
signal list and `signal_groups` for future preference controls. JSON exports
include the version and polarity mapping.
These are stable topic IDs for future preference matching; user preferences
and relevance scoring are not implemented yet. Search status and expandable
source snippets appear when optional web context is used, and are included in
the exported assessment.

## Run locally

In one terminal, from `backend/`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Configure `MONGODB_URI` and `YOUTUBE_API_KEY` in `backend/.env`. The app requires the
MongoDB setting at startup, although comment analysis does not use the database.
The first nonempty analysis downloads the model from Hugging Face, which can take
several minutes. Later requests reuse the loaded model.

For video assessment, keep Ollama running locally and install the model:

```powershell
ollama pull gemma4:e2b
```

`OLLAMA_MODEL`, `OLLAMA_BASE_URL`, and `OLLAMA_TIMEOUT` can be configured in
`backend/.env`; see [analysis setup](../backend/analysis/README.md).
For Gemini backup, add `GEMINI_API_KEY` to `backend/.env` and restart the backend.
`GEMINI_FALLBACK_ENABLED` defaults to true and `GEMINI_MODEL` defaults to
`gemini-3.8-flash`. A fallback sends video metadata and sampled comments to
Google's API; the key remains server-side. Set the flag false for Ollama-only
assessment. Gemini is not called when Ollama succeeds. Both providers' output
must pass the same assessment validation; if both fail, the panel shows the
error and preserves the completed comment analysis.
Comment results appear while Gemma is processing. Cancel stops waiting for the
assessment and preserves any completed comment results. Assessments are tentative
content judgments, not predictions of personal effects. Model output is rendered
as React text, never executed or inserted as HTML; backend schema validation and
the existing model-output guardrails also apply.

Optional web context uses Ollama's hosted search API. Set
`OLLAMA_WEB_SEARCH_ENABLED=true` and `OLLAMA_API_KEY` in `backend/.env`, then restart
the backend. This sends a bounded title/description query to Ollama's search
service; the key never goes to the browser or model. Leave the flag false for
local metadata-only categorization. Missing keys and search failures show a
warning and still allow local assessment. See the analysis README for the
category taxonomy, response format, and search limits.

In another terminal, from `test-dashboard/`:

```powershell
npm install
npm run dev
```

Open the localhost URL Vite prints. Both the dev server and `npm run preview`
proxy `/api/*` to `http://127.0.0.1:8000/*`. The backend must remain running.
API keys stay on the backend; no frontend environment variables are needed.
The generated static files alone do not include this proxy.

## What a run checks

- The live analysis endpoint returns after fetching and classifying comments.
- Comment totals and sentiment counts match the returned comments.
- Probabilities are finite, in range, and sum to approximately 1 per comment.
- The overall negative decision matches the configured threshold rule.

These checks validate response consistency, not model accuracy. Inspect actual
comments to evaluate classifications. Sampling uses newest top-level comments
and excludes replies. Empty samples have no probability check or sentiment
conclusion. Negative sentiment does not establish that a video is harmful.

Requests time out after 10 minutes and can be cancelled. Cancellation stops the
browser from waiting; inference already started on the backend may continue.

Build with `npm run build`. Run existing backend tests from the repository root
with `backend/.venv/Scripts/python.exe -m pytest -q`.
