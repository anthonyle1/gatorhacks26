import type { TopicVideo } from '../data/topics'

export function commentBreakdown(video?: TopicVideo) {
  const analyzed = video?.analysis?.comments ?? []
  const source = analyzed.length ? analyzed : (video?.comments ?? []).map(text => ({ text }))
  const comments = source.filter(comment => comment.text?.trim()).map(comment => ({
    text: comment.text!.trim(),
    sentiment: 'sentiment' in comment && ['positive', 'neutral', 'negative'].includes(comment.sentiment ?? '')
      ? comment.sentiment as 'positive' | 'neutral' | 'negative' : 'unclassified' as const,
  }))
  const counts = video?.analysis?.sentiment?.counts
  const countFor = (sentiment: 'positive' | 'neutral' | 'negative') => {
    const count = counts?.[sentiment]
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) return count
    return comments.some(comment => comment.sentiment !== 'unclassified')
      ? comments.filter(comment => comment.sentiment === sentiment).length : null
  }
  return { comments, counts: { positive: countFor('positive'), neutral: countFor('neutral'), negative: countFor('negative') } }
}
