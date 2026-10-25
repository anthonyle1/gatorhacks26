import type { Video } from './types'

export function videoInsights(video: Video) {
  const assessment = video.analysis?.assessment
  const signals = assessment?.content_signals || []
  const polarities = assessment?.signal_polarities || {}
  const warnings = signals.filter(signal => polarities[signal.id] === 'negative').length
  const positives = signals.filter(signal => polarities[signal.id] === 'positive').length
  const unrated = signals.length - warnings - positives
  const counts = video.analysis?.sentiment?.counts
  const total = counts ? counts.positive + counts.neutral + counts.negative : 0
  return { assessed: !!assessment, warnings, positives, unrated, total,
    ratios: total && counts ? { positive: counts.positive / total, neutral: counts.neutral / total, negative: counts.negative / total } : null }
}
