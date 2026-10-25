import assert from 'node:assert/strict'
import test from 'node:test'
import { gardenTreeData } from '../src/tree/gardenTreeData.ts'

const branches = [{ id: 'parent', name: 'Parent', videoCount: 2, children: [
  { id: 'child', name: 'Child', videoCount: 1, children: [] },
] }]
const taxonomy = { tree: [{ id: 'parent', video_ids: ['a', 'b'], children: [
  { id: 'child', video_ids: ['b'], children: [] },
] }], tree_videos: [
  { video_id: 'a', analysis: { sentiment: { counts: { positive: 2, neutral: 1, negative: 0 } } } },
  { video_id: 'b', analysis: { sentiment: { counts: { positive: 2 } } } },
] }

test('tree and pruning list share counts, evidence, and inherited prune state', () => {
  const data = gardenTreeData(branches, taxonomy, { parent: true }, 2)
  const parent = data.tree[0]
  const child = parent.children[0]
  assert.equal(parent.selected, true)
  assert.equal(parent.inherited, false)
  assert.equal(child.selected, false)
  assert.equal(child.inherited, true)
  assert.equal(child.reduce, true)
  assert.equal(child.video_count, 1)
  assert.deepEqual(child.video_ids, ['b'])
  assert.deepEqual(data.tree_videos[0].analysis.sentiment.counts, { positive: 2, neutral: 1, negative: 0 })
  assert.equal(data.tree_videos[1].analysis.sentiment, null)
})

test('restoring a parent preserves independently pruned child topics', () => {
  const data = gardenTreeData(branches, taxonomy, { parent: false, child: true }, 2)
  assert.equal(data.tree[0].reduce, false)
  assert.equal(data.tree[0].children[0].inherited, false)
  assert.equal(data.tree[0].children[0].selected, true)
  assert.equal(data.tree[0].children[0].reduce, true)
})

test('topics remain usable before taxonomy evidence loads', () => {
  const data = gardenTreeData(branches, null, {}, 2)
  assert.deepEqual(data.tree[0].children[0].video_ids, [])
  assert.deepEqual(data.tree_videos, [])
  assert.equal(data.tree[0].children[0].reduce, false)
})
