import assert from 'node:assert/strict'
import test from 'node:test'
import { growTree } from '../src/tree/layout.ts'

const topic = (id, children = [], count = 10) => ({ id, name: id, children, video_count: count,
  description: '', selected: false, inherited: false, reduce: false })
const taxonomy = () => [topic('Entertainment', [topic('Music', [topic('K-pop'), topic('Jazz')]), topic('Film')]),
  topic('Food', [topic('Desserts', [topic('Cake decorating')]), topic('Recipes')]),
  topic('Technology', [topic('AI', [topic('Generative AI')])])]
const layout = tree => growTree(tree, (text, size) => text.length * size * .57)

test('every child grows from its actual parent endpoint with tapered, curved branches', () => {
  const tree = layout(taxonomy())
  assert.equal(tree.limbs.length, 12)
  for (const limb of tree.limbs) {
    assert.match(limb.path, /^M.+ C/)
    if (!limb.parentId) continue
    const parent = tree.limbs.find(candidate => candidate.topic.id === limb.parentId)
    assert.deepEqual(limb.start, parent.end)
    const incoming = { x: parent.end.x - parent.control2.x, y: parent.end.y - parent.control2.y }
    const outgoing = { x: limb.control1.x - limb.start.x, y: limb.control1.y - limb.start.y }
    assert.ok(Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) < 1e-6, 'child must inherit its parent tangent')
    assert.ok(limb.thickness < parent.thickness)
    assert.ok(limb.width < parent.width && limb.height < parent.height)
    assert.ok(Math.hypot(limb.end.x, limb.end.y) > Math.hypot(parent.end.x, parent.end.y))
  }
})

test('taxonomy geometry is deterministic and foliage stays separated', () => {
  assert.deepEqual(layout(taxonomy()), layout(taxonomy()))
  const { limbs } = layout(taxonomy())
  for (let i = 0; i < limbs.length; i++) for (let j = i + 1; j < limbs.length; j++) {
    const a = limbs[i], b = limbs[j]
    assert.ok(Math.abs(a.end.x - b.end.x) >= (a.width + b.width) * .5 ||
      Math.abs(a.end.y - b.end.y) >= (a.height + b.height) * .5,
    `${a.topic.name} overlaps ${b.topic.name}`)
  }
})

test('moving a topic to another parent changes its physical branch connection', () => {
  const source = taxonomy()
  const before = layout(source)
  const music = source[0].children.shift()
  source[1].children.push(music)
  const after = layout(source)
  const moved = after.limbs.find(limb => limb.topic.id === 'Music')
  assert.equal(moved.parentId, 'Food')
  assert.deepEqual(moved.start, after.limbs.find(limb => limb.topic.id === 'Food').end)
  assert.notDeepEqual(moved.start, before.limbs.find(limb => limb.topic.id === 'Music').start)
})

test('ground covers the whole canopy, including an asymmetric tree, without clipping', () => {
  for (const topics of [taxonomy(), taxonomy().slice(0, 1), [topic('Small tree')]]) {
    const { ground, bounds, limbs } = layout(topics)
    for (const limb of limbs) {
      assert.ok(ground.left <= limb.end.x - limb.width / 2)
      assert.ok(ground.right >= limb.end.x + limb.width / 2)
    }
    assert.ok(bounds.x < ground.left && bounds.x + bounds.width > ground.right)
    assert.ok(bounds.y + bounds.height >= 80 * ground.heightScale)
  }
})
