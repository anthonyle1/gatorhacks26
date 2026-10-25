const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ buttons = [], renderers = [], current = { platform: 'youtube', videoId: 'A' }, reducedMotion = false } = {}) {
  const source = fs.readFileSync(require.resolve('../public/detection.js'), 'utf8');
  const context = {
    chrome: {}, innerHeight: 900,
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    document: { querySelectorAll: selector => selector.includes('button') ? buttons : renderers },
    getCurrentVideo: () => current,
  };
  // Expose navigation without starting extension tracking or backend requests.
  vm.runInNewContext(source.replace('  const lifecycle =', '  globalThis.nextVideo = nextVideo; return;\n  const lifecycle ='), context);
  return renderer => context.nextVideo({ platform: current?.platform || 'youtube', videoId: 'A',
    media: current?.platform === 'instagram' ? renderer : { closest: () => renderer } });
}

function button(overrides = {}) {
  return { disabled: false, getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 40, height: 40, top: 200, bottom: 240 }),
    click() { this.clicked = true; }, ...overrides };
}

test('next video uses the visible native control without scrolling', () => {
  const hidden = button({ getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const disabled = button({ disabled: true });
  const next = button();
  assert.equal(fixture({ buttons: [hidden, disabled, next] })({}), true);
  assert.equal(next.clicked, true);
  assert.equal(hidden.clicked, undefined);
  assert.equal(disabled.clicked, undefined);
});

test('missing next control scrolls to the following Short and respects reduced motion', () => {
  for (const reducedMotion of [false, true]) {
    const active = {}, next = { scrollIntoView(options) { this.options = options; } };
    assert.equal(fixture({ renderers: [active, next], reducedMotion })(active), true);
    assert.equal(next.options.behavior, reducedMotion ? 'instant' : 'smooth');
    assert.equal(next.options.block, 'start');
  }
});

test('an old warning cannot skip a different video', () => {
  const next = button();
  assert.equal(fixture({ buttons: [next], current: { platform: 'youtube', videoId: 'B' } })({}), false);
  assert.equal(next.clicked, undefined);
});

test('missing feed target fails without navigation or reload', () => {
  assert.equal(fixture()({}), false);
});

test('Instagram uses its next-reel control when available', () => {
  const next = button();
  assert.equal(fixture({ buttons: [next], current: { platform: 'instagram', videoId: 'A' } })({}), true);
  assert.equal(next.clicked, true);
});

test('Instagram falls back to scrolling the following reel', () => {
  const active = {}, next = { scrollIntoView(options) { this.options = options; } };
  assert.equal(fixture({ renderers: [active, next], current: { platform: 'instagram', videoId: 'A' } })(active), true);
  assert.equal(next.options.block, 'center');
});
