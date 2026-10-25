import type { Topic, TopicVideo } from './types'

// Assessments allow four signals. A fixed scale keeps colors comparable after pruning.
export const scaleWarnings = (n: number) => Math.min(1, Math.log1p(Math.max(0, n)) / Math.log1p(4))
export function topicRisk(topic: Topic, videos: Map<string, TopicVideo>) {
  const ids = new Set<string>()
  function collect(node: Topic) { node.video_ids?.forEach(id => ids.add(id)); node.children.forEach(collect) }
  collect(topic)
  let warnings = 0, negative = 0, comments = 0, rated = 0, warningSum = 0, warningVideos = 0, ratioSum = 0, commentVideos = 0
  for (const id of ids) {
    const analysis = videos.get(id)?.analysis
    const signals = analysis?.assessment?.content_signals
    const polarities = analysis?.assessment?.signal_polarities
    const known = !!signals && signals.every(signal => ['negative', 'positive', 'neutral'].includes(polarities?.[signal.id] ?? ''))
    const counts = analysis?.sentiment?.counts
    const validCounts = counts && [counts.positive, counts.neutral, counts.negative].every(n => Number.isFinite(n) && n >= 0)
    const total = validCounts ? counts.positive + counts.neutral + counts.negative : 0
    if (known) {
      const count = signals!.filter(signal => polarities?.[signal.id] === 'negative').length
      warnings += count; warningSum += scaleWarnings(count); warningVideos++
    }
    if (validCounts && total > 0) {
      negative += counts.negative; comments += total; ratioSum += counts.negative / total; commentVideos++
    }
    if (known || total > 0) rated++
  }
  const channels = [warningVideos ? warningSum / warningVideos : null, commentVideos ? ratioSum / commentVideos : null].filter((n): n is number => n !== null)
  const score = channels.length ? channels.reduce((sum, n) => sum + n, 0) / channels.length : null
  const label = score === null ? 'Unrated' : score < 1 / 3 ? 'Lower signals' : score < 2 / 3 ? 'Some signals' : 'Higher signals'
  const detail = score === null ? 'No usable warning or comment analysis.' : `${label}: ${Math.round(score * 100)}/100. ${warnings} warnings across ${warningVideos} assessed videos; ${negative}/${comments} negative comments across ${commentVideos} videos. Rated ${rated}/${ids.size} videos, including child topics.`
  return { score, label, detail, warnings, negative, comments, rated, warningVideos, commentVideos, totalVideos: ids.size,
    ...(score === null ? { fill: '#d8ded3', stroke: '#87917f' } : riskColors(score)) }
}
/** Stretch the observed topic range across the full color ramp. Keep unrated topics out. */
export function scaleTopicRisks(risks: ReturnType<typeof topicRisk>[]) {
  const scores = risks.flatMap(risk => risk.score === null ? [] : [risk.score])
  const min = scores.length ? Math.min(...scores) : 0
  const max = scores.length ? Math.max(...scores) : 0
  return risks.map(risk => {
    if (risk.score === null) return { ...risk, colorScore: null }
    // A single score or identical scores have no relative spread; retain their absolute color.
    const colorScore = max > min ? (risk.score - min) / (max - min) : risk.score
    const relative = colorScore < 1 / 3 ? 'Lower' : colorScore < 2 / 3 ? 'Moderate' : 'Higher'
    return { ...risk, colorScore, ...riskColors(colorScore),
      detail: `${risk.detail} ${max > min ? `${relative} signals relative to your other topics.` : 'Topics with equal scores share the same color.'}` }
  })
}

function riskColors(score: number) {
  // Muted sage, dried-leaf gold and terracotta complement the garden's earth tones.
  const palette = [[168, 195, 148], [216, 191, 134], [203, 149, 130]]
  const mix = Math.min(1, Math.max(0, score)) * 2
  const index = Math.min(1, Math.floor(mix)), amount = mix - index
  const rgb = palette[index].map((n, i) => Math.round(n + (palette[index + 1][i] - n) * amount))
  return { fill: `rgb(${rgb.join(', ')})`, stroke: `rgb(${rgb.map(n => Math.round(n * .64)).join(', ')})` }
}
