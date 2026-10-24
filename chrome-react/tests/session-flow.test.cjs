const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function background(failUpload = false) {
  const state = {};
  const calls = [];
  const listeners = [];
  const context = {
    console: { log() {}, error() {} },
    chrome: {
      storage: { local: {
        async get(key) { return Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, structuredClone(state[name])])); },
        async set(values) { Object.assign(state, structuredClone(values)); },
        async remove(key) { delete state[key]; },
      } },
      runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } },
      tabs: { async query() { return [{ id: 1 }]; }, async sendMessage(id, message) {
        if (message.type !== 'FLUSH_SESSION') return { success: true };
        return new Promise(resolve => listeners[0]({ type: 'VIDEO_EVENT', event: {
          event_id: 'final-event', video_id: 'abcdefghijk', platform: 'youtube', sequence_number: 1,
          started_at: '2026-10-24T12:00:00Z', ended_at: '2026-10-24T12:00:02Z', dwell_seconds: 2,
        } }, {}, resolve));
      } },
    },
    async fetch(url, options) {
      calls.push({ url, options });
      if (url.endsWith('/events') && failUpload) return { ok: false, status: 503, text: async () => 'Database unavailable' };
      return { ok: true, json: async () => url.endsWith('/sessions') ? { session_id: 'session-1' } : { status: 'completed', saved_events: 1 } };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/background.js'), 'utf8'), context);
  return { context, state, calls };
}

test('finish flushes the final video before closing the session without a queue deadlock', async () => {
  const { context, state, calls } = background();
  await context.finishScrollingSession();
  assert.equal(state.lastCompletedSessionId, 'session-1');
  assert.equal(state.backendSessionId, undefined);
  assert.equal(state.trackingPaused, true);
  assert.equal(state.pendingEvents.length, 0);
  const upload = calls.findIndex(call => call.url.endsWith('/events'));
  const finish = calls.findIndex(call => call.url.endsWith('/finish'));
  assert.ok(upload >= 0 && finish > upload);
  assert.equal(calls.some(call => call.url.includes('/analysis/')), false);
});

test('failed event upload preserves queued videos and does not finish the session', async () => {
  const { context, state, calls } = background(true);
  await assert.rejects(context.finishScrollingSession());
  assert.equal(state.pendingEvents.length, 1);
  assert.equal(state.backendSessionId, 'session-1');
  assert.equal(calls.some(call => call.url.endsWith('/finish')), false);
});


function content() {
  const listeners = [];
  const messages = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => 'stable-event-id' },
    setInterval() { return 1; }, clearInterval() {},
    window: { location: { hostname: 'www.youtube.com', pathname: '/shorts/first' }, addEventListener() {} },
    document: { title: 'First video title', hidden: false, querySelector() { return null; } },
    chrome: {
      storage: { local: { async get() { return { trackingPaused: true }; }, async set() {} } },
      runtime: {
        lastError: undefined,
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message, callback) { messages.push(structuredClone(message)); callback({ success: true }); },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/content.js'), 'utf8'), context);
  return { context, listeners, messages };
}

test('navigation sends the previous video metadata with its original identity', async () => {
  const { context, messages } = content();
  await context.trackScrolling();
  context.window.location.pathname = '/shorts/second';
  context.document.title = 'Second video title';
  await context.trackScrolling();
  assert.equal(messages[0].event.video_id, 'first');
  assert.equal(messages[0].event.title, 'First video title');
});

test('a failed content message is retried with the same event ID when finishing', async () => {
  const { context, listeners, messages } = content();
  context.chrome.runtime.lastError = { message: 'Worker not available' };
  assert.equal(await context.sendVideoEvent('first', 'youtube', '2026-10-24T12:00:00Z', 2), false);
  context.chrome.runtime.lastError = undefined;
  const result = await new Promise(resolve => listeners[0]({ type: 'FLUSH_SESSION' }, {}, resolve));
  assert.equal(result.success, true);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].event.event_id, messages[1].event.event_id);
});
