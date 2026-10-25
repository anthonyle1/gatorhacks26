const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../public/detection-core.js');
const { Lifecycle, delay } = globalThis.PruneDetection;

function fixture() {
  let snapshot = { key: 'youtube:A:1:v1' }, elapsed = 0, sequence = 0;
  const timers = new Map(), calls = [];
  const clock = {
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: elapsed + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  let cancellations = 0;
  const lifecycle = new Lifecycle({ read: () => snapshot, analyze: (video, generation) => calls.push({ video, generation }), cancel: () => cancellations++, clock });
  return { lifecycle, calls, set: value => { snapshot = value; lifecycle.reconcile(); },
    tick(ms) { elapsed += ms; for (const [id, timer] of timers) if (timer.at <= elapsed) { timers.delete(id); timer.fn(); } },
    cancellations: () => cancellations };
}

test('delay defaults and allowed half-second increments', () => {
  for (const value of [undefined, null, NaN, Infinity, '5', 1, 10.5, 2.2]) assert.equal(delay(value), 1.5);
  for (const value of [1.5, 2, 5.5, 10]) assert.equal(delay(value), value);
});

test('rapid skips never analyze; full continuous engagement does', () => {
  const f = fixture(); f.lifecycle.reconcile(); f.tick(1000);
  f.set({ key: 'youtube:B:2:v1' }); f.tick(1000); assert.equal(f.calls.length, 0);
  f.tick(500); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].video.key, 'youtube:B:2:v1');
  f.lifecycle.reconcile(); f.tick(5000); assert.equal(f.calls.length, 1);
});

test('inactive playback resets the continuous timer', () => {
  const f = fixture(); f.lifecycle.reconcile(); f.tick(1000); f.set(null); f.tick(10000);
  assert.equal(f.calls.length, 0); f.set({ key: 'youtube:A:1:v1' }); f.tick(1499);
  assert.equal(f.calls.length, 0); f.tick(1); assert.equal(f.calls.length, 1);
});

test('A to B to A rejects earlier response despite identical video identity', () => {
  const f = fixture(); f.lifecycle.reconcile(); f.tick(1500); const original = f.calls[0];
  f.set({ key: 'youtube:B:2:v1' }); f.set({ key: 'youtube:A:1:v1' }); f.tick(1500);
  assert.equal(f.lifecycle.complete(original.generation, original.video.key), false);
  assert.equal(f.lifecycle.complete(f.calls[1].generation, f.calls[1].video.key), true);
});

test('blacklist changes invalidate outstanding responses', () => {
  const f = fixture(); f.lifecycle.reconcile(); f.tick(1500); const old = f.calls[0];
  f.set({ key: 'youtube:A:1:v2' });
  assert.equal(f.lifecycle.current(old.generation, old.video.key), false);
  assert.equal(f.lifecycle.state, 'WAITING');
});

test('increasing and decreasing delay require a full new wait', () => {
  const f = fixture(); f.lifecycle.reconcile(); f.tick(1000); f.lifecycle.configure(10);
  f.tick(9999); assert.equal(f.calls.length, 0); f.tick(1); assert.equal(f.calls.length, 1);
  const old = f.calls[0]; f.lifecycle.configure(1.5);
  assert.equal(f.lifecycle.current(old.generation, old.video.key), false);
  f.tick(1499); assert.equal(f.calls.length, 1); f.tick(1); assert.equal(f.calls.length, 2);
});

test('timer verifies current visibility even when an event was missed', () => {
  let visible = true, callback, calls = 0;
  const lifecycle = new Lifecycle({ read: () => visible ? { key: 'A' } : null, analyze: () => calls++, cancel() {},
    clock: { setTimeout(fn) { callback = fn; }, clearTimeout() {} } });
  lifecycle.reconcile(); visible = false; callback(); assert.equal(calls, 0);
});
