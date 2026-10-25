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

test('bush focus matches extension framing and respects fit and maximum zoom', () => {
  for (const [viewportWidth, viewportHeight, treeWidth, treeHeight, bushWidth, bushHeight, current] of [
    [360, 560, 1200, 900, 120, 80, .3],
    [1000, 560, 1600, 1200, 180, 100, 1],
    [320, 300, 9000, 12000, 80, 40, .04],
    [1000, 700, 1000, 700, 900, 600, 2],
  ]) {
    const limits = extensionCamera.zoomRange(viewportWidth, viewportHeight, treeWidth, treeHeight)
    const focus = dashboardCamera.topicFocus(650, 450, bushWidth, bushHeight, viewportWidth, viewportHeight, current, limits)
    // Reference framing from TopicGarden.focusTopic in the extension.
    const zoom = Math.max(limits.min, Math.min(limits.max, Math.max(current,
      Math.min(2.4, viewportWidth * .68 / bushWidth, viewportHeight * .55 / bushHeight))))
    assert.deepEqual(focus, { zoom, left: 650 * zoom - viewportWidth / 2, top: 450 * zoom - viewportHeight * .43 })
    assert.ok(focus.zoom >= limits.min && focus.zoom <= limits.max)
    assert.ok(focus.zoom >= Math.min(current, limits.max))
    const pan = dashboardCamera.boundPan(focus.left, focus.top, viewportWidth, viewportHeight, treeWidth * focus.zoom, treeHeight * focus.zoom)
    assert.ok(pan.left >= 0 && pan.top >= 0)
    assert.ok(pan.left <= Math.max(0, treeWidth * focus.zoom - viewportWidth))
    assert.ok(pan.top <= Math.max(0, treeHeight * focus.zoom - viewportHeight))
  }
})
