# Comment Lab

A local dashboard for inspecting YouTube metadata, comment sentiment, and individual content assessments. Topics are discovered after a completed scrolling session in the [React extension](../chrome-react/README.md), rather than on this single-video dashboard.

Install and configure the backend using [analysis setup](../backend/analysis/README.md), then:

```powershell
cd test-dashboard
npm ci
npm run dev
```

`npm run dev` starts both Vite and the backend. Ctrl+C stops both.
Use `npm run dev:ui` if the backend is already running.

Enter a YouTube video ID and run analysis. The dashboard shows returned comments, classifier scores, aggregate sentiment, consistency checks, filters, and JSON export. Requests are proxied to port 8000.

After sentiment analysis it fetches the video's title/description and submits a content assessment with the aggregate balance and up to 12 varied comment excerpts. Balance is `(positive_count - negative_count) / (positive_count + negative_count)`, excluding neutrals; an empty/all-neutral sample has null balance. The excerpt sample is context, not an estimate of audience proportions.

The assessment panel shows YES/NO/UNCERTAIN, its reason, a factual context summary, and supported content signals grouped by polarity. Topic/category/subcategory fields have been removed from individual assessments. Expand the JSON viewer to inspect the validated response, provider/model, fallback flag/reason, and optional search context. Gemini backup results are clearly flagged. Metadata/model failures remain visible without discarding comment sentiment.

Optional web search sends only a bounded metadata query when enabled server-side. Comments and responses are untrusted context and rendered as text. The dashboard does not execute model output or download transcripts.

```powershell
npm run build
npm run lint
```
