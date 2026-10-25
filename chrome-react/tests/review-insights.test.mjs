import test from 'node:test'
import assert from 'node:assert/strict'
import { videoInsights } from '../src/review/insights.ts'

test('closed video summaries use model signal polarities and normalized comment ratios', () => {
  const info = videoInsights({ analysis: { assessment: {
    content_signals: [{id:'educational'},{id:'harassment'},{id:'unknown'}],
    signal_polarities: { educational:'positive',harassment:'negative' },
  }, sentiment: { counts:{positive:2,neutral:3,negative:5},total_comments:20 } } })
  assert.equal(info.warnings,1)
  assert.equal(info.positives,1)
  assert.equal(info.unrated,1)
  assert.deepEqual(info.ratios,{positive:.2,neutral:.3,negative:.5})
})

test('unavailable assessments and empty comments are distinguished from zero signals', () => {
  assert.equal(videoInsights({}).assessed,false)
  assert.equal(videoInsights({}).ratios,null)
  const info = videoInsights({analysis:{assessment:{content_signals:[]},sentiment:{counts:{positive:0,neutral:0,negative:0}}}})
  assert.equal(info.assessed,true)
  assert.equal(info.warnings,0)
  assert.equal(info.positives,0)
  assert.equal(info.ratios,null)
})
