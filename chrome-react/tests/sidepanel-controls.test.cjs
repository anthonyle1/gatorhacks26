const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function panel({ topics = [] } = {}) {
  let savedTopics = structuredClone(topics), restoreFailure = false;
  const restores = [];
  const nodes = new Map();
  function element() {
    return { textContent: '', hidden: false, style: {}, dataset: {}, listeners: {}, children: [],
      classList: { add() {} }, appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, setAttribute() {}, closest: () => element(),
      addEventListener(name, callback) { this.listeners[name] = callback; } };
  }
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const stored = {};
  const messages = [];
  let failure = null;
  let storageListener;
  let confirmed = true;
  const windowEvents = {}, documentEvents = {};
  let refreshes = 0;
  const context = vm.createContext({
    URLSearchParams, AbortSignal,
    crypto: { randomUUID: () => 'preference-mutation' },
    fetch: async (url, options) => {
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body); restores.push(body);
        if (restoreFailure) return { ok: false };
        savedTopics = savedTopics.filter(topic => topic.id !== body.category_id);
        return { ok: true, json: async () => ({ blacklist_version: `version-${restores.length}` }) };
      }
      return { ok: true, json: async () => ({ topics: savedTopics, days: [], videos: [] }) };
    },
    window: { addEventListener(name, listener) { windowEvents[name] = listener; }, confirm() { return confirmed; }, TopicGarden: class {
      start() {}
      refresh() { refreshes++; }
      clear() { node('#tree-health').textContent = 'Empty'; }
    } },
    document: { querySelector: node, getElementById: id => node(`#${id}`), createElement: element, createElementNS: () => element(), createTextNode: element,
      addEventListener(name, listener) { documentEvents[name] = listener; } },
    setInterval() {},
    chrome: {
      storage: { local: { async get() { return structuredClone(stored); }, async set(values) { if (failure) throw new Error(failure); Object.assign(stored, values); } },
        onChanged: { addListener(callback) { storageListener = callback; } } },
      runtime: { async sendMessage(message) {
        if (message.type === 'SYNC_DAILY_ACTIVITY') return { success: true };
        if (message.type === 'AUDIO_DIAGNOSTICS') return { success: true, data: { reachable: true, asr: { model: 'base.en', state: 'installed' } } };
        messages.push(message.type);
        if (failure) return { success: false, error: failure };
        if (message.type === 'START_SESSION') Object.assign(stored, { trackingPaused: false, localSessionId: 'session-1' });
        else Object.assign(stored, { trackingPaused: true, localSessionId: null, lastCompletedLocalSessionId: 'session-1' });
        return { success: true };
      } },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/audio-status.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/detection-core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/collection-policy.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/daily-activity.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sidepanel.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { node, stored, messages, context, windowEvents, documentEvents, restores, failRestore() { restoreFailure = true; }, refreshCount() { return refreshes; },
    confirm(value) { confirmed = value; }, fail(message) { failure = message; },
    update(values) { Object.assign(stored, values); storageListener(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), 'local'); } };
}

test('side panel starts and finishes tracking, shows live counters, and offers the saved review', async () => {
  const ui = await panel();
  const button = ui.node('#session-toggle');
  assert.equal(ui.node('#session-toggle-label').textContent, 'Start session');
  assert.equal(button.disabled, false);
  assert.equal(ui.node('#audio-enabled').checked, true);
  await button.listeners.click();
  assert.equal(ui.messages[0], 'START_SESSION');
  assert.equal(ui.node('#session-toggle-label').textContent, 'Finish & review');
  assert.equal(ui.node('#session-status').textContent, 'Recording');
  ui.update({ scrollingSession: { durationSeconds: 65, videoCount: 3 } });
  assert.equal(ui.node('#session-time').textContent, '1:05');
  assert.equal(ui.node('#session-count').textContent, '3');
  await button.listeners.click();
  assert.equal(ui.messages[1], 'FINISH_SESSION');
  assert.equal(ui.node('#session-toggle-label').textContent, 'Start session');
  assert.equal(ui.node('#session-review').hidden, false);
});

test('topics checked keeps the full sorted list, draws a pile, and unprunes a topic', async () => {
  const ui = await panel({ topics: [{ id: 'cooking', name: 'Cooking', descendants: [] },
    { id: 'arts', name: 'Arts', descendants: [{ id: 'painting', name: 'Painting' }] }] });
  const list = ui.node('#detection-topics-list');
  assert.deepEqual(list.children.map(row => row.children[0].textContent), ['Arts', 'Cooking', 'Painting']);
  assert.equal(ui.node('#detection-topics-count').textContent, '3');
  assert.equal(ui.node('#detection-compost').children.length, 1);
  await list.children[1].children[1].listeners.click();
  assert.deepEqual(ui.restores, [{ category_id: 'cooking', reduce: false }]);
  assert.deepEqual(list.children.map(row => row.children[0].textContent), ['Arts', 'Painting']);
  assert.equal(ui.stored.detectionBlacklistVersion, 'version-1');
  assert.equal(ui.stored.detectionPreferencesPending, false);
});

test('restoring an inherited topic names and restores all selected covering branches', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [{ id: 'painting', name: 'Painting' }] },
    { id: 'painting', name: 'Painting', descendants: [] }] });
  const row = ui.node('#detection-topics-list').children[1];
  assert.equal(row.children[1].textContent, 'Unprune parent');
  assert.match(row.children[1].title, /Arts.*Painting/);
  await row.children[1].listeners.click();
  assert.deepEqual(ui.restores, [{ category_id: 'arts', reduce: false }, { category_id: 'painting', reduce: false }]);
  assert.equal(ui.node('#detection-topics-list').children.length, 0);
  assert.equal(ui.node('#detection-topics-count').textContent, '0');
});

test('failed unprune preserves the saved list and offers retry', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [] }] });
  ui.failRestore();
  await ui.node('#detection-topics-list').children[0].children[1].listeners.click();
  assert.equal(ui.node('#detection-topics-list').children.length, 1);
  assert.match(ui.node('#detection-topics-feedback').textContent, /Could not finish unpruning/);
  assert.equal(Boolean(ui.node('#detection-topics-list').children[0].children[1].disabled), false);
  assert.equal(ui.stored.detectionPreferencesPending, false);
});

test('automatic skipping defaults off, persists when toggled, and restores state on save failure', async () => {
  const ui = await panel(); const setting = ui.node('#auto-skip-topics');
  assert.equal(setting.checked, false); assert.equal(setting.disabled, false);
  await setting.listeners.change({ target: { checked: true } });
  assert.equal(ui.stored.detectionAutoSkip, true); assert.equal(setting.checked, true);
  ui.fail('Storage unavailable');
  await setting.listeners.change({ target: { checked: false } });
  assert.equal(setting.checked, true);
  assert.equal(ui.node('#auto-skip-error').hidden, false);
});

test('side panel shows a failed Finish and keeps the session available for retry', async () => {
  const ui = await panel();
  const button = ui.node('#session-toggle');
  await button.listeners.click();
  ui.fail('Backend unavailable');
  await button.listeners.click();
  assert.equal(ui.node('#session-error').hidden, false);
  assert.equal(ui.node('#session-error').textContent, 'Backend unavailable');
  assert.equal(ui.node('#session-toggle-label').textContent, 'Finish & review');
  assert.equal(button.disabled, false);
});

test('new qualified reels update the rolling count immediately without relying on session totals', async () => {
  const ui = await panel();
  ui.update({ dailyActivityEvents: [{ session_id: 'session-1', event: {
    event_id: 'live', video_id: 'reel', platform: 'instagram', title: 'New reel',
    started_at: new Date().toISOString(), dwell_seconds: 3 } }] });
  assert.equal(ui.node('#today-count').textContent, '1 video');
  assert.match(ui.node('#today-summary').textContent, /1 videos awaiting assessment/);
  assert.equal(ui.node('#today-video-list').children[0].children[0].textContent, 'New reel');
});

test('reset requires confirmation and empties the tree after success', async () => {
  const ui = await panel();
  ui.confirm(false);
  await ui.node('#tree-reset').listeners.click();
  assert.equal(ui.messages.length, 0);
  ui.confirm(true);
  await ui.node('#tree-reset').listeners.click();
  assert.equal(ui.messages[0], 'RESET_TOPIC_TREE');
  assert.equal(ui.node('#tree-health').textContent, 'Empty');
  assert.equal(ui.node('#tree-reset').disabled, false);
});

test('showing or refocusing the extension refreshes topics immediately', async () => {
  const ui = await panel();
  ui.windowEvents.focus();
  ui.windowEvents.pageshow();
  ui.documentEvents.visibilitychange();
  assert.equal(ui.refreshCount(),3);
  ui.context.document.visibilityState = 'hidden';
  ui.documentEvents.visibilitychange();
  assert.equal(ui.refreshCount(),3);
  ui.context.document.visibilityState = 'visible';
  ui.documentEvents.visibilitychange();
  assert.equal(ui.refreshCount(),4);
});
