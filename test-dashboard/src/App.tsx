import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

const sentiments = ['negative', 'neutral', 'positive'] as const
type Sentiment = typeof sentiments[number]
type Scores = Record<Sentiment, number>
type Comment = { id: string | null; text: string; sentiment: Sentiment; confidence: number; scores: Scores }
type Analysis = {
  model: string
  summary: {
    total_comments: number; counts: Scores; proportions: Scores; average_scores: Scores
    sentiment_balance: number | null; negative_threshold: number
    is_negative_reaction: boolean | null; assessment: string
  }
  comments: Comment[]
  sample: { video_id: string; order: string; includes_replies: boolean; max_comments: number; has_more: boolean }
}
type Run = { data: Analysis; seconds: number; completedAt: string }

const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasScores(value: unknown): value is Scores {
  return isRecord(value) && sentiments.every(label => typeof value[label] === 'number')
}

function isAnalysis(value: unknown): value is Analysis {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.sample) || !Array.isArray(value.comments)) return false
  const { summary, sample, comments } = value
  return typeof value.model === 'string' && typeof summary.total_comments === 'number'
    && hasScores(summary.counts) && hasScores(summary.proportions) && hasScores(summary.average_scores)
    && typeof summary.negative_threshold === 'number'
    && (typeof summary.is_negative_reaction === 'boolean' || summary.is_negative_reaction === null)
    && typeof sample.video_id === 'string' && typeof sample.max_comments === 'number' && typeof sample.has_more === 'boolean'
    && comments.every(comment => isRecord(comment) && typeof comment.text === 'string'
      && (comment.id === null || typeof comment.id === 'string')
      && sentiments.includes(comment.sentiment as Sentiment) && typeof comment.confidence === 'number' && hasScores(comment.scores))
}

function Icon({ name, size = 20 }: { name: 'play' | 'arrow' | 'search' | 'activity' | 'download' | 'check'; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'play' && <path d="m9 5 10 7-10 7V5Z" />}
    {name === 'arrow' && <path d="M5 12h14M13 6l6 6-6 6" />}
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {name === 'activity' && <path d="M3 12h4l3-8 4 16 3-8h4" />}
    {name === 'download' && <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />}
    {name === 'check' && <path d="m5 12 4 4L19 6" />}
  </svg>
}

function App() {
  const [videoId, setVideoId] = useState('')
  const [sampleSize, setSampleSize] = useState(100)
  const [threshold, setThreshold] = useState(50)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [filter, setFilter] = useState<Sentiment | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('original')
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = videoId.trim()
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      setError('Enter an 11-character YouTube video ID, such as the value after v= in its URL.')
      return
    }
    const request = new AbortController()
    controller.current = request
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; request.abort() }, 600_000)
    const started = performance.now()
    setError(''); setNotice(''); setRun(null); setRunning(true); setElapsed(0)
    setFilter('all'); setSearch(''); setSort('original')
    try {
      const params = new URLSearchParams({ max_comments: String(sampleSize), negative_threshold: String(threshold / 100) })
      const response = await fetch(`/api/analysis/videos/${id}?${params}`, { signal: request.signal })
      const text = await response.text()
      let body: unknown
      try { body = JSON.parse(text) } catch { throw new Error('The API did not return JSON. Check that the backend is running on port 8000, then try again.') }
      if (!response.ok) {
        const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : `Analysis failed (HTTP ${response.status}). Check the backend terminal for details.`
        throw new Error(detail)
      }
      if (!isAnalysis(body)) throw new Error('Unexpected analysis response. Check that the backend exposes /analysis/videos/{video_id}.')
      setRun({ data: body, seconds: (performance.now() - started) / 1000, completedAt: new Date().toLocaleTimeString() })
    } catch (cause) {
      if (request.signal.aborted) {
        if (timedOut) setError('The request exceeded 10 minutes. The first run may need to download the model. Check the backend terminal before retrying.')
        else setNotice('Request cancelled. Work already started on the backend may continue.')
      } else setError(cause instanceof Error ? cause.message : 'Could not reach the API. Check that the backend is running on port 8000.')
    } finally {
      window.clearTimeout(timer)
      controller.current = null
      setRunning(false)
    }
  }

  const data = run?.data
  const summary = data?.summary
  const comments = (data?.comments ?? []).filter(comment =>
    (filter === 'all' || comment.sentiment === filter) && comment.text.toLowerCase().includes(search.toLowerCase()),
  ).toSorted((a, b) => sort === 'confidence' ? b.confidence - a.confidence : sort === 'negative' ? b.scores.negative - a.scores.negative : 0)
  const checks = data ? [
    { label: 'YouTube → analyzer', detail: 'The live analysis request completed.', pass: true },
    { label: 'Comment counts', detail: 'Returned comments match the summary and label counts.', pass: data.comments.length === data.summary.total_comments && sentiments.reduce((n, label) => n + data.summary.counts[label], 0) === data.comments.length && sentiments.every(label => data.comments.filter(c => c.sentiment === label).length === data.summary.counts[label]) },
    { label: 'Probability scores', detail: 'Each score is between 0 and 1; each set sums to 1.', pass: data.comments.length ? data.comments.every(c => sentiments.every(label => Number.isFinite(c.scores[label]) && c.scores[label] >= 0 && c.scores[label] <= 1) && Math.abs(sentiments.reduce((n, label) => n + c.scores[label], 0) - 1) < 0.001) : null },
    { label: 'Decision rule', detail: 'Recomputed from returned comment labels and the threshold.', pass: data.summary.is_negative_reaction === (data.comments.length ? data.comments.filter(c => c.sentiment === 'negative').length / data.comments.length >= data.summary.negative_threshold && data.comments.filter(c => c.sentiment === 'negative').length > data.comments.filter(c => c.sentiment === 'positive').length : null) },
  ] : []

  function download() {
    if (!run) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(run.data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `comment-analysis-${run.data.sample.video_id}.json`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark"><Icon name="activity" /></span><span>Healthy<span className="brand-sub">DOOMSCROLLING</span></span></a>
      <div className="sidebar-label">WORKSPACE</div>
      <a className="nav-item active" href="#"><Icon name="activity" /> Comment lab <span>01</span></a>
      <div className="sidebar-note"><span className="tiny-dot" /> LOCAL WORKBENCH<p>Inspect the reactions.<br />Understand the conversation.</p></div>
      <div className="model-note"><span className="sidebar-label">SENTIMENT MODEL</span><p>CardiffNLP / RoBERTa</p><span>English · 3 sentiment classes</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>Research workspace <span className="breadcrumb">/</span> <strong>Comment lab</strong></span><span className="environment"><span className="tiny-dot" /> Local environment</span></header>
      <main>
        <div className="intro"><div><span className="eyebrow">YOUTUBE COMMENT ANALYSIS</span><h1>Read the room<span>.</span></h1><p>Put your sentiment pipeline to work. Explore what an audience is feeling, one comment at a time.</p></div><span className="lab-stamp">COMMENT<br /><b>LAB</b><span>LIVE ANALYSIS</span></span></div>
        <section className="panel run-panel" aria-labelledby="run-heading">
          <div className="section-heading"><h2 id="run-heading"><span className="step">01</span> Set up an analysis</h2><span className="subtle">Live YouTube comments</span></div>
          <form onSubmit={analyze}>
            <div className="form-grid">
              <label className="video-field">YouTube video ID<div className="input-with-icon"><Icon name="play" /><input required value={videoId} onChange={e => setVideoId(e.target.value)} placeholder="e.g. dQw4w9WgXcQ" autoComplete="off" spellCheck={false} disabled={running} aria-describedby="id-hint" /></div><span className="field-hint" id="id-hint">The 11 characters after youtube.com/watch?v= or /shorts/</span></label>
              <label>Comment sample<select value={sampleSize} onChange={e => setSampleSize(Number(e.target.value))} disabled={running}>{[20, 50, 100, 250, 500, 1000].map(n => <option key={n} value={n}>{n} comments</option>)}</select><span className="field-hint">Up to this many · Newest first</span></label>
              <label>Negative threshold<div className="threshold-control"><input type="number" min="1" max="100" step="1" required value={threshold} onChange={e => setThreshold(Number(e.target.value))} disabled={running} /><span>%</span></div><span className="field-hint">Negative share needed to flag</span></label>
            </div>
            <div className="form-footer"><span><span className="tiny-dot" /> Real comments. Local model inference.</span><div>{running && <button type="button" className="button secondary" onClick={() => controller.current?.abort()}>Cancel</button>}<button className="button primary" disabled={running} type="submit">{running ? <><span className="spinner" /> Analyzing · {elapsed}s</> : <>Run analysis <Icon name="arrow" size={18} /></>}</button></div></div>
          </form>
          {running && <p className="run-message" role="status">Fetching comments and running sentiment inference. The first run downloads model weights and can take several minutes.</p>}
          {error && <div className="error-message" role="alert"><strong>Analysis couldn’t complete.</strong> {error}</div>}
          {notice && <p className="run-message" role="status">{notice}</p>}
        </section>
        <div className="results-heading"><h2><span className="step">02</span> Audience overview</h2><span className="subtle" role="status">{run ? `${run.data.sample.video_id} · Completed ${run.completedAt} · ${run.seconds.toFixed(1)}s` : 'Waiting for your first analysis'}</span></div>
        <div className="metric-grid">
          <div className="metric-card"><span>Comments analyzed</span><strong>{summary ? summary.total_comments.toLocaleString() : '—'}</strong><small>{data ? `Up to ${data.sample.max_comments} requested` : 'Your sample, at a glance'}</small></div>
          {sentiments.map(label => <div key={label} className={`metric-card ${label}`}><span><i /> {title(label)}</span><strong>{summary ? percent(summary.proportions[label]) : '—'}</strong><small>{summary ? `${summary.counts[label]} ${summary.counts[label] === 1 ? 'comment' : 'comments'}` : 'Share of analyzed comments'}</small></div>)}
        </div>
        <div className="analysis-grid">
          <section className="panel distribution"><div className="section-heading"><h2>Sentiment distribution</h2><span className="subtle">By comment label</span></div>
            <div className="distribution-body"><div className={`donut ${summary?.total_comments ? '' : 'no-data'}`} style={summary?.total_comments ? { background: `conic-gradient(var(--negative) 0% ${summary.proportions.negative * 100}%, var(--neutral) ${summary.proportions.negative * 100}% ${(summary.proportions.negative + summary.proportions.neutral) * 100}%, var(--positive) ${(summary.proportions.negative + summary.proportions.neutral) * 100}% 100%)` } : undefined} role="img" aria-label={summary ? sentiments.map(label => `${label}: ${percent(summary.proportions[label])}`).join(', ') : 'No sentiment data yet'}><div><strong>{summary?.total_comments ?? '—'}</strong><span>comments</span></div></div>
              <div className="legend">{sentiments.map(label => <div key={label}><span><i className={`dot ${label}`} /> {title(label)}</span><strong>{summary ? percent(summary.proportions[label]) : '—'}</strong></div>)}</div></div>
            <div className={`assessment ${summary?.is_negative_reaction === true ? 'flagged' : ''}`}><span className="assessment-icon">{summary?.is_negative_reaction === true ? '!' : '↗'}</span><div><strong>{!summary ? 'A little context goes a long way' : summary.is_negative_reaction === null ? 'No comments to assess' : summary.is_negative_reaction ? 'Negative audience reaction' : 'Negative threshold not triggered'}</strong><p>{summary ? `Flag rule: at least ${percent(summary.negative_threshold)} negative, with more negative than positive comments.` : 'Run an analysis to see the overall audience reaction.'}</p></div></div>
          </section>
          <section className="panel checks"><div className="section-heading"><h2>Pipeline checks</h2><span className="subtle">{data ? `${checks.filter(check => check.pass === true).length}/${checks.filter(check => check.pass !== null).length} passed` : 'Ready to run'}</span></div>
            {(data ? checks : [
              { label: 'YouTube → analyzer', detail: 'Fetch and classify a live comment sample.', pass: null },
              { label: 'Comment counts', detail: 'Check returned comments against summary totals.', pass: null },
              { label: 'Probability scores', detail: 'Check score ranges and probability sums.', pass: null },
              { label: 'Decision rule', detail: 'Verify the configured negative-reaction rule.', pass: null },
            ]).map(check => <div className="check-row" key={check.label}><span className={`check-indicator ${check.pass === null ? 'pending' : check.pass ? 'passed' : 'failed'}`}>{check.pass === null ? '·' : check.pass ? <Icon name="check" size={14} /> : '!'}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div><small>{check.pass === null ? (data ? 'N/A' : 'Pending') : check.pass ? 'Pass' : 'Fail'}</small></div>)}
          </section>
        </div>
        <section className="panel comments-panel" aria-labelledby="comments-heading">
          <div className="section-heading"><h2 id="comments-heading"><span className="step">03</span> The conversation <span className="count-badge">{data?.comments.length ?? 0}</span></h2><button className="text-button" onClick={download} disabled={!data}><Icon name="download" size={16} /> Export JSON</button></div>
          <div className="comment-toolbar"><div className="filters" role="group" aria-label="Filter comments by sentiment">{(['all', ...sentiments] as const).map(label => <button key={label} className={filter === label ? 'selected' : ''} aria-pressed={filter === label} onClick={() => setFilter(label)}>{title(label)}{data && <span>{label === 'all' ? data.comments.length : data.summary.counts[label]}</span>}</button>)}</div><div className="comment-tools"><label className="search-box"><Icon name="search" size={16} /><input aria-label="Search comment text" placeholder="Search comments…" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Sort comments" value={sort} onChange={e => setSort(e.target.value)}><option value="original">Sample order</option><option value="confidence">Highest confidence</option><option value="negative">Most negative</option></select></div></div>
          {!data || !data.comments.length ? <div className="empty-state"><span className="empty-symbol"><Icon name="activity" size={30} /></span><h3>{data ? 'No comments in this sample' : 'Every conversation starts somewhere.'}</h3><p>{data ? 'Try a different video with public comments enabled.' : 'Enter a video ID above to explore its comments and audience sentiment.'}</p><span className="empty-caption">{data ? 'No sentiment conclusion was drawn.' : 'Your results will appear here'}</span></div>
            : !comments.length ? <div className="empty-state compact"><h3>No matching comments</h3><p>Try a different search or sentiment filter.</p></div>
            : <div className="comment-list">{comments.map((comment, index) => <article className="comment-row" key={comment.id ?? index}><span className={`comment-avatar ${comment.sentiment}`}>{String(index + 1).padStart(2, '0')}</span><div className="comment-content"><div className="comment-meta"><span className={`sentiment-badge ${comment.sentiment}`}>{title(comment.sentiment)}</span><span>{percent(comment.confidence)} confidence</span>{comment.id && <a href={`https://www.youtube.com/watch?v=${data.sample.video_id}&lc=${encodeURIComponent(comment.id)}`} target="_blank" rel="noreferrer">View on YouTube ↗</a>}</div><p className="comment-text">{comment.text}</p><div className="score-grid">{sentiments.map(label => <div className="score" key={label}><span>{title(label)} <b>{percent(comment.scores[label])}</b></span><div className="score-track"><span className={label} style={{ width: percent(comment.scores[label]) }} /></div></div>)}</div></div></article>)}</div>}
          {data && <div className="comments-footer"><span>Showing {comments.length} of {data.comments.length} analyzed comments</span><span>{data.sample.has_more ? 'Sample limit reached · more comments available' : 'End of available top-level sample'} · Replies excluded</span></div>}
        </section>
        {data && <details className="raw-response"><summary>Inspect raw API response <span>JSON</span></summary><pre>{JSON.stringify(data, null, 2)}</pre></details>}
        <footer className="page-footer"><span>HEALTHY DOOMSCROLLING <span>/</span> COMMENT LAB</span><p>English sentiment analysis measures comment tone, not video harmfulness. Results reflect the sampled comments.</p></footer>
      </main>
    </div>
  </div>
}

export default App
