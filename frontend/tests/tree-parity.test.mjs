import assert from 'node:assert/strict'
import test from 'node:test'
import * as dashboardRisk from '../src/tree/risk.ts'
import * as extensionRisk from '../../chrome-react/src/tree/risk.ts'
import * as dashboardCamera from '../src/tree/camera.ts'
import * as extensionCamera from '../../chrome-react/src/tree/camera.ts'

test('dashboard topic colors match the extension using warnings and comment sentiment, including missing data', () => {
  const videos = new Map([
    ['positive', { analysis: { assessment: { content_signals: [{ id: 'help' }], signal_polarities: { help: 'positive' } }, sentiment: { counts: { positive: 8, neutral: 2, negative: 0 } } } }],
    ['negative', { analysis: { assessment: { content_signals: [{ id: 'harm' }], signal_polarities: { harm: 'negative' } }, sentiment: { counts: { positive: 0, neutral: 2, negative: 8 } } } }],
  ])
  const topics = ['positive', 'negative', 'missing'].map(id => ({ id, name: id, children: [], video_ids: [id] }))
  const actual = dashboardRisk.scaleTopicRisks(topics.map(topic => dashboardRisk.topicRisk(topic, videos)))
  const expected = extensionRisk.scaleTopicRisks(topics.map(topic => extensionRisk.topicRisk(topic, videos)))
  assert.deepEqual(actual, expected)
  assert.notEqual(actual[0].fill, actual[1].fill)
  assert.equal(actual[2].fill, '#d8ded3')
  const parent = { id: 'parent', name: 'Parent', video_ids: ['negative'], children: topics }
  assert.deepEqual(dashboardRisk.topicRisk(parent, videos), extensionRisk.topicRisk(parent, videos))
})

test('dashboard fit and zoom limits match the extension across desktop and narrow viewports', () => {
  for (const sizes of [[360, 560, 900, 1200], [1200, 700, 900, 1200], [360, 560, 300, 400], [360, 560, 9000, 12000]]) {
    assert.deepEqual(dashboardCamera.zoomRange(...sizes), extensionCamera.zoomRange(...sizes))
  }
  assert.equal(dashboardCamera.zoomRange(360, 560, 9000, 12000).min, .04)
})

test('dashboard pan bounds match extension bounds at each edge', () => {
  for (const position of [[-100, -100], [10000, 10000], [100, 200]]) {
    assert.deepEqual(dashboardCamera.boundPan(...position, 360, 560, 900, 1200), extensionCamera.boundPan(...position, 360, 560, 900, 1200))
  }
})
