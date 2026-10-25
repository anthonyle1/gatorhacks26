import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { TopicVideo } from '../data/topics'
import { commentBreakdown } from './commentBreakdown'

const sentiments = ['positive', 'neutral', 'negative'] as const
type Filter = 'all' | typeof sentiments[number] | 'unclassified'

export default function CommentBreakdownModal({ video, onClose }: { video?: TopicVideo; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [filter, setFilter] = useState<Filter>('all')
  const { comments, counts } = commentBreakdown(video)
  const total = sentiments.reduce((sum, sentiment) => sum + (counts[sentiment] ?? 0), 0)
  const visible = filter === 'all' ? comments : comments.filter(comment => comment.sentiment === filter)

  useEffect(() => {
    const dialog = dialogRef.current!
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = previousOverflow }
  }, [])

  return createPortal(
    <dialog ref={dialogRef} className="comment-breakdown" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}>
      <div className="comment-breakdown__header">
        <div><h2 id={titleId}>Comment breakdown</h2><p>{video?.title || 'Video comments'}</p></div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close comment breakdown"><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="comment-breakdown__metrics">
        {sentiments.map(sentiment => <div key={sentiment} className={`comment-breakdown__metric comment-breakdown__${sentiment}`}>
          <span>{sentiment}</span><strong>{counts[sentiment] ?? '—'}</strong>
          <small>{total && counts[sentiment] !== null ? `${Math.round(counts[sentiment]! / total * 100)}% of classified comments` : 'No classified comment data'}</small>
        </div>)}
      </div>
      {total > 0 && <div className="comment-breakdown__bar" aria-hidden="true">{sentiments.map(sentiment =>
        <span key={sentiment} className={`comment-breakdown__${sentiment}`} style={{ width: `${(counts[sentiment] ?? 0) / total * 100}%` }} />
      )}</div>}
      <div className="comment-breakdown__filters" role="group" aria-label="Filter comments by sentiment">
        {(['all', ...sentiments, ...(comments.some(comment => comment.sentiment === 'unclassified') ? ['unclassified'] as const : [])] as Filter[]).map(value =>
          <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All comments' : value}</button>
        )}
      </div>
      <p className="comment-breakdown__available" role="status">{visible.length} available {visible.length === 1 ? 'comment' : 'comments'}{filter !== 'all' ? ` · ${filter}` : ''}</p>
      {visible.length ? <ul className="comment-breakdown__comments">{visible.map((comment, index) => <li key={index}>
        <span className={`comment-breakdown__tag comment-breakdown__${comment.sentiment}`}>{comment.sentiment}</span>
        <p>{comment.text}</p>
      </li>)}</ul> : <p className="comment-breakdown__empty">{comments.length ? 'No available comments in this sentiment.' : 'Comment text is not available for this video yet.'}</p>}
    </dialog>, document.body
  )
}
