import assert from 'node:assert/strict'
import test from 'node:test'
import { boundPan, zoomRange } from '../src/tree/camera.ts'

test('camera cannot leave any edge of the rendered tree', () => {
  assert.deepEqual(boundPan(-1000, -1000, 360, 560, 900, 1200), { left: 0, top: 0 })
  assert.deepEqual(boundPan(10000, 10000, 360, 560, 900, 1200), { left: 540, top: 640 })
  assert.deepEqual(boundPan(120, 180, 360, 560, 900, 1200), { left: 120, top: 180 })
})

test('panning locks when the tree fits and updates for a smaller tree or viewport', () => {
  assert.deepEqual(boundPan(300, 400, 360, 560, 300, 400), { left: 0, top: 0 })
  assert.deepEqual(boundPan(300, 400, 360, 560, 500, 700), { left: 140, top: 140 })
  assert.deepEqual(boundPan(300, 400, 600, 800, 500, 700), { left: 0, top: 0 })
})

test('lower camera limit keeps the ground near the bottom instead of panning into it', () => {
  assert.deepEqual(boundPan(10000, 10000, 360, 560, 900, 1200, 960), { left: 540, top: 540 })
  assert.deepEqual(boundPan(0, 10000, 360, 560, 900, 1200, 400), { left: 0, top: 0 })
})

test('zoom ranges are bounded by fit and adapt to viewport and tree size', () => {
  assert.deepEqual(zoomRange(360, 560, 900, 1200), { min: .4, max: .4 * 3 })
  assert.deepEqual(zoomRange(360, 560, 300, 400), { min: 1, max: 3 })
  assert.deepEqual(zoomRange(720, 560, 900, 1200), { min: 560 / 1200, max: 560 / 1200 * 3 })
  assert.equal(zoomRange(360, 560, 9000, 12000).min, .04)
})
