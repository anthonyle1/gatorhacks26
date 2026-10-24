const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SESSION_ID = '00000000-0000-4000-8000-000000000001';

function background(failUpload = false) {
  const state = {};
  const calls = [];
  const listeners = [];
  let fails = failUpload;
  const context = {
    crypto: { randomUUID: () => SESSION_ID },
    console: { log() {}, error() {} },
    chrome: {
      sidePanel: { async setPanelBehavior() {} },
      storage: { local: {
        async get(key) { return Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, structuredClone(state[name])])); },
        async set(values) { Object.assign(state, structuredClone(values)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; },
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
      if (fails) return { ok: false, status: 503, json: async () => ({ detail: 'Backend unavailable' }) };
      return { ok: true, json: async () => ({ session_id: SESSION_ID, status: 'pending', tree: [], videos: [] }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/background.js'), 'utf8'), context);
  return { context, state, calls, fail(value) { fails = value; } };
}

test('recording videos and Instagram comments never requires the backend or MongoDB', async () => {
  const { context, state, calls } = background(true);
  await context.queueEvent({ event_id: 'one', video_id: 'abc', platform: 'instagram' });
  await context.queueEvent({ event_id: 'one', video_id: 'abc', platform: 'instagram' });
  await context.recordComments({ video_id: 'abc', comments: ['A useful comment'] });
  assert.equal(calls.length, 0);
  assert.equal(state.pendingEvents.length, 1);
  assert.equal(state.localReelEvidence.abc.comments[0], 'A useful comment');
});

test('finish captures the last video and submits one MongoDB-free session snapshot', async () => {
  const { context, state, calls } = background();
  await context.finishScrollingSession();
  assert.equal(state.lastCompletedLocalSessionId, SESSION_ID);
  assert.equal(state.localSessionId, undefined);
  assert.equal(state.trackingPaused, true);
  assert.equal(state.pendingEvents.length, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith(`/local-sessions/${SESSION_ID}/finish`));
  assert.equal(JSON.parse(calls[0].options.body).events[0].event_id, 'final-event');
});

test('Start enables tracking offline and repeated Start preserves active session counters', async () => {
  const { context, state, calls } = background(true);
  await context.sessionControl({ type: 'START_SESSION' });
  assert.equal(state.localSessionId, SESSION_ID);
  assert.equal(state.trackingPaused, false);
  assert.equal(state.scrollingSession.durationSeconds, 0);
  state.scrollingSession.durationSeconds = 42;
  await context.sessionControl({ type: 'START_SESSION' });
  assert.equal(state.scrollingSession.durationSeconds, 42);
  assert.equal(calls.length, 0);
});

test('Start preserves a session waiting for Finish to retry', async () => {
  const { context, state } = background();
  state.finishPending = true;
  await assert.rejects(context.sessionControl({ type: 'START_SESSION' }), /Finish the recorded session/);
  assert.equal(state.trackingPaused, undefined);
});

test('concurrent and repeated Finish requests submit only one snapshot', async () => {
  const { context, calls } = background();
  await Promise.all([context.finishScrollingSession(), context.finishScrollingSession()]);
  await context.finishScrollingSession();
  assert.equal(calls.length, 1);
});

test('failed finish preserves the snapshot and retries with the same session ID and body', async () => {
  const setup = background(true);
  await assert.rejects(setup.context.finishScrollingSession());
  assert.equal(setup.state.pendingEvents.length, 1);
  assert.equal(setup.state.localSessionId, SESSION_ID);
  assert.equal(setup.state.finishPending, true);
  setup.fail(false);
  await setup.context.finishScrollingSession();
  assert.equal(setup.calls[0].url, setup.calls[1].url);
  assert.equal(setup.calls[0].options.body, setup.calls[1].options.body);
  assert.equal(setup.state.finishPending, false);
});

test('the latest saved review remains readable when the backend is offline', async () => {
  const { context, state } = background(true);
  state.lastCompletedLocalSessionId = SESSION_ID;
  state.lastSessionReview = { session_id: SESSION_ID, status: 'complete', videos: [{ title: 'A video' }] };
  const result = await context.sessionControl({ type: 'SESSION_TAXONOMY' });
  assert.equal(result.offline, true);
  assert.equal(result.videos[0].title, 'A video');
});

test('tree reset clears cached tree only after the backend succeeds', async () => {
  const setup = background(true);
  setup.state.lastSessionReview = { tree: [{ id: 'old' }] };
  setup.state.prunePruned = { old: true };
  await assert.rejects(setup.context.sessionControl({ type: 'RESET_TOPIC_TREE' }));
  assert.equal(setup.state.lastSessionReview.tree[0].id, 'old');
  setup.fail(false);
  await setup.context.sessionControl({ type: 'RESET_TOPIC_TREE' });
  assert.equal(setup.calls[1].url, 'http://localhost:8000/local-sessions/taxonomy');
  assert.equal(setup.calls[1].options.method, 'DELETE');
  assert.equal(setup.state.lastSessionReview, undefined);
  assert.deepEqual(setup.state.prunePruned, {});
  assert.equal(setup.state.pruneTreeReset, true);
});

function content(trackingPaused = true) {
  const listeners = [];
  const messages = [];
  const intervals = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => 'stable-event-id' },
    setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {},
    window: { location: { hostname: 'www.youtube.com', pathname: '/shorts/first' }, addEventListener() {} },
    document: { title: 'First video title', hidden: false, querySelector() { return null; } },
    chrome: {
      storage: { local: { async get() { return { trackingPaused }; }, async set() {} } },
      runtime: {
        lastError: undefined,
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message, callback) { messages.push(structuredClone(message)); callback({ success: true }); },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/content.js'), 'utf8'), context);
  return { context, listeners, messages, intervals };
}

test('a fresh install waits for Start before running tracking intervals', async () => {
  const idle = content(null);
  await idle.context.startTracking();
  assert.equal(idle.intervals.length, 0);
  const active = content(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active.intervals.length, 2);
});

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
