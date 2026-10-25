import './video-summary.css'
import { AlertTriangle, CircleCheck, ExternalLink, X } from 'lucide-react'
import type { TopicVideo } from '../data/topics'
import { contentSentiment } from './videoConcerns'
import CommentBreakdownModal from './CommentBreakdownModal'

const segments = [
  { key: 'positive', label: 'Positive', color: '#648957' },
  { key: 'neutral', label: 'Neutral', color: '#c9bd95' },
  { key: 'negative', label: 'Negative', color: '#bf795d' },
] as const

function videoUrl(video: TopicVideo) {
  if (!video.source_id || video.source_id.startsWith('demo_')) return null
  if (video.platform === 'youtube') return `https://www.youtube.com/watch?v=${encodeURIComponent(video.source_id)}`
  if (video.platform === 'instagram') return `https://www.instagram.com/reel/${encodeURIComponent(video.source_id)}/`
  return null
}

export default function VideoSummary({ video, videoId, onClose }: { video?: TopicVideo; videoId: string; onClose: () => void }) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const assessment = video?.analysis?.assessment
  const groups = contentSentiment(assessment)
  const total = groups.positive.length + groups.neutral.length + groups.negative.length
  const url = video ? videoUrl(video) : null
  const counts = video?.analysis?.sentiment?.counts
  const status = assessment?.negative_for_user === 'yes' ? 'Potential concern'
    : assessment?.negative_for_user === 'no' ? 'No concern identified'
    : assessment?.negative_for_user === 'uncertain' ? 'Uncertain assessment' : 'Not assessed'
  let offset = 0

  return (
    <section className="prune-video-details video-summary" aria-label={`Video summary: ${video?.title || videoId}`}>
      <div className="video-summary__header">
        <h4>AI assessment</h4>
        <span className="video-summary__status">{status}</span>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open original video" title="Open original video"><ExternalLink size={15} aria-hidden="true" /></a>}
        <button type="button" onClick={onClose} aria-label="Close video summary"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="video-summary__body">
        <div className="video-summary__assessment">
          <p>{assessment?.reason || assessment?.context_summary || 'AI assessment is not available for this video yet.'}</p>
          {assessment?.context_summary && assessment.context_summary !== assessment.reason && assessment.reason && (
            <details><summary>Context</summary><p>{assessment.context_summary}</p></details>
          )}
          {(groups.negative.length > 0 || groups.positive.length > 0) && (
            <div className="video-summary__signals">
              {(['negative', 'positive'] as const).map(polarity => groups[polarity].length > 0 && (
                <div key={polarity} className={`video-summary__${polarity}`}>
                  <h5>{polarity === 'negative' ? <AlertTriangle size={13} aria-hidden="true" /> : <CircleCheck size={13} aria-hidden="true" />}{polarity === 'negative' ? 'Concerns' : 'Positives'}</h5>
                  <ul>{groups[polarity].map(signal => <li key={signal.id}><strong>{signal.id.replaceAll('_', ' ')}</strong>{signal.evidence && <>: {signal.evidence}</>}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <figure className="video-summary__sentiment">
          <figcaption><button type="button" className="video-summary__sentiment-button" aria-haspopup="dialog" aria-expanded={commentsOpen} onClick={() => setCommentsOpen(true)}>Content sentiment</button></figcaption>
          <button type="button" className="video-summary__chart-button" aria-label="View comment breakdown" aria-haspopup="dialog" aria-expanded={commentsOpen} onClick={() => setCommentsOpen(true)}>
          <span className="video-summary__chart-row">
            <svg viewBox="0 0 40 40" role="img" aria-label={total ? `Content signals: ${groups.positive.length} positive, ${groups.neutral.length} neutral, ${groups.negative.length} negative` : 'Content sentiment unavailable'}>
              <circle cx="20" cy="20" r="15.915494" fill="none" stroke="#e1e5d9" strokeWidth="7" />
              {total > 0 && segments.map(segment => {
                const percent = groups[segment.key].length / total * 100
                const start = offset
                offset += percent
                return percent > 0 ? <circle key={segment.key} cx="20" cy="20" r="15.915494" fill="none" stroke={segment.color} strokeWidth="7"
                  strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-start} transform="rotate(-90 20 20)" /> : null
              })}
              <text x="20" y="22" textAnchor="middle" className="video-summary__chart-total">{total || '—'}</text>
            </svg>
            <span className="video-summary__chart-legend">{segments.map(segment => <span key={segment.key}><i style={{ background: segment.color }} aria-hidden="true" />{segment.label}<strong>{groups[segment.key].length}</strong></span>)}</span>
          </span>
          <span className="video-summary__chart-hint">View comment breakdown</span>
          </button>
          {!total && <p>No classified content signals.</p>}
          {groups.unclassified.length > 0 && <p>{groups.unclassified.length} unclassified {groups.unclassified.length === 1 ? 'signal' : 'signals'}</p>}
        </figure>
      </div>
      {counts && <p className="video-summary__comments">Comment sentiment: {counts.positive ?? '—'} positive · {counts.neutral ?? '—'} neutral · {counts.negative ?? '—'} negative</p>}
      {commentsOpen && <CommentBreakdownModal video={video} onClose={() => setCommentsOpen(false)} />}
    </section>
  )
}
import { useState } from 'react'
