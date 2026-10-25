import assert from 'node:assert/strict'
import test from 'node:test'
import { dailyScore } from '../src/components/daily/score.ts'

test('daily concern score uses the extension meter balance and leaves unrated days unavailable', () => {
  assert.equal(dailyScore(0, 0), null)
  assert.equal(dailyScore(0, 5), 0)
  assert.equal(dailyScore(5, 0), 100)
  assert.equal(dailyScore(2, 2), 50)
  assert.equal(dailyScore(1, 2), 33)
})
