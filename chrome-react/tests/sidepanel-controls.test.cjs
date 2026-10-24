const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function panel() {
  const nodes = new Map();
  function element() {
    return { textContent: '', hidden: false, style: {}, dataset: {}, listeners: {},
      classList: { add() {} }, appendChild() {}, replaceChildren() {}, setAttribute() {},
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
  const context = vm.createContext({
    window: { confirm() { return confirmed; } },
    document: { querySelector: node, createElement: element, createTextNode: element },
    setInterval() {},
    chrome: {
      storage: { local: { async get() { return structuredClone(stored); } },
        onChanged: { addListener(callback) { storageListener = callback; } } },
      runtime: { async sendMessage(message) {
        messages.push(message.type);
        if (failure) return { success: false, error: failure };
        if (message.type === 'START_SESSION') Object.assign(stored, { trackingPaused: false, localSessionId: 'session-1' });
        else Object.assign(stored, { trackingPaused: true, localSessionId: null, lastCompletedLocalSessionId: 'session-1' });
        return { success: true };
      } },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sidepanel.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { node, stored, messages, confirm(value) { confirmed = value; }, fail(message) { failure = message; },
    update(values) { Object.assign(stored, values); storageListener(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), 'local'); } };
}

test('side panel starts and finishes tracking, shows live counters, and offers the saved review', async () => {
  const ui = await panel();
  const button = ui.node('#session-toggle');
  assert.equal(button.textContent, 'Start tracking');
  assert.equal(button.disabled, false);
  await button.listeners.click();
  assert.equal(ui.messages[0], 'START_SESSION');
  assert.equal(button.textContent, 'Finish session');
  assert.equal(ui.node('#session-status').textContent, 'Recording');
  ui.update({ scrollingSession: { durationSeconds: 65, videoCount: 3 } });
  assert.equal(ui.node('#session-stats').textContent, '1:05 \u00b7 3 videos');
  await button.listeners.click();
  assert.equal(ui.messages[1], 'FINISH_SESSION');
  assert.equal(button.textContent, 'Start tracking');
  assert.equal(ui.node('#session-review').hidden, false);
});

test('side panel shows a failed Finish and keeps the session available for retry', async () => {
  const ui = await panel();
  const button = ui.node('#session-toggle');
  await button.listeners.click();
  ui.fail('Backend unavailable');
  await button.listeners.click();
  assert.equal(ui.node('#session-error').hidden, false);
  assert.equal(ui.node('#session-error').textContent, 'Backend unavailable');
  assert.equal(button.textContent, 'Finish session');
  assert.equal(button.disabled, false);
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
