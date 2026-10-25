import assert from 'node:assert/strict'
import test from 'node:test'
import { contentSentiment, hasNegativeConcerns } from '../src/tree/videoConcerns.ts'

test('flags explicit negative assessments and actual negative content signals', () => {
  assert.equal(hasNegativeConcerns({ negative_for_user: 'yes' }), true)
  assert.equal(hasNegativeConcerns({ content_signals: [{ id: 'harm' }], signal_polarities: { harm: 'negative' } }), true)
})

test('content chart and insight lists use actual signals, retain evidence, and keep unknowns separate', () => {
  const result = contentSentiment({ content_signals: [
    { id: 'help', evidence: 'A constructive explanation.' },
    { id: 'harm', evidence: 'An explicit hostile claim.' },
    { id: 'report' }, { id: 'missing' },
  ], signal_polarities: { help: 'positive', harm: 'negative', report: 'neutral', unrelated: 'negative' } })
  assert.deepEqual(result.positive, [{ id: 'help', evidence: 'A constructive explanation.' }])
  assert.deepEqual(result.negative, [{ id: 'harm', evidence: 'An explicit hostile claim.' }])
  assert.deepEqual(result.neutral, [{ id: 'report' }])
  assert.deepEqual(result.unclassified, [{ id: 'missing' }])
  assert.deepEqual(contentSentiment(null), { positive: [], neutral: [], negative: [], unclassified: [] })
})

test('does not flag unknown, neutral, positive, or unrelated signal data', () => {
  for (const assessment of [undefined, null, {}, { negative_for_user: 'uncertain' }, { negative_for_user: 'no' },
    { content_signals: [{ id: 'help' }], signal_polarities: { help: 'positive', other: 'negative' } },
    { content_signals: [{ id: 'neutral' }], signal_polarities: { neutral: 'neutral' } },
    { content_signals: [{ id: 'missing' }] }]) {
    assert.equal(hasNegativeConcerns(assessment), false)
  }
})
