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
  const openedTabs = [];
  let toolbarListener;
  let fails = failUpload;
  const context = {
    setTimeout, clearTimeout,
    crypto: { randomUUID: () => SESSION_ID },
    console: { log() {}, error() {} },
    chrome: {
      action: { onClicked: { addListener(listener) { toolbarListener = listener; } } },
      sidePanel: { async setPanelBehavior() {}, async open(options) { openedTabs.push(options.tabId); } },
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/collection-policy.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/background.js'), 'utf8'), context);
  return { context, state, calls, listeners, openedTabs, invokeToolbar(tab) { return toolbarListener(tab); }, fail(value) { fails = value; } };
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

function content(trackingPaused = true, minimum = 0) {
  const listeners = [];
  const messages = [];
  const intervals = [];
  let now = Date.now();
  const context = {
    Date: class extends Date { static now() { return now; } },
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => 'stable-event-id' },
    setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {},
    window: { location: { hostname: 'www.youtube.com', pathname: '/shorts/first' }, innerHeight: 800, innerWidth: 1000, addEventListener() {} },
    document: { title: 'First video title', hidden: false, querySelector() { return null; }, querySelectorAll() {
      return [{ paused: false, ended: false, readyState: 4, duration: 20, currentTime: 1, playbackRate: 1,
        getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 500 }) }];
    } },
    chrome: {
      storage: { local: { async get() { return { trackingPaused, sessionMinimumWatchSeconds: minimum }; }, async set() {} } },
      runtime: {
        lastError: undefined,
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message, callback) { messages.push(structuredClone(message)); callback({ success: true }); },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/collection-policy.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/content.js'), 'utf8'), context);
  return { context, listeners, messages, intervals, advance(milliseconds) { now += milliseconds; } };
}

test('watch cutoff is fixed for a session and zero preserves collect-all behavior', async () => {
  const setup = background();
  setup.state.minimumWatchSeconds = 2;
  await setup.context.sessionControl({ type: 'START_SESSION' });
  assert.equal(setup.state.sessionMinimumWatchSeconds, 2);
  setup.state.minimumWatchSeconds = 10;
  await setup.context.sessionControl({ type: 'START_SESSION' });
  assert.equal(setup.state.sessionMinimumWatchSeconds, 2);
  assert.equal((await setup.context.queueEvent({ event_id:'skip',video_id:'short',platform:'youtube',dwell_seconds:1.99 })).skipped, true);
  await setup.context.queueEvent({ event_id:'keep',video_id:'long',platform:'youtube',dwell_seconds:2 });
  assert.deepEqual(setup.state.pendingEvents.map(event => event.event_id), ['keep']);
  setup.state.sessionMinimumWatchSeconds = 0;
  await setup.context.queueEvent({ event_id:'all',video_id:'short',platform:'youtube',dwell_seconds:0 });
  assert.equal(setup.state.pendingEvents.length, 2);
});

test('short visits never prefetch models and finish excludes their video, comments and audio', async () => {
  const setup = background();
  Object.assign(setup.state, { trackingPaused:false, localSessionId:SESSION_ID,sessionMinimumWatchSeconds:2 });
  setup.context.chrome.tabs.sendMessage = async () => ({success:true});
  const occurrence = (id, source) => ({ occurrence_id:id,video_session_id:`yt_${source}`,platform:'youtube',source_id:source,generation:1 });
  const short = await setup.context.playbackOccurrence({ occurrence:occurrence('short-occ','short'),visit_id:'short-visit' },{tab:{id:7}});
  const long = await setup.context.playbackOccurrence({ occurrence:occurrence('long-occ','long'),visit_id:'long-visit' },{tab:{id:7}});
  const seek = await setup.context.playbackOccurrence({ occurrence:occurrence('seek-occ','long'),visit_id:'long-visit' },{tab:{id:7}});
  assert.equal(setup.calls.length,0);
  await setup.context.audioExpected({occurrence:short,segment_id:'short-audio'});
  await setup.context.audioExpected({occurrence:long,segment_id:'long-audio'});
  await setup.context.audioExpected({occurrence:seek,segment_id:'seek-audio'});
  await setup.context.queueEvent({event_id:'short-event',video_id:'short',platform:'youtube',dwell_seconds:1.5,collection_visit_id:'short-visit',occurrence_id:short.occurrence_id});
  assert.equal((await setup.context.audioCollectionDecision({occurrence:short})).decision,'skipped');
  assert.equal((await setup.context.audioExpected({occurrence:short,segment_id:'late-short-audio'})).discard,true);
  await setup.context.qualifyVideoVisit({visit_id:'long-visit',played_seconds:2},{tab:{id:7}});
  assert.equal((await setup.context.audioCollectionDecision({occurrence:long})).decision,'approved');
  await setup.context.queueEvent({event_id:'long-event',video_id:'long',platform:'youtube',dwell_seconds:2,collection_visit_id:'long-visit',occurrence_id:seek.occurrence_id});
  await setup.context.finishScrollingSession();
  const snapshot = JSON.parse(setup.calls.find(call => call.url.endsWith('/finish')).options.body);
  assert.deepEqual(snapshot.events.map(event => event.video_id),['long']);
  assert.equal(snapshot.events[0].collection_visit_id,undefined);
  assert.deepEqual(snapshot.evidence_manifest.map(entry => entry.occurrence_id),['long-occ','seek-occ']);
  assert.deepEqual(snapshot.evidence_manifest.flatMap(entry => entry.segment_ids),['long-audio','seek-audio']);
  assert.ok(setup.calls.every(call => !String(call.options.body).includes('short-occ')));
});

test('filtered live counters wait for actual playback eligibility', async () => {
  const setup = content(false,2);
  await new Promise(setImmediate);
  assert.equal(vm.runInContext('session.videoCount',setup.context),0);
  for(let i=0;i<7;i++) { setup.advance(250); setup.context.mediaClock(); }
  assert.equal(vm.runInContext('session.videoCount',setup.context),0);
  setup.advance(250); setup.context.mediaClock();
  assert.equal(vm.runInContext('session.videoCount',setup.context),1);
  assert.equal(setup.messages.filter(message => message.type === 'VIDEO_QUALIFIED').length,1);
  assert.equal(setup.messages.find(message => message.type === 'VIDEO_QUALIFIED').played_seconds,2);
  assert.equal(vm.runInContext('session.videoHistory.length',setup.context),1);
});

test('paused playback and short visits do not contribute to filtered counters', async () => {
  const setup = content(false,2);
  await new Promise(setImmediate);
  const media = setup.context.document.querySelectorAll()[0];
  setup.context.document.querySelectorAll = () => [media];
  media.paused = true;
  for(let i=0;i<12;i++) { setup.advance(250); setup.context.mediaClock(); }
  assert.equal(vm.runInContext('currentVideoSeconds',setup.context),0);
  media.paused = false;
  for(let i=0;i<6;i++) { setup.advance(250); setup.context.mediaClock(); }
  setup.context.window.location.pathname = '/shorts/second';
  await setup.context.trackScrolling();
  assert.equal(setup.messages.find(message => message.type === 'VIDEO_EVENT').event.dwell_seconds,1.5);
  assert.equal(vm.runInContext('session.videoCount',setup.context),0);
  assert.equal(vm.runInContext('session.videoHistory.length',setup.context),0);
});

test('a fresh install waits for Start before running tracking intervals', async () => {
  const idle = content(null);
  await idle.context.startTracking();
  assert.equal(idle.intervals.length, 0);
  const active = content(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active.intervals.length, 3);
});

test('navigation sends the previous video metadata with its original identity', async () => {
  const { context, messages } = content();
  await context.trackScrolling();
  context.window.location.pathname = '/shorts/second';
  context.document.title = 'Second video title';
  await context.trackScrolling();
  const event = messages.find(message => message.type === 'VIDEO_EVENT').event;
  assert.equal(event.video_id, 'first');
  assert.equal(event.video_session_id, 'yt_first');
  assert.equal(event.title, 'First video title');
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

test('URL detection without a playing video does not register playback', async () => {
  const { context, messages } = content();
  context.document.querySelectorAll = () => [];
  await context.trackScrolling();
  assert.equal(messages.filter(message => message.type === 'PLAYBACK_EVENT').length, 0);
});

test('playback registration is stored offline and precedes the finish manifest', async () => {
  const setup = background(true);
  setup.state.trackingPaused = false;
  const occurrence = { occurrence_id: 'occurrence-1', video_session_id: 'yt_first', platform: 'youtube', source_id: 'first',
    generation: 1, started_at: '2026-10-24T12:00:00Z', plan_version: 1, duration: 20 };
  const stored = await setup.context.playbackOccurrence({ occurrence }, { tab: { id: 7 } });
  assert.equal(stored.review_session_id, SESSION_ID);
  assert.equal(stored.tab_id, 7);
  assert.equal(setup.state.pendingOccurrences['occurrence-1'].video_session_id, 'yt_first');
  await setup.context.audioExpected({ occurrence: stored, segment_id: 'segment-1' });
  setup.fail(false);
  await setup.context.finishScrollingSession();
  const upload = setup.calls.find(call => call.url.endsWith('/finish'));
  assert.deepEqual(JSON.parse(upload.options.body).evidence_manifest, [{ occurrence_id: 'occurrence-1', segment_ids: ['segment-1'], capture_state: 'partial' }]);
  assert.equal(setup.state.pendingOccurrences, undefined);
});

test('audio evidence from a stale review is rejected', async () => {
  const setup = background();
  setup.state.pendingOccurrences = { 'occurrence-1': { occurrence_id: 'occurrence-1', review_session_id: SESSION_ID } };
  await assert.rejects(setup.context.audioExpected({ occurrence: { occurrence_id: 'occurrence-1', review_session_id: 'other' }, segment_id: 'segment-1' }), /Stale audio owner/);
});

test('each replay capture receives a distinct occurrence generation', async () => {
  const { context, messages } = content();
  let sequence = 0;
  context.crypto.randomUUID = () => `occurrence-${++sequence}`;
  const video = { videoId: 'first', platform: 'youtube' };
  const media = { currentTime: 0, duration: 20 };
  context.beginOccurrence(video, media);
  context.beginOccurrence(video, media);
  const occurrences = messages.filter(message => message.type === 'PLAYBACK_EVENT').map(message => message.occurrence);
  assert.notEqual(occurrences[0].occurrence_id, occurrences[1].occurrence_id);
  assert.equal(occurrences[1].generation, occurrences[0].generation + 1);
  assert.equal(occurrences[0].video_session_id, occurrences[1].video_session_id);
});

test('audio ownership rejects stale renderer IDs and unknown DOM structure', () => {
  const { context } = content();
  const detected = { videoId: 'first', platform: 'youtube' };
  assert.equal(context.mediaIdentityMatches({ closest: () => ({ getAttribute: () => 'first' }) }, detected), true);
  assert.equal(context.mediaIdentityMatches({ closest: () => ({ getAttribute: () => 'second' }) }, detected), false);
  assert.equal(context.mediaIdentityMatches({}, detected), false);
  context.document.querySelector = () => ({});
  assert.equal(context.mediaIdentityMatches({ closest: () => ({ getAttribute: () => 'first' }) }, detected), false);
});

test('Start attempts audio by default and preserves explicit opt-out', async () => {
  const setup = background();
  setup.context.chrome.tabCapture = {};
  setup.context.chrome.offscreen = {};
  const captures = [];
  setup.context.captureControl = async message => { captures.push(message.type); };
  await setup.context.sessionControl({ type: 'START_SESSION' });
  assert.deepEqual(captures, ['CAPTURE_START']);
  const optedOut = background();
  optedOut.context.chrome.tabCapture = {};
  optedOut.context.chrome.offscreen = {};
  optedOut.state.audioCaptureEnabled = false;
  optedOut.context.captureControl = async () => { throw new Error('Opt-out must prevent capture'); };
  assert.equal((await optedOut.context.sessionControl({ type: 'START_SESSION' })).status, 'active');
});

test('capture startup failure preserves metadata tracking', async () => {
  const setup = background();
  setup.context.chrome.tabCapture = {};
  setup.context.chrome.offscreen = {};
  setup.context.captureControl = async () => { throw new Error('Permission unavailable'); };
  assert.equal((await setup.context.sessionControl({ type: 'START_SESSION' })).status, 'active');
  assert.equal(setup.state.trackingPaused, false);
  assert.match(setup.state.audioCaptureStatus.detail, /metadata and comments/);
});

test('a transcription failure prevents capture restart only in the failed session', async () => {
  const setup = background();
  Object.assign(setup.state, { trackingPaused: false, localSessionId: SESSION_ID,
    audioCaptureFailure: { review_session_id: SESSION_ID, reason: 'Transcription failed; using metadata and comments.' } });
  await assert.rejects(setup.context.captureControl({ type: 'CAPTURE_START' }), /Transcription failed/);
});

test('Finish continues when the audio recorder reports a flush error', async () => {
  const setup = background();
  let closed = false;
  setup.context.chrome.offscreen = { async hasDocument() { return true; }, async closeDocument() { closed = true; } };
  setup.context.chrome.runtime.sendMessage = async () => ({ success: false, error: 'Recorder storage unavailable' });
  setup.state.localSessionId = SESSION_ID;
  setup.state.pendingOccurrences = { occurrence: { occurrence_id: 'occurrence', review_session_id: SESSION_ID, capture_state: 'capturing' } };
  setup.state.audioManifest = { occurrence: ['accepted-segment'] };
  await setup.context.finishScrollingSession();
  assert.equal(closed, true);
  const snapshot = JSON.parse(setup.calls.find(call => call.url.endsWith('/finish')).options.body);
  assert.equal(snapshot.evidence_manifest[0].capture_state, 'uncertain');
  assert.deepEqual(snapshot.evidence_manifest[0].segment_ids, ['accepted-segment']);
  assert.equal(setup.state.audioCaptureStatus.incomplete, true);
  assert.equal(setup.state.finishPending, false);
});

test('Finish continues when the recorder messaging channel has disappeared', async () => {
  const setup = background();
  setup.context.chrome.offscreen = { async hasDocument() { return true; }, async closeDocument() {} };
  setup.context.chrome.runtime.sendMessage = async () => { throw new Error('Receiving end does not exist'); };
  await setup.context.finishScrollingSession();
  assert.equal(setup.state.finishPending, false);
  assert.equal(setup.state.audioCaptureStatus.recording, false);
});

test('Finish does not wait forever for an unresponsive recorder', async () => {
  const setup = background();
  setup.context.setTimeout = callback => setTimeout(callback, 1);
  setup.context.chrome.offscreen = { async hasDocument() { return true; }, async closeDocument() {} };
  setup.context.chrome.runtime.sendMessage = () => new Promise(() => {});
  await setup.context.finishScrollingSession();
  assert.match(setup.state.audioCaptureStatus.flush_error, /deadline/);
  assert.equal(setup.state.finishPending, false);
});

test('worker saves offscreen status updates through runtime messaging', async () => {
  const setup = background();
  setup.state.audioCaptureStatus = { pending: 2 };
  const response = await new Promise(resolve => setup.listeners.at(-1)({ target: 'background', type: 'AUDIO_STATUS',
    update: { recording: false, incomplete: true, detail: 'Partial audio', unexpected: 'ignored' } }, {}, resolve));
  assert.equal(response.success, true);
  assert.deepEqual(setup.state.audioCaptureStatus, { pending: 2, recording: false, incomplete: true, detail: 'Partial audio' });
});

test('offscreen detection works with runtime.getContexts on older supported Chrome versions', async () => {
  const setup = background();
  setup.context.chrome.offscreen = {};
  setup.context.chrome.runtime.getURL = path => `chrome-extension://test/${path}`;
  setup.context.chrome.runtime.getContexts = async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }];
  assert.equal(await setup.context.hasOffscreenDocument(), true);
});

function captureSetup() {
  const setup = background();
  const tab = { id: 7, url: 'https://www.youtube.com/shorts/first' };
  const targets = [];
  setup.context.chrome.offscreen = { async hasDocument() { return true; } };
  setup.context.chrome.tabCapture = { async getMediaStreamId(options) { targets.push(options.targetTabId); return 'stream-id'; } };
  setup.context.chrome.runtime.sendMessage = async () => ({ success: true });
  setup.context.chrome.tabs.get = async () => tab;
  setup.context.chrome.tabs.query = async () => [tab];
  Object.assign(setup.state, { trackingPaused: false, localSessionId: SESSION_ID });
  return { ...setup, tab, targets };
}

test('toolbar invocation opens the panel and captures the exact invoked video tab', async () => {
  const setup = captureSetup();
  // The active-tab query could point to an extension summary or Chrome page.
  setup.context.chrome.tabs.query = async () => [{ id: 99, url: 'chrome://extensions/' }];
  await setup.invokeToolbar(setup.tab);
  assert.deepEqual(setup.openedTabs, [7]);
  assert.deepEqual(setup.targets, [7]);
  assert.deepEqual(setup.state.audioInvokedTab, { id: 7, origin: 'https://www.youtube.com' });
  assert.equal(setup.state.audioCaptureStatus.recording, true);
});

test('toolbar clicks on Chrome pages never request a capture stream', async () => {
  const setup = captureSetup();
  await setup.invokeToolbar({ id: 99, url: 'chrome://extensions/' });
  assert.equal(setup.targets.length, 0);
  assert.match(setup.state.audioCaptureStatus.detail, /Open a YouTube\/Instagram video/);
});

test('a side-panel button requires a toolbar invocation for the selected tab', async () => {
  const setup = captureSetup();
  await assert.rejects(setup.context.captureControl({ type: 'CAPTURE_START' }), /toolbar/);
  assert.equal(setup.targets.length, 0);
  await setup.invokeToolbar(setup.tab);
  await setup.context.captureControl({ type: 'CAPTURE_START' });
  assert.deepEqual(setup.targets, [7], 'Already-recording tabs should not request a second stream');
});

test('cross-origin navigation requires a new toolbar invocation', async () => {
  const setup = captureSetup();
  setup.state.audioInvokedTab = { id: 7, origin: 'https://www.instagram.com' };
  await assert.rejects(setup.context.captureControl({ type: 'CAPTURE_START' }), /authorize audio for that page/);
  assert.equal(setup.targets.length, 0);
});

test('Chrome permission failures become actionable capture status', async () => {
  const setup = captureSetup();
  setup.state.audioInvokedTab = { id: 7, origin: 'https://www.youtube.com' };
  setup.context.chrome.tabCapture.getMediaStreamId = async () => { throw new Error('Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.'); };
  const reply = await new Promise(resolve => setup.listeners.at(-1)({ type: 'CAPTURE_START' }, {}, resolve));
  assert.equal(reply.success, false);
  assert.match(reply.error, /Prune icon in Chrome's toolbar/);
  assert.equal(setup.state.audioCaptureStatus.permission_required, true);
});
