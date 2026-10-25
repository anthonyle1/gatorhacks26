const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function offscreen(offline = false) {
  const stored = {};
  const rows = new Map();
  let stopped = 0;
  const db = {
    close() {},
    transaction() {
      const tx = { objectStore() {
        const operation = (name, value) => {
          const request = {};
          setImmediate(() => {
            if (name === 'getAll') request.result = structuredClone([...rows.values()]);
            if (name === 'delete') rows.delete(value);
            if (name === 'put') rows.set(value.id, structuredClone(value));
            tx.oncomplete();
          });
          return request;
        };
        return { getAll: () => operation('getAll'), delete: value => operation('delete', value), put: value => operation('put', value) };
      } };
      return tx;
    },
  };
  const sandbox = vm.createContext({
    console, Blob, AbortSignal, setInterval() {}, Worker: class {},
    indexedDB: { open() { const request = {}; setImmediate(() => { request.result = db; request.onsuccess(); }); return request; } },
    // Match the real offscreen API surface: chrome.storage is intentionally absent.
    chrome: { runtime: { onMessage: { addListener() {} }, async sendMessage(message) {
      assert.equal(message.target, 'background');
      if (message.type === 'AUDIO_STATUS') stored.audioCaptureStatus = { ...stored.audioCaptureStatus, ...structuredClone(message.update) };
      else if (message.type === 'AUDIO_FAILURE') stored.audioCaptureFailure = { review_session_id: message.review_session_id, reason: message.reason };
      else throw new Error('Unexpected message');
      return { success: true };
    } } },
    async fetch() {
      if (offline) throw new Error('Offline');
      return { ok: true, async json() { return { enabled: false, disabled_reason: 'Transcription failed; using metadata and comments.' }; } };
    },
    stopTrack() { stopped++; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/offscreen.js'), 'utf8'), sandbox);
  for (let turn = 0; turn < 20 && vm.runInContext('uploading', sandbox); turn++) await new Promise(setImmediate);
  rows.set('segment', { id: 'segment', occurrence: { review_session_id: 'review' }, blob: new Blob(['audio']), created: Date.now(), attempts: 0 });
  vm.runInContext("activeReviewId = 'review'; tabId = 1; stream = { getTracks: () => [{ stop: stopTrack }] }; context = { state: 'running', async close() { this.state = 'closed'; } };", sandbox);
  return { sandbox, stored, rows, stopped: () => stopped };
}

test('backend transcription failure releases audio tracks and preserves the fallback reason', async () => {
  const setup = await offscreen();
  await setup.sandbox.deliver();
  assert.equal(setup.stopped(), 1);
  assert.equal(setup.rows.size, 0);
  assert.equal(setup.stored.audioCaptureFailure.review_session_id, 'review');
  assert.equal(setup.stored.audioCaptureStatus.recording, false);
  assert.match(setup.stored.audioCaptureStatus.detail, /Transcription failed/);
});

test('temporary backend outage retains bounded pending audio and does not claim transcription failed', async () => {
  const setup = await offscreen(true);
  await setup.sandbox.deliver();
  assert.equal(setup.stopped(), 0);
  assert.equal(setup.rows.get('segment').attempts, 1);
  assert.equal(setup.stored.audioCaptureFailure, undefined);
  assert.equal(setup.stored.audioCaptureStatus.recording, true);
});

test('stop succeeds without chrome.storage and can be repeated', async () => {
  const setup = await offscreen(true);
  const first = await setup.sandbox.stop();
  const second = await setup.sandbox.stop();
  assert.equal(first.recording, false);
  assert.equal(second.recording, false);
  assert.equal(setup.stopped(), 1);
  assert.equal(setup.stored.audioCaptureStatus.recording, false);
});

test('recorder cleanup errors release tracks and mark partial evidence instead of rejecting stop', async () => {
  const setup = await offscreen(true);
  vm.runInContext("processor = { disconnect() { throw new Error('Already disconnected'); } }; context = { state: 'running', async close() { throw new Error('Already closing'); } };", setup.sandbox);
  const result = await setup.sandbox.stop();
  assert.equal(setup.stopped(), 1);
  assert.equal(result.incomplete, true);
  assert.equal(setup.stored.audioCaptureStatus.recording, false);
});

test('stop does not wait for blocked backend delivery', async () => {
  const setup = await offscreen(true);
  setup.sandbox.fetch = () => new Promise(() => {});
  const result = await setup.sandbox.stop();
  assert.equal(result.recording, false);
  assert.equal(setup.stopped(), 1);
});

test('pending collection audio is held locally then delivered unchanged once eligible', async () => {
  const setup = await offscreen();
  const row = setup.rows.get('segment'); row.collection_gate = true; row.occurrence.occurrence_id = 'occ';
  const calls = [];
  let decision = 'pending';
  const originalMessage = setup.sandbox.chrome.runtime.sendMessage;
  setup.sandbox.chrome.runtime.sendMessage = async message => message.type === 'AUDIO_COLLECTION_POLICY'
    ? {success:true,data:{decision}} : originalMessage(message);
  setup.sandbox.fetch = async (url,options) => { calls.push({url,options}); return {ok:true,json:async()=>({enabled:true})}; };
  await setup.sandbox.deliver();
  assert.equal(setup.rows.size,1);
  assert.equal(setup.rows.get('segment').attempts,0);
  assert.equal(calls.filter(call => call.options.method !== 'GET').length,0);
  decision = 'approved';
  await setup.sandbox.deliver();
  assert.equal(setup.rows.size,0);
  const upload = calls.find(call => call.options.method === 'PUT');
  assert.equal(await upload.options.body.text(),'audio');
  assert.ok(calls.findIndex(call => call.options.method === 'POST') < calls.findIndex(call => call.options.method === 'PUT'));
});

test('audio from skipped visits is discarded without uploading or transcription', async () => {
  const setup = await offscreen();
  setup.rows.get('segment').collection_gate = true;
  const calls = [];
  const originalMessage = setup.sandbox.chrome.runtime.sendMessage;
  setup.sandbox.chrome.runtime.sendMessage = async message => message.type === 'AUDIO_COLLECTION_POLICY'
    ? {success:true,data:{decision:'skipped'}} : originalMessage(message);
  setup.sandbox.fetch = async (url,options) => { calls.push({url,options}); return {ok:true,json:async()=>({enabled:true})}; };
  await setup.sandbox.deliver();
  assert.equal(setup.rows.size,0);
  assert.equal(calls.filter(call => call.options.method !== 'GET').length,0);
});
