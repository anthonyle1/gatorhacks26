import { AlertTriangle, CheckCircle2, ChevronDown, Video as VideoIcon } from 'lucide-react'
import { videoInsights } from './insights'
import type { Topic, Video } from './types'

function videoUrl(video: Video) {
  return video.platform === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.source_id)}` : `https://www.instagram.com/reel/${encodeURIComponent(video.source_id)}/`
}
export function VideoLink({ video, id }: { video?: Video; id: string }) {
  return video ? <a href={videoUrl(video)} target="_blank" rel="noreferrer">{video.title || video.source_id}</a> : <span>{id}</span>
}
export function CategorySelect({ videoId, categories, assignments, disabled, move }: {
  videoId: string; categories: Topic[]; assignments?: string[]; disabled: boolean; move: (video: string, category: string) => void
}) {
  return <label className="video-category-select">Move video to
    <select aria-label={`Category for ${videoId}`} value={assignments?.length === 1 ? assignments[0] : ''} disabled={disabled}
      onChange={event => { if (event.target.value) move(videoId, event.target.value) }}>
      <option value="" disabled>{assignments?.length ? 'Multiple categories' : 'Choose category'}</option>
      {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
  </label>
}

export function VideoResult({ video, categories, assignments, busy, move }: {
  video: Video; categories: Topic[]; assignments?: string[]; busy: boolean; move: (video: string, category: string) => void
}) {
  const analysis = video.analysis, assessment = analysis?.assessment, sentiment = analysis?.sentiment
  const insights = videoInsights(video)
  const percent = (number: number) => `${(number * 100).toFixed(1)}%`
  return <li className="video-result"><details className="video-result__details">
    <summary>
      <div className="video-result__heading"><VideoIcon size={17} aria-hidden="true" /><strong>{video.title || video.source_id}</strong><ChevronDown className="result-chevron" size={17} aria-hidden="true" /></div>
      <div className="video-result__metrics">
        <span className="signal-count signal-count--warning"><AlertTriangle size={13} aria-hidden="true" />{insights.assessed ? `${insights.warnings} warning${insights.warnings === 1 ? '' : 's'}` : 'Warnings unavailable'}</span>
        <span className="signal-count signal-count--positive"><CheckCircle2 size={13} aria-hidden="true" />{insights.assessed ? `${insights.positives} positive${insights.positives === 1 ? '' : 's'}` : 'Positives unavailable'}</span>
        {insights.unrated > 0 && <span>{insights.unrated} unrated signals</span>}
        {!!analysis?.errors?.length && <span className="signal-count">{analysis.errors.length} analysis issues</span>}
      </div>
      {insights.ratios ? <div className="comment-ratios">
        <div className="sentiment-bar" aria-hidden="true"><i className="sentiment-positive" style={{ width: percent(insights.ratios.positive) }} /><i className="sentiment-neutral" style={{ width: percent(insights.ratios.neutral) }} /><i className="sentiment-negative" style={{ width: percent(insights.ratios.negative) }} /></div>
        <span>Comments: {sentiment?.counts.positive} positive ({percent(insights.ratios.positive)}) · {sentiment?.counts.neutral} neutral ({percent(insights.ratios.neutral)}) · {sentiment?.counts.negative} negative ({percent(insights.ratios.negative)})</span>
      </div> : <p className="analysis-note">Comment ratios unavailable{sentiment ? ' — no rated comments' : ''}.</p>}
    </summary>
    <div className="video-result__body">
      <p><VideoLink video={video} id={video.video_id} /></p>
      <p className="video-meta">{video.platform} · {Math.round(video.dwell_seconds || 0)} seconds · {video.watch_count || 1} views · {analysis?.status || 'Not analyzed'}</p>
      <CategorySelect videoId={video.video_id} categories={categories} assignments={assignments} disabled={busy} move={move} />
      {video.caption && <p>{video.caption}</p>}
      {video.coverage && <p>Audio captured: {video.coverage.captured.unique_seconds.toFixed(1)}s unique, {video.coverage.captured.repeat_seconds.toFixed(1)}s repeated. Usable transcript coverage: {video.coverage.transcribed.unique_seconds.toFixed(1)}s.</p>}
      {!!video.missing_evidence?.length && <p>Incomplete audio evidence: {video.missing_evidence.length} missing or unfinished items at Finish.</p>}
      {!!video.excluded_evidence?.length && <p>{video.excluded_evidence.length} transcript items excluded as unusable.</p>}
      {assessment ? <><p><strong>Negative impact: {assessment.negative_for_user.toUpperCase()}</strong></p><p>{assessment.reason}</p><p>{assessment.context_summary}</p>
        <small>{assessment.provider} / {assessment.model}{assessment.fallback_used ? ' · Gemini fallback used' : ''}</small>
        {assessment.evidence_summary?.transcript_excerpts !== undefined && <p>Assessment received {assessment.evidence_summary.transcript_excerpts} transcript excerpts ({assessment.evidence_summary.transcript_characters || 0} characters).</p>}
        {assessment.content_signals.length > 0 && <ul className="assessment-signals">{assessment.content_signals.map(signal => <li key={signal.id}>
          <strong>{signal.id.replaceAll('_', ' ')}</strong> <span className="analysis-note">{assessment.signal_polarities?.[signal.id] || 'Unrated'}</span>: {signal.evidence}
        </li>)}</ul>}
      </> : <p>No content assessment available.</p>}
      {sentiment ? <><p>{sentiment.total_comments} comments analyzed: {sentiment.counts.positive} positive, {sentiment.counts.neutral} neutral, {sentiment.counts.negative} negative.</p><p>Sentiment balance: {sentiment.sentiment_balance === null ? 'No positive or negative comments' : sentiment.sentiment_balance.toFixed(2)}</p></> : <p>Comment sentiment unavailable.</p>}
      {analysis?.errors?.map((issue, index) => <p className="analysis-note" key={index}>{issue}</p>)}
      {(analysis?.comments.length || 0) > 0 && <details><summary>Analyzed comment sample ({analysis!.comments.length})</summary><ul>{analysis!.comments.map((comment, index) => <li key={index}>{comment.text} <small>({comment.sentiment}, {Math.round(comment.confidence * 100)}%)</small></li>)}</ul></details>}
      <details><summary>All video data · JSON</summary><pre>{JSON.stringify(video, null, 2)}</pre></details>
    </div>
  </details></li>
}
