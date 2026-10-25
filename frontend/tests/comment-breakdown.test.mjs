import assert from 'node:assert/strict'
import test from 'node:test'
import { commentBreakdown } from '../src/tree/commentBreakdown.ts'

test('uses aggregate counts while retaining the available analyzed comment subset', () => {
  const result = commentBreakdown({ analysis: { sentiment: { counts: { positive: 20, neutral: 3, negative: 8 } },
    comments: [{ text: ' Helpful ', sentiment: 'positive' }, { text: 'Hostile', sentiment: 'negative' }, { text: ' ', sentiment: 'neutral' }] } })
  assert.deepEqual(result.counts, { positive: 20, neutral: 3, negative: 8 })
  assert.deepEqual(result.comments, [{ text: 'Helpful', sentiment: 'positive' }, { text: 'Hostile', sentiment: 'negative' }])
})

test('falls back to available comment labels when aggregate sentiment is missing', () => {
  const result = commentBreakdown({ analysis: { comments: [{ text: 'Okay', sentiment: 'neutral' }, { text: 'Unlabeled' }] } })
  assert.deepEqual(result.counts, { positive: 0, neutral: 1, negative: 0 })
  assert.equal(result.comments[1].sentiment, 'unclassified')
})

test('raw comments and missing analysis do not fabricate neutral classifications', () => {
  const result = commentBreakdown({ comments: ['Raw comment'] })
  assert.deepEqual(result.comments, [{ text: 'Raw comment', sentiment: 'unclassified' }])
  assert.deepEqual(result.counts, { positive: null, neutral: null, negative: null })
  assert.deepEqual(commentBreakdown().comments, [])
})
