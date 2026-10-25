import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { DailySummary, DailyVideo } from '../../data/dailyInsights'
import type { TopicVideo } from '../../data/topics'
import VideoSummary from '../../tree/VideoSummary'
import { dailyScore } from './score'
import './daily-summary.css'

function summaryVideo(video: DailyVideo): TopicVideo {
  return { video_id: video.video_id, source_id: video.video_id.replace(/^(youtube|instagram):/, ''), platform: video.platform, title: video.title,
    analysis: { assessment: video.assessment ?? undefined, sentiment: video.comment_counts ? { counts: video.comment_counts } : undefined } }
}

export default function DailySummaryView({ data }: { data: DailySummary }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [limit, setLimit] = useState(8)
  const { summary } = data
  const score = dailyScore(summary.warning_count, summary.positive_insight_count)
  const videos = [...data.videos].sort((a, b) => b.watched_at.localeCompare(a.watched_at))
  return <div className="daily-summary-view">
    <div className="daily-summary-view__stats">
      <div className="daily-summary-view__score"><strong>{score ?? '—'}<small>/100</small></strong><span>Concern score · lower is better</span></div>
      <div><strong>{summary.videos_watched}</strong><span>Videos watched</span></div>
      <div><strong>{Math.round(summary.watch_seconds / 60)}m</strong><span>Time watched</span></div>
      <div><strong>{summary.warning_count} / {summary.positive_insight_count}</strong><span>Warnings / positive insights</span></div>
    </div>
    <p className="daily-summary-view__note">{score === null ? 'No rated content signals yet.' : 'Score: warnings as a percentage of warnings and positive insights.'}{summary.not_assessed_count > 0 ? ` ${summary.not_assessed_count} videos awaiting assessment.` : ''}</p>
    <h3>Most-watched topics</h3>
    {data.top_categories.length ? <ol className="daily-summary-view__topics">{[...data.top_categories].sort((a, b) => b.video_count - a.video_count).slice(0, 5).map(topic => <li key={topic.id}>
      <span>{topic.name}</span><strong>{topic.video_count} videos</strong><span className="daily-summary-view__topic-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, topic.percentage))}%` }} /></span>
    </li>)}</ol> : <p>No topics recorded for this day.</p>}
    <h3>Videos watched</h3>
    <ul className="daily-summary-view__videos">{videos.slice(0, limit).map((video, index) => {
      const key = `${video.session_id}:${video.event_id || video.video_id}:${video.watched_at}:${index}`
      const open = expanded === key
      return <li key={key}>
        <button type="button" className="daily-summary-view__video" aria-expanded={open} onClick={() => setExpanded(open ? null : key)}>
          {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <span><strong>{video.title || video.video_id}</strong><small>{video.category_name || 'Topic pending'} · {Math.round(video.dwell_seconds)}s · {video.warning_count === null ? 'Assessment pending' : `${video.warning_count} warnings · ${video.positive_insight_count ?? 0} positives`}</small></span>
          {!!video.warning_count && <AlertTriangle size={15} className="daily-summary-view__warning" aria-label="Content concerns" />}
        </button>
        {open && <VideoSummary video={summaryVideo(video)} videoId={video.video_id} onClose={() => setExpanded(null)} />}
      </li>
    })}</ul>
    {!videos.length && <p>No videos recorded for this day.</p>}
    {limit < videos.length && <button type="button" className="daily-summary-view__more" onClick={() => setLimit(previous => previous + 8)}>Show more videos ({videos.length - limit} remaining)</button>}
  </div>
}
