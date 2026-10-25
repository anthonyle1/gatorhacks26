const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.events = {}; this.scrollTop = 0; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of nodes) node.parent = this; this.children.unshift(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
  focus() { this.focused = true; }
  addEventListener(name, fn) { this.events[name] = fn; }
  attachShadow() { return this.shadow = new Element('shadow'); }
  get scrollHeight() { return (this.children[0]?.children.length || 0) * 70; }
}

function fixture({ reducedMotion = false, storage = new Map(), initialSession = 'session-1', paused = false, navigationAvailable = false } = {}) {
  const root = new Element('html');
  const head = new Element('head');
  const timers = new Map();
  let id = 0;
  let skips = 0;
  const nextButton = { getBoundingClientRect: () => ({ width: 40, height: 40, top: 100, bottom: 140 }),
    getAttribute: () => null, click() { skips++; } };
  const context = {
    chrome: { runtime: { getURL: path => `chrome-extension://test/${path}` } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    innerHeight: 900, getCurrentVideo: () => ({ platform: 'youtube', videoId: '1' }),
    document: { documentElement: root, head, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), querySelector: () => null,
      querySelectorAll: selector => navigationAvailable && selector.includes('button') ? [nextButton] : [] },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  const source = fs.readFileSync(require.resolve('../public/detection.js'), 'utf8');
  vm.runInNewContext(source.replace('  const lifecycle =', `
    tracking = ${!paused};
    restoreReminders(${JSON.stringify(initialSession)});
    globalThis.alerts = { showReminder, removeReminder, resetReminders, updateReminderSession, cancelReminderForNavigation,
      pause() { tracking = false; removeReminder(); renderReminders(); },
      resume() { tracking = true; renderReminders(); } };
    return;
    const lifecycle =`), context);
  return {
    ...context.alerts, root, head, storage, skips: () => skips,
    toggle() {
      root.children[0].shadow.children.find(node => node.className === 'toggle').events.click();
      const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn());
    },
    show(index, options) {
      context.alerts.showReminder(`Category ${index}`, { platform: 'youtube', videoId: String(index),
        media: { closest: () => ({ querySelector: selector => selector.includes('video-title') ? { textContent: `Title ${index}` } : null }) } }, options);
    },
    stack: () => root.children[0]?.shadow.children.find(node => node.tag === 'section'),
    expire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
  };
}

test('new alerts stack below compact title/category history without duplicate hosts', () => {
  const f = fixture(); f.show(1); f.show(2); f.toggle();
  assert.equal(f.root.children.length, 1);
  const [history, active] = f.stack().children;
  assert.equal(active.tag, 'aside');
  assert.equal(active.children.find(node => node.className === 'next').textContent, 'Next video');
  const row = history.children[0].children[0];
  assert.deepEqual(row.children.map(node => node.textContent), ['Title 1', 'Category 1']);
  assert.equal(row.children.length, 2);
});

test('automatic skipping is off by default and names the matched topic when enabled', () => {
  const f = fixture({ navigationAvailable: true }); f.show(1);
  assert.equal(f.skips(), 0);
  f.show(1, { autoSkip: true }); assert.equal(f.skips(), 1);
  const alert = f.stack().children[0];
  assert.equal(alert.children[0].textContent, 'Video automatically skipped');
  assert.match(alert.children[1].textContent, /Category 1/);
  assert.equal(alert.children.some(node => node.className === 'next'), false);
  f.cancelReminderForNavigation();
  assert.equal(f.stack().hidden, false);
  f.expire(); f.expire();
  assert.equal(f.stack().hidden, true);
});

test('automatic skip failure retains the reminder and manual next action', () => {
  const f = fixture(); f.show(1, { autoSkip: true });
  const alert = f.stack().children[0];
  assert.match(alert.children[1].textContent, /Category 1/);
  assert.match(alert.children[1].textContent, /couldn't find the next video/);
  assert.equal(alert.children.some(node => node.className === 'next'), true);
});

test('history loads only three rows initially and reveals three more on upward input', () => {
  const f = fixture(); for (let i = 1; i <= 9; i++) f.show(i); f.toggle();
  const history = f.stack().children[0], list = history.children[0];
  assert.equal(list.children.length, 3);
  assert.equal(list.children[0].children[0].textContent, 'Title 6');
  history.scrollTop = 0;
  history.events.wheel({ deltaY: -1 });
  assert.equal(list.children.length, 6);
  assert.equal(list.children[0].children[0].textContent, 'Title 3');
  assert.equal(history.scrollTop, 210);
});

test('dismissal and navigation preserve recent history; session reset clears it', () => {
  const f = fixture(); f.show(1); f.toggle(); f.removeReminder(); f.expire();
  assert.equal(f.stack().children.length, 1);
  assert.equal(f.stack().children[0].children[0].children[0].children[0].textContent, 'Title 1');
  f.show(2); f.removeReminder(); f.expire();
  assert.equal(f.stack().children[0].children[0].children.length, 2);
  f.resetReminders(); assert.equal(f.root.children.length, 0);
  f.show(3); f.toggle(); assert.equal(f.stack().children.length, 1);
  assert.equal(f.stack().children[0].tag, 'aside');
});

test('completed session history stays available while tracking is paused', () => {
  const f = fixture(); f.show(1); f.toggle(); f.pause();
  assert.equal(f.root.children.length, 1);
  assert.equal(f.stack().children[0].className, 'history');
  f.resume(); assert.equal(f.stack().children[0].className, 'history');
});

test('new alerts remain visible with history closed and keep their next-video action', () => {
  const f = fixture(); f.show(1);
  assert.equal(f.stack().hidden, false);
  assert.equal(f.stack().children.length, 1);
  assert.equal(f.stack().children[0].children.find(node => node.className === 'next').textContent, 'Next video');
  assert.match(f.head.children[0].textContent, /100% - 0px/);
  f.toggle(); assert.equal(f.stack().hidden, false);
  assert.match(f.head.children[0].textContent, /100% - min\(360px, 48vw\)/);
  f.toggle(); f.show(2);
  assert.equal(f.stack().hidden, false);
  assert.equal(f.stack().children.length, 1);
  f.toggle(); assert.equal(f.stack().children.length, 2);
});

test('Escape closes the stack and session reset releases reserved page space', () => {
  const f = fixture(); f.show(1); f.show(2); f.toggle();
  f.stack().events.keydown({ key: 'Escape' });
  assert.equal(f.stack().children[0].className, 'history leaving');
  assert.equal(f.stack().children[1].inert, undefined);
  f.expire();
  assert.equal(f.stack().hidden, false);
  assert.equal(f.stack().children[0].tag, 'aside');
  f.resetReminders(); assert.equal(f.head.children.length, 0);
});

test('dismissal slides out before hiding the newest alert', () => {
  const f = fixture(); f.show(1); f.removeReminder();
  assert.equal(f.stack().className, 'stack leaving');
  assert.equal(f.stack().inert, true);
  f.expire();
  assert.equal(f.stack().hidden, true);
  assert.match(f.head.children[0].textContent, /100% - 0px/);
});

test('a new arrival cancels a pending exit instead of being hidden by its timer', () => {
  const f = fixture(); f.show(1); f.removeReminder(); f.show(2); f.expire();
  assert.equal(f.stack().hidden, false);
  assert.equal(f.stack().className, 'stack');
  assert.match(f.stack().children[0].children[1].textContent, /Category 2/);
});

test('reduced motion dismisses immediately without an exit delay', () => {
  const f = fixture({ reducedMotion: true }); f.show(1); f.removeReminder();
  assert.equal(f.stack().hidden, true);
  f.expire(); assert.equal(f.stack().hidden, true);
});

test('only opening history shifts the video; arrivals and dismissal preserve its current layout', () => {
  const f = fixture();
  const before = f.head.children[0].textContent;
  f.show(1); assert.equal(f.head.children[0].textContent, before);
  assert.match(before, /100% - 0px/);
  f.toggle();
  const opened = f.head.children[0].textContent;
  assert.match(opened, /100% - min\(360px, 48vw\)/);
  f.show(2); assert.equal(f.head.children[0].textContent, opened);
  f.removeReminder(); f.expire(); assert.equal(f.head.children[0].textContent, opened);
  f.toggle(); assert.equal(f.head.children[0].textContent, before);
});

test('history survives session completion and page reload, then clears for a new session', () => {
  const original = fixture(); original.show(1); original.show(2);
  original.updateReminderSession(undefined); original.pause();
  const reloaded = fixture({ storage: original.storage, paused: true });
  reloaded.toggle();
  const rows = reloaded.stack().children[0].children[0].children;
  assert.deepEqual(rows.map(row => row.children[0].textContent), ['Title 1', 'Title 2']);
  reloaded.updateReminderSession('session-2');
  assert.equal(reloaded.root.children.length, 0);
  assert.equal(reloaded.storage.has('pruneAlertHistory'), false);
});

test('opening and closing history does not replay the newest alert animation', () => {
  const f = fixture(); f.show(1); f.show(2);
  assert.equal(f.stack().children[0].className, 'arriving');
  f.toggle(); assert.equal(f.stack().children[1].className, undefined);
  f.toggle(); assert.equal(f.stack().children[0].className, undefined);
});
