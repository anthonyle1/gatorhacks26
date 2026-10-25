import assert from 'node:assert/strict'
import test from 'node:test'
import { compostTopics } from '../src/tree/compostTopics.ts'

const tree = [{ id: 'parent', name: 'Parent', children: [
  { id: 'child', name: 'Child', children: [{ id: 'leaf', name: 'Leaf' }] },
  { id: 'other', name: 'Other' },
] }, { id: 'unrelated', name: 'Unrelated' }]

test('a pruned child keeps ancestor context and its own descendants', () => {
  const result = compostTopics(tree, new Set(['child']))
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'parent')
  assert.deepEqual(result[0].coverage, [])
  assert.equal(result[0].children.length, 1)
  const child = result[0].children[0]
  assert.deepEqual(child.coverage, [{ id: 'child', name: 'Child' }])
  assert.deepEqual(child.children[0].coverage, child.coverage)
})

test('parent and child cuts are not duplicated and identify inherited pruning', () => {
  const result = compostTopics(tree, new Set(['parent', 'child']))
  assert.equal(result[0].children.length, 2)
  const child = result[0].children[0]
  assert.equal(child.id, 'child')
  assert.deepEqual(child.coverage.map(topic => topic.id), ['parent', 'child'])
  assert.deepEqual(child.children[0].coverage, child.coverage)
})

test('restoring the parent keeps a separately pruned child available to restore', () => {
  const result = compostTopics(tree, new Set(['child']))
  assert.deepEqual(result[0].children[0].coverage.map(topic => topic.id), ['child'])
  assert.deepEqual(compostTopics(tree, new Set()), [])
})
