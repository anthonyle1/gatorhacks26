const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../public/compost.js');
const { hierarchy } = globalThis.PruneCompost;

test('compost children keep their real parent and duplicate selected children appear once', () => {
  const result = hierarchy([{ id: 'arts', name: 'Arts', descendants: [
    { id: 'paint', name: 'Painting', parent_id: 'arts' }, { id: 'water', name: 'Watercolor', parent_id: 'paint' }] },
    { id: 'paint', name: 'Painting', parent_id: 'arts', descendants: [{ id: 'water', name: 'Watercolor', parent_id: 'paint' }] }]);
  assert.equal(result.roots.length, 1);
  assert.equal(result.roots[0].children[0].children[0].id, 'water');
  assert.equal(result.count, 3);
  assert.equal(result.nodes.get('water').coverage.length, 2);
});

test('independently pruned children appear beneath context parents without making those parents deletable', () => {
  const result = hierarchy([{ id: 'paint', name: 'Painting', parent_id: 'arts',
    ancestors: [{ id: 'arts', name: 'Arts', parent_id: null }], descendants: [] }]);
  assert.equal(result.roots[0].id, 'arts');
  assert.equal(result.roots[0].coverage.length, 0);
  assert.equal(result.roots[0].children[0].coverage.length, 1);
  assert.equal(result.count, 1);
});

test('permanently deleted topics are absent from the restorable compost bin', () => {
  const result = hierarchy([{ id: 'arts', name: 'Arts', descendants: [{ id: 'paint', name: 'Painting', permanent: true }] },
    { id: 'paint', name: 'Painting', permanent: true, descendants: [] }]);
  assert.equal(result.count, 1);
  assert.equal(result.nodes.has('paint'), false);
  assert.equal(result.selected.length, 1);
});
