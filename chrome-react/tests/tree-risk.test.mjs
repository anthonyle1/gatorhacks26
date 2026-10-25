import assert from 'node:assert/strict'
import test from 'node:test'
import { scaleTopicRisks, scaleWarnings, topicRisk } from '../src/tree/risk.ts'

const topic = (ids, children = []) => ({ video_ids: ids, children })
const video = (id, warnings, negative, positive) => ({ video_id: id, analysis: {
  assessment: { content_signals: Array.from({ length: warnings }, (_, i) => ({ id: `w${i}` })),
    signal_polarities: Object.fromEntries(Array.from({ length: warnings }, (_, i) => [`w${i}`, 'negative'])) },
  sentiment: { counts: { negative, positive, neutral: 0 } },
} })
const risk = (node, videos) => topicRisk(node, new Map(videos.map(v => [v.video_id, v])))

test('warning scaler is logarithmic, bounded and monotonic', () => {
  assert.equal(scaleWarnings(0), 0)
  assert.equal(scaleWarnings(4), 1)
  assert.equal(scaleWarnings(50), 1)
  assert.ok(scaleWarnings(1) > .2 && scaleWarnings(1) < scaleWarnings(2))
})
test('warnings and negative comments both increase scores and change colors', () => {
  const low = risk(topic(['a']), [video('a', 0, 0, 10)])
  assert.equal(low.score, 0)
  assert.equal(risk(topic(['a']), [video('a', 0, 10, 0)]).score, .5)
  assert.equal(risk(topic(['a']), [video('a', 4, 0, 10)]).score, .5)
  const high = risk(topic(['a']), [video('a', 4, 10, 0)])
  assert.equal(high.score, 1)
  assert.notEqual(low.fill, high.fill)
})
test('averages normalize category size and comment volume; descendants are deduplicated', () => {
  const a = video('a', 1, 2, 8), b = video('b', 1, 200, 800)
  const single = risk(topic(['a']), [a])
  const parent = risk(topic(['a', 'b'], [topic(['a', 'b'])]), [a, b])
  assert.equal(parent.score, single.score)
  assert.equal(parent.warnings, 2)
  assert.equal(parent.rated, 2)
  assert.equal(risk(topic([], [topic(['a'])]), [a]).score, single.score)
})
test('missing data is unrated rather than zero and partial analysis remains usable', () => {
  assert.equal(risk(topic(['missing']), []).score, null)
  const partial = { video_id: 'a', analysis: { sentiment: { counts: { negative: 3, neutral: 0, positive: 0 } } } }
  assert.equal(risk(topic(['a', 'missing']), [partial]).score, 1)
  const unknown = { video_id: 'a', analysis: { assessment: { content_signals: [{ id: 'unknown' }] } } }
  assert.equal(risk(topic(['a']), [unknown]).score, null)
})

test('positive signals do not count as warnings and neutral comments dilute negativity', () => {
  const positive = video('a', 1, 0, 10)
  positive.analysis.assessment.signal_polarities.w0 = 'positive'
  assert.equal(risk(topic(['a']), [positive]).score, 0)
  const neutral = video('a', 0, 10, 0)
  neutral.analysis.sentiment.counts.neutral = 90
  assert.equal(risk(topic(['a']), [neutral]).score, .05)
})

test('invalid comment counts and unrecognized polarities are excluded', () => {
  const invalid = video('a', 1, -1, 0)
  invalid.analysis.assessment.signal_polarities.w0 = 'unknown'
  assert.equal(risk(topic(['a']), [invalid]).score, null)
  invalid.analysis.sentiment.counts.negative = Number.NaN
  assert.equal(risk(topic(['a']), [invalid]).score, null)
})

test('nearby topic scores stretch across green, amber and red', () => {
  const risks = [1, 2, 3].map(n => risk(topic(['a']), [video('a', 0, n, 100 - n)]))
  const scaled = scaleTopicRisks(risks)
  assert.equal(scaled[0].colorScore, 0)
  assert.ok(Math.abs(scaled[1].colorScore - .5) < 1e-12)
  assert.equal(scaled[2].colorScore, 1)
  assert.deepEqual(scaled.map(r => r.score), risks.map(r => r.score))
  assert.equal(new Set(scaled.map(r => r.fill)).size, 3)
})

test('unrated topics do not affect scaling and equal scores keep absolute colors', () => {
  const missing = risk(topic(['missing']), [])
  const low = risk(topic(['a']), [video('a', 0, 2, 98)])
  const high = risk(topic(['a']), [video('a', 0, 4, 96)])
  const scaled = scaleTopicRisks([missing, low, high])
  assert.equal(scaled[0].colorScore, null)
  assert.equal(scaled[0].fill, missing.fill)
  assert.equal(scaled[1].colorScore, 0)
  assert.equal(scaled[2].colorScore, 1)
  assert.deepEqual(scaleTopicRisks([low, low]).map(r => r.colorScore), [low.score, low.score])
  assert.equal(scaleTopicRisks([high])[0].colorScore, high.score)
  assert.deepEqual(scaleTopicRisks([]), [])
})
