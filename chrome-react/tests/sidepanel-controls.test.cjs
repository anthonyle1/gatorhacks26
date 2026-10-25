const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function panel({ topics = [], calendarDays = [] } = {}) {
  let savedTopics = structuredClone(topics), restoreFailure = false, deleteFailure = false;
  const restores = [], deletions = [], confirmations = [], classChanges = [];
  const nodes = new Map();
  function element() {
    return { textContent: '', hidden: false, style: {}, dataset: {}, listeners: {}, children: [],
      classList: { add(name) { classChanges.push(name); }, remove() {} }, appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { (this.attributes ||= {})[name] = value; }, closest: () => element(),
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
      if (options?.method === 'DELETE') {
        const body = JSON.parse(options.body); deletions.push(body);
        if (deleteFailure) return { ok: false, json: async () => ({ detail: 'Deletion failed' }) };
        const removed = new Set(body.category_ids);
        for (const root of savedTopics) if (removed.has(root.id)) for (const child of root.descendants || []) removed.add(child.id);
        savedTopics = savedTopics.map(root => ({ ...root, permanent: removed.has(root.id),
          descendants: (root.descendants || []).map(child => ({ ...child, permanent: removed.has(child.id) })) }));
        return { ok: true, json: async () => ({ blacklist_version: 'deleted-version', deleted_ids: [...removed] }) };
      }
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body); restores.push(body);
        if (restoreFailure) return { ok: false };
        savedTopics = savedTopics.filter(topic => topic.id !== body.category_id);
        return { ok: true, json: async () => ({ blacklist_version: `version-${restores.length}` }) };
      }
      return { ok: true, json: async () => ({ topics: savedTopics, blacklist_version: 'a'.repeat(64), days: calendarDays, videos: [] }) };
    },
    window: { matchMedia: () => ({ matches: true }), addEventListener(name, listener) { windowEvents[name] = listener; }, confirm(message) { confirmations.push(message); return confirmed; }, TopicGarden: class {
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/compost.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sidepanel.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const rows = () => {
    const collect = items => items.flatMap(item => [item.children[0], ...(item.children[1] ? collect(item.children[1].children) : [])]);
    return collect(node('#detection-topics-list').children);
  };
  return { node, stored, messages, context, windowEvents, documentEvents, restores, deletions, confirmations, classChanges, rows,
    row: name => rows().find(row => row.children[1].textContent === name),
    failDelete() { deleteFailure = true; }, failRestore() { restoreFailure = true; }, refreshCount() { return refreshes; },
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

test('topics checked keeps the full nested list, draws a pile, and unprunes a topic', async () => {
  const ui = await panel({ topics: [{ id: 'cooking', name: 'Cooking', descendants: [] },
    { id: 'arts', name: 'Arts', descendants: [{ id: 'painting', name: 'Painting' }] }] });
  const list = ui.node('#detection-topics-list');
  assert.deepEqual(ui.rows().map(row => row.children[1].textContent), ['Arts', 'Painting', 'Cooking']);
  assert.equal(ui.node('#detection-topics-count').textContent, '3');
  assert.equal(ui.node('#detection-compost').children.length, 2);
  await ui.row('Cooking').children[2].listeners.click();
  assert.deepEqual(ui.restores, [{ category_id: 'cooking', reduce: false }]);
  assert.deepEqual(ui.rows().map(row => row.children[1].textContent), ['Arts', 'Painting']);
  assert.equal(ui.stored.detectionBlacklistVersion, 'version-1');
  assert.equal(ui.stored.detectionPreferencesPending, false);
});

test('inherited topics have no unprune-parent button; parent and independently pruned child restore separately', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [{ id: 'painting', name: 'Painting' }] },
    { id: 'painting', name: 'Painting', descendants: [] }] });
  const row = ui.row('Painting');
  assert.equal(row.children.some(node => node.className === 'detection-topic__restore'), false);
  await ui.row('Arts').children[2].listeners.click();
  assert.deepEqual(ui.restores, [{ category_id: 'arts', reduce: false }]);
  assert.equal(ui.row('Painting').children[2].textContent, 'Unprune');
  await ui.row('Painting').children[2].listeners.click();
  assert.deepEqual(ui.restores, [{ category_id: 'arts', reduce: false }, { category_id: 'painting', reduce: false }]);
  assert.equal(ui.node('#detection-topics-list').children.length, 0);
  assert.equal(ui.node('#detection-topics-count').textContent, '0');
});

test('failed unprune preserves the saved list and offers retry', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [] }] });
  ui.failRestore();
  await ui.row('Arts').children[2].listeners.click();
  assert.equal(ui.node('#detection-topics-list').children.length, 1);
  assert.match(ui.node('#detection-topics-feedback').textContent, /Could not finish unpruning/);
  assert.equal(Boolean(ui.row('Arts').children[2].disabled), false);
  assert.equal(ui.stored.detectionPreferencesPending, false);
});

test('the pile has a branch for every listed topic including children and topics beyond eight', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants:
    Array.from({ length: 11 }, (_, i) => ({ id: `child-${i}`, name: `Child ${i}`, parent_id: 'arts' })) }] });
  const svg = ui.node('#detection-compost').children[0];
  const pieces = svg.children.filter(node => node.children[0]?.attributes?.class === 'detection-compost__piece');
  assert.equal(pieces.length, 12);
  assert.equal(ui.rows().length, 12);
});

test('Clear list unprunes all selected topics and plays the burn animation without deleting data', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [{ id: 'paint', name: 'Painting' }] },
    { id: 'paint', name: 'Painting', parent_id: 'arts', descendants: [] }] });
  assert.equal(ui.node('#compost-clear').disabled, false);
  await ui.node('#compost-clear').listeners.click();
  assert.deepEqual(ui.restores, [{ category_id: 'arts', reduce: false }, { category_id: 'paint', reduce: false }]);
  assert.equal(ui.deletions.length, 0);
  assert.equal(ui.confirmations.length, 0);
  assert.equal(ui.classChanges.includes('compost-item--burning'), true);
  assert.equal(ui.classChanges.includes('compost-piece--burning'), true);
  assert.equal(ui.classChanges.includes('detection-compost--burning'), true);
  assert.equal(ui.rows().length, 0);
  assert.equal(ui.node('#compost-clear').disabled, true);
});

test('a failed clear keeps topics visible and allows retry without deletion', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [] }] });
  ui.failRestore(); await ui.node('#compost-clear').listeners.click();
  assert.ok(ui.row('Arts'));
  assert.equal(ui.deletions.length, 0);
  assert.equal(ui.classChanges.includes('compost-item--burning'), false);
  assert.equal(ui.node('#compost-clear').disabled, false);
});

test('permanent pruning requires confirmation before any deletion', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [] }] });
  ui.confirm(false);
  await ui.row('Arts').children[3].listeners.click();
  assert.equal(ui.deletions.length, 0);
  assert.match(ui.confirmations[0], /cannot be undone/);
  assert.equal(ui.classChanges.includes('compost-item--burning'), false);
});

test('permanent pruning burns compost vines after success and removes only the selected branch', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [{ id: 'paint', name: 'Painting', parent_id: 'arts' }] }] });
  await ui.row('Painting').children.find(node => node.className === 'compost-delete').listeners.click();
  assert.deepEqual(ui.deletions[0].category_ids, ['paint']);
  assert.equal(ui.deletions[0].confirmed, true);
  assert.equal(ui.deletions[0].blacklist_version, 'a'.repeat(64));
  assert.equal(ui.classChanges.includes('compost-item--burning'), true);
  assert.equal(ui.classChanges.includes('detection-compost--burning'), true);
  assert.equal(ui.row('Painting'), undefined);
  assert.ok(ui.row('Arts'));
  assert.equal(ui.stored.detectionBlacklistVersion, 'deleted-version');
});

test('failed permanent deletion leaves the topic and vines intact for retry', async () => {
  const ui = await panel({ topics: [{ id: 'arts', name: 'Arts', descendants: [] }] });
  ui.failDelete(); await ui.row('Arts').children[3].listeners.click();
  assert.ok(ui.row('Arts'));
  assert.equal(ui.classChanges.includes('compost-item--burning'), false);
  assert.match(ui.node('#detection-topics-feedback').textContent, /Deletion failed/);
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

test('calendar selection uses a pressed border on one recorded date at a time and weeks start Monday', async () => {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const key = day => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const recorded = day => ({ date: key(day), videos_watched: 2, warning_count: 1 });
  const days = now.getDate() > 1 ? [1, 2] : [1];
  const ui = await panel({ calendarDays: days.map(recorded) });
  const cells = ui.node('#cal-grid').children;
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const first = cells[offset];
  assert.equal(first.children[0].textContent, '1');
  assert.equal(first.children[1].textContent, '2 videos');
  assert.equal(first.attributes['aria-pressed'], 'false');
  first.listeners.click({ preventDefault() {} });
  assert.equal(first.attributes['aria-pressed'], 'true');
  if (days.length > 1) {
    const second = cells[offset + 1];
    second.listeners.click({ preventDefault() {} });
    assert.equal(first.attributes['aria-pressed'], 'false');
    assert.equal(second.attributes['aria-pressed'], 'true');
  }
  await new Promise(resolve => setImmediate(resolve));
});
