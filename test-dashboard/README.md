# Comment Lab

A local dashboard for exercising the live YouTube → parsing → CardiffNLP sentiment
pipeline. Enter an 11-character video ID, choose a sample size and negative
threshold, and run an analysis. It displays every returned comment, its label,
winning model score, all three probabilities, aggregate sentiment, and response
consistency checks. Search/filter/sort comments, inspect the raw response, and
export the result as JSON. No sample results or mocked model scores are used.

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
