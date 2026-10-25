import assert from 'node:assert/strict'
import test from 'node:test'
import { sortTopics } from '../src/tree/sortTopics.ts'

const tree = [{ id: 'low', children: [
  { id: 'child-low', children: [] }, { id: 'child-high', children: [] },
] }, { id: 'unrated', children: [] }, { id: 'high', children: [] }, { id: 'equal', children: [] }]
const scores = new Map([['low', 0], ['high', .9], ['equal', .9], ['unrated', null], ['child-low', .1], ['child-high', .8]])

test('criticalness sorts highest first, preserves nesting, and leaves source order intact', () => {
  const sorted = sortTopics(tree, scores, 'critical-desc')
  assert.deepEqual(sorted.map(topic => topic.id), ['high', 'equal', 'low', 'unrated'])
  assert.deepEqual(sorted[2].children.map(topic => topic.id), ['child-high', 'child-low'])
  assert.deepEqual(tree.map(topic => topic.id), ['low', 'unrated', 'high', 'equal'])
  assert.deepEqual(tree[0].children.map(topic => topic.id), ['child-low', 'child-high'])
})

test('lowest-first keeps zero scores above unrated topics and keeps ties stable', () => {
  const sorted = sortTopics(tree, scores, 'critical-asc')
  assert.deepEqual(sorted.map(topic => topic.id), ['low', 'high', 'equal', 'unrated'])
  assert.deepEqual(sorted[0].children.map(topic => topic.id), ['child-low', 'child-high'])
})

test('tree order restores the original hierarchy and absent scores are unrated', () => {
  assert.equal(sortTopics(tree, scores, 'tree'), tree)
  assert.deepEqual(sortTopics(tree, new Map(), 'critical-desc').map(topic => topic.id), tree.map(topic => topic.id))
  assert.deepEqual(sortTopics([], scores, 'critical-desc'), [])
})
