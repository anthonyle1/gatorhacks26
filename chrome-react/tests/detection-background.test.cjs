const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(check) {
  let listener;
  const changed = [];
  const local = { trackingPaused: false, detectionBlacklistVersion: 'v1' }, session = {};
  const apiCalls = [];
  const serverState = { blacklist_version: 'v1', topic_count: 1, configured: true };
  const area = (data, name) => ({
    async get(keys) {
      const result = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) if (key in data) result[key] = structuredClone(data[key]);
      return result;
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
        changes[key] = { oldValue: data[key], newValue: value }; data[key] = structuredClone(value);
      }
      if (Object.keys(changes).length) queueMicrotask(() => changed.forEach(callback => callback(changes, name)));
    },
  });
  const chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { onRemoved: { addListener() {} } },
    storage: { local: area(local, 'local'), session: area(session, 'session'), onChanged: { addListener(fn) { changed.push(fn); } } } };
  const context = vm.createContext({ chrome, AbortController, setTimeout, clearTimeout, crypto: webcrypto, TextEncoder,
    supportedCaptureTab: () => true,
    async apiRequest(url, options) {
      apiCalls.push(url);
      if (url === '/detection/state') return { ...serverState };
      return check(JSON.parse(options.body), options.signal);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/detection-background.js'), 'utf8'), context);
  const sender = { frameId: 0, tab: { id: 1, url: 'https://www.youtube.com/shorts/A' } };
  function send(message) {
    return new Promise(resolve => listener(message, sender, resolve));
  }
  const evidence = (requestId, videoId = 'A') => ({ platform: 'youtube', video_id: videoId, request_id: requestId, blacklist_version: 'v1', title: 'Video title', caption: '', comments: [] });
  return { send, evidence, session, local, chrome, apiCalls, serverState };
}

function result(evidence, status = 'MATCH') {
  return { ...evidence, status, confidence: 0.95, notify: status === 'MATCH', matched_topic_id: status === 'MATCH' ? 'topic' : null,
    matched_topic_name: status === 'MATCH' ? 'Saved topic' : null };
}

test('completed results are reused with fresh request IDs and hashed evidence', async () => {
  let calls = 0;
  const f = fixture(async evidence => { calls++; const { title: _title, caption: _caption, comments: _comments, ...identity } = evidence; return result(identity); });
  const evidence = { ...f.evidence('one'), comments: ['private supporting comment'] };
  assert.equal((await f.send({ type: 'DETECTION_CHECK', evidence })).data.notify, true);
  const cached = await f.send({ type: 'DETECTION_CHECK', evidence: { ...evidence, request_id: 'two' } });
  assert.equal(cached.data.request_id, 'two'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(f.session).includes('private supporting comment'), false);
});

test('identical in-flight requests are deduplicated', async () => {
  const entered = deferred(), finish = deferred(); let calls = 0;
  const f = fixture(async evidence => { calls++; entered.resolve(); await finish.promise; return result(evidence); });
  const message = { type: 'DETECTION_CHECK', evidence: f.evidence('same') };
  const first = f.send(message); await entered.promise;
  const second = f.send(message); finish.resolve();
  assert.equal((await first).success, true); assert.equal((await second).success, true); assert.equal(calls, 1);
});

test('late completion after cancellation cannot replace the newer tab request', async () => {
  const enteredA = deferred(), enteredB = deferred(), finishA = deferred(), finishB = deferred();
  let signalA;
  const f = fixture(async (evidence, signal) => {
    if (evidence.video_id === 'A') { signalA = signal; enteredA.resolve(); await finishA.promise; }
    else { enteredB.resolve(); await finishB.promise; }
    return result(evidence);
  });
  const first = f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('first') }); await enteredA.promise;
  const second = f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('second', 'B') }); await enteredB.promise;
  assert.equal(signalA.aborted, true); finishA.resolve(); assert.equal((await first).success, false);
  finishB.resolve(); assert.equal((await second).data.video_id, 'B');
});

test('preference and delay updates abort pending detection', async () => {
  for (const update of [{ detectionMutation: 'new-cut' }, { detectionDelaySeconds: 10 }, { detectionBlacklistVersion: 'v2' }, { trackingPaused: true }]) {
    const entered = deferred(), finish = deferred(); let signal;
    const f = fixture(async (evidence, currentSignal) => { signal = currentSignal; entered.resolve(); await finish.promise; return result(evidence); });
    const pending = f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('pending') }); await entered.promise;
    await f.chrome.storage.local.set(update); await Promise.resolve();
    assert.equal(signal.aborted, true); finish.resolve(); assert.equal((await pending).success, false);
  }
});

test('uncertain cache entries retry when evidence changes', async () => {
  let calls = 0;
  const f = fixture(async evidence => { calls++; return result(evidence, 'UNCERTAIN'); });
  await f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('one') });
  await f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('two') });
  assert.equal(calls, 1);
  await f.send({ type: 'DETECTION_CHECK', evidence: { ...f.evidence('three'), comments: ['new useful context'] } });
  assert.equal(calls, 2);
});

test('unannounced server blacklist changes prevent cache reuse', async () => {
  const f = fixture(async evidence => result(evidence));
  await f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('one') });
  f.serverState.blacklist_version = 'v2';
  const stale = await f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('two') });
  assert.equal(stale.success, false);
});

test('expired cache entries trigger fresh inference', async () => {
  let calls = 0;
  const f = fixture(async evidence => { calls++; return result(evidence); });
  await f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('one') });
  for (const entry of Object.values(f.session.detectionCache)) entry.expires = Date.now() - 1;
  await f.send({ type: 'DETECTION_CHECK', evidence: f.evidence('two') });
  assert.equal(calls, 2);
});
