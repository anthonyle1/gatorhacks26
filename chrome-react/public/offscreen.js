/* PCM stays in this document; only real, independently encoded MP3 enters the queue. */
const API = "http://localhost:8000";
const RATE = 44100;
const MAX_QUEUE = 32;
const MAX_BYTES = 8_000_000;
const EXPIRY = 15 * 60 * 1000;
let stream, context, source, processor, muted, tabId, lastTick, capture;
let writing = Promise.resolve();
let uploading = false;
let activeReviewId = null;
let audioDisabledReason = null;
let pendingEncodes = 0;
let capturedSeconds = 0, signalPeak = 0, lastStatusAt = 0;
const encoderWorker = new Worker("mp3-worker.js");
const encodingRequests = new Map();
encoderWorker.onmessage = event => {
  const request = encodingRequests.get(event.data.id);
  if (!request) return;
  encodingRequests.delete(event.data.id);
  if (event.data.error) request.reject(new Error(event.data.error));
  else request.resolve(new Blob(event.data.parts, { type: "audio/mpeg" }));
};
encoderWorker.onerror = () => {
  for (const request of encodingRequests.values()) request.reject(new Error("MP3 worker unavailable"));
  encodingRequests.clear();
};
function encode(pcm) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    encodingRequests.set(id, { resolve, reject });
    encoderWorker.postMessage({ id, pcm }, [pcm.buffer]);
  });
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("prune-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("segments", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function records(action, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("segments", action === "getAll" ? "readonly" : "readwrite");
      const store = tx.objectStore("segments");
      const request = value === undefined ? store[action]() : store[action](value);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function status(update) {
  // Offscreen documents only support chrome.runtime; storage belongs to the worker.
  const response = await chrome.runtime.sendMessage({ target: "background", type: "AUDIO_STATUS", update: { recording: Boolean(stream), tabId, ...update } });
  if (!response?.success) throw new Error("Could not save audio capture status");
}
async function request(path, options) {
  const response = await fetch(API + path, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  return response;
}
async function deliver() {
  if (uploading) return;
  uploading = true;
  try {
    if (activeReviewId) {
      let capability;
      try {
        const response = await request(`/local-sessions/${activeReviewId}/audio-status`, { method: "GET" });
        capability = await response.json();
      } catch { /* Offline is a bounded retry condition, not proof of ASR failure. */ }
      if (capability?.enabled === false) {
        await disableAudio(activeReviewId, capability.disabled_reason || "Transcription unavailable; using metadata and comments.");
        return;
      }
    }
    const pending = await records("getAll");
    for (const row of pending.sort((a, b) => a.created - b.created)) {
      if (Date.now() - row.created > EXPIRY || row.attempts >= 8) {
        await records("delete", row.id);
        await status({ incomplete: true, detail: "Audio expired before delivery." });
        continue;
      }
      try {
        if (row.collection_gate) {
          const policy = await chrome.runtime.sendMessage({ target: 'background', type: 'AUDIO_COLLECTION_POLICY', occurrence: row.occurrence });
          if (!policy?.success || policy.data?.decision === 'pending') continue;
          if (policy.data?.decision === 'skipped') { await records('delete', row.id); continue; }
          if (policy.data?.decision !== 'approved') continue;
        }
        // Ownership registration always precedes a binary upload, including offline recovery.
        await request(`/local-sessions/${row.occurrence.review_session_id}/occurrences`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row.occurrence),
        });
        await request(`/local-sessions/${row.occurrence.review_session_id}/segments/${row.id}`, {
          method: "PUT", headers: { "Content-Type": "audio/mpeg", "X-Segment-Metadata": JSON.stringify(row.metadata) }, body: row.blob,
        });
        await records("delete", row.id);
      } catch {
        row.attempts++;
        await records("put", row);
        break;
      }
    }
    const pendingCount = (await records("getAll")).length;
    await status({ pending: pendingCount, captured_seconds: capturedSeconds, detail: audioDisabledReason || (pendingCount ? "Audio uploads pending. Check backend availability and AUDIO_ENABLED." : stream ? "Recording selected tab audio" : "Audio capture stopped.") });
  } finally { uploading = false; }
}

async function disableAudio(reviewId, reason) {
  audioDisabledReason = reason;
  capture = null;
  const saved = await chrome.runtime.sendMessage({ target: "background", type: "AUDIO_FAILURE", review_session_id: reviewId, reason });
  if (!saved?.success) throw new Error("Could not save audio failure state");
  await stop();
  for (const row of await records("getAll")) {
    if (row.occurrence.review_session_id === reviewId) await records("delete", row.id);
  }
  await status({ recording: false, incomplete: true, pending: (await records("getAll")).length, detail: reason });
  activeReviewId = null;
}

function closeSegment(reason) {
  const segment = capture;
  capture = null;
  if (!segment || !segment.confirmed || segment.confirmed <= segment.start) return;
  if (pendingEncodes >= 2) {
    void status({ incomplete: true, detail: "Audio encoder is busy; an interval was dropped." });
    return;
  }
  pendingEncodes++;
  writing = writing.catch(() => {}).then(async () => {
    if (!segment.blocks.length) return;
    const first = Math.max(segment.start, segment.blocks[0].time);
    const last = segment.blocks[segment.blocks.length - 1];
    const end = Math.min(segment.confirmed, last.time + last.pcm.length / RATE);
    const shift = first - segment.start;
    segment.start = first;
    segment.mediaStart += shift * segment.tick.rate;
    segment.wallStart = new Date(Date.parse(segment.wallStart) + shift * 1000).toISOString();
    const samples = Math.floor((end - segment.start) * RATE);
    if (samples < RATE * .3) return;
    const pcm = new Int16Array(samples);
    // Timestamped worklet buffers allow trimming unconfirmed tail audio on navigation.
    let coveredUntil = segment.start;
    for (const block of segment.blocks) {
      if (block.time > coveredUntil + .02) {
        await status({ incomplete: true, detail: "An interrupted PCM interval was excluded." });
        return;
      }
      coveredUntil = Math.max(coveredUntil, block.time + block.pcm.length / RATE);
      const destination = Math.round((block.time - segment.start) * RATE);
      for (let i = Math.max(0, -destination); i < block.pcm.length && destination + i < samples; i++) {
        pcm[destination + i] = Math.round(Math.max(-1, Math.min(1, block.pcm[i])) * 32767);
      }
    }
    const blob = await encode(pcm);
    const id = crypto.randomUUID();
    const occurrence = segment.tick.occurrence;
    const duration = samples / RATE;
    const metadata = {
      segment_id: id, occurrence_id: occurrence.occurrence_id, index: segment.index,
      plan_version: occurrence.plan_version, planned_start: segment.mediaStart,
      planned_end: segment.mediaStart + segment.target * segment.tick.rate,
      // LAME delay is 576 encoder + 528 decoder samples for this encoder path.
      encoder_delay_seconds: 1104 / RATE,
      capture_state: reason === "boundary" ? "captured" : "partial", gaps: reason === "boundary" ? [] : [reason],
      intervals: [{ audio_start: 0, audio_end: duration, media_start: segment.mediaStart,
        media_end: segment.mediaStart + duration * segment.tick.rate,
        wall_start: segment.wallStart, wall_end: new Date(Date.parse(segment.wallStart) + duration * 1000).toISOString(),
        playback_rate: segment.tick.rate, certain: true }],
    };
    const queued = await records("getAll");
    if (queued.length >= MAX_QUEUE || queued.reduce((sum, row) => sum + row.blob.size, 0) + blob.size > MAX_BYTES) {
      await status({ incomplete: true, detail: "Audio queue is full; this interval was dropped." });
      return;
    }
    // Persist the expected ID before attempting delivery, so Finish can mark lost segments missing.
    const expected = await chrome.runtime.sendMessage({ type: "AUDIO_EXPECTED", occurrence, segment_id: id });
    if (!expected?.success) throw new Error("Could not persist expected audio evidence");
    if (expected.data?.discard) return;
    await records("put", { id, occurrence, metadata, blob, collection_gate: Boolean(segment.tick.minimum_watch_seconds), created: Date.now(), attempts: 0 });
    capturedSeconds += duration;
    await status({ captured_seconds: capturedSeconds, pending: (await records("getAll")).length });
    void deliver().catch(() => {});
  }).finally(() => { pendingEncodes--; });
}

let nextIndex = 0;
function tick(message) {
  if (!stream || message.tab_id !== tabId) return;
  activeReviewId = message.occurrence.review_session_id;
  const clock = context.currentTime;
  const continuous = lastTick && message.occurrence.occurrence_id === lastTick.occurrence.occurrence_id &&
    message.rate === lastTick.rate && message.playing && lastTick.playing &&
    clock - lastTick.clock < .8 && Math.abs(message.media_time - lastTick.media_time - (clock - lastTick.clock) * message.rate) < .15;
  if (!continuous) closeSegment(message.playing ? "seek" : "pause");
  else if (capture) capture.confirmed = clock;
  if (capture && clock - capture.start >= capture.target) closeSegment("boundary");
  if (!capture && message.playing && Number.isFinite(message.media_time)) {
    const duration = message.occurrence.duration;
    const length = duration ? duration / Math.max(1, Math.ceil(duration / 15)) : 15;
    const target = duration ? Math.min(duration, (Math.floor(message.media_time / length) + 1) * length) - message.media_time : length;
    capture = { tick: message, start: clock, confirmed: clock, blocks: [], mediaStart: message.media_time,
      wallStart: new Date().toISOString(), target: Math.min(30, target / message.rate), index: nextIndex++ };
  }
  lastTick = { ...message, clock };
  if (Date.now() - lastStatusAt > 900) {
    lastStatusAt = Date.now();
    void status({ capturing: Boolean(continuous && capture && message.playing), capture_reason: message.capture_reason || (message.playing ? "playing" : "paused"),
      last_media_at: Date.now(), video_session_id: message.occurrence.video_session_id, signal_level: signalPeak,
      captured_seconds: capturedSeconds }).catch(() => {});
    signalPeak = 0;
  }
}
async function stop() {
  closeSegment("interruption");
  const active = stream;
  stream = null;
  let incomplete = false;
  for (const track of active?.getTracks() || []) {
    try { track.stop(); } catch { incomplete = true; }
  }
  if (processor?.port) processor.port.onmessage = null;
  for (const node of [processor, source, muted]) {
    try { node?.disconnect(); } catch { incomplete = true; }
  }
  const closingContext = context;
  processor = source = muted = context = null;
  try { if (closingContext && closingContext.state !== "closed") await closingContext.close(); }
  catch { incomplete = true; }
  lastTick = null;
  await writing.catch(() => { incomplete = true; });
  // Upload retries run independently; a recorder stop must not wait for a network queue.
  void deliver().catch(() => status({ incomplete: true, detail: "Audio delivery is unavailable; using accepted evidence." }).catch(() => {}));
  const detail = audioDisabledReason || (incomplete ? "Some audio could not be flushed; continuing with available evidence." : "Audio capture stopped.");
  await status({ recording: false, capturing: false, ...(incomplete ? { incomplete: true } : {}), detail });
  return { recording: false, incomplete, detail };
}
async function start(message) {
  await stop();
  activeReviewId = null;
  audioDisabledReason = null;
  capturedSeconds = 0; signalPeak = 0; lastStatusAt = 0;
  tabId = message.tab_id;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.stream_id } }, video: false });
    context = new AudioContext({ sampleRate: RATE });
    await context.audioWorklet.addModule("audio-worklet.js");
    source = context.createMediaStreamSource(stream);
    // tabCapture suppresses normal playback; route the original stream to speakers.
    source.connect(context.destination);
    processor = new AudioWorkletNode(context, "prune-pcm");
    processor.port.onmessage = event => {
      for (let i = 0; i < event.data.pcm.length; i += 16) signalPeak = Math.max(signalPeak, Math.abs(event.data.pcm[i]));
      if (capture) capture.blocks.push(event.data);
      // Missing timing signals never accumulate an unbounded PCM buffer.
      if (capture && context.currentTime - (lastTick?.clock || 0) > .8) closeSegment("unknown");
    };
    muted = context.createGain(); muted.gain.value = 0;
    source.connect(processor).connect(muted).connect(context.destination);
    stream.getTracks().forEach(track => track.addEventListener("ended", () => { if (stream) void stop(); }));
    await context.resume();
    await status({ recording: true, capturing: false, last_media_at: null, captured_seconds: 0, signal_level: 0, incomplete: false, detail: "Tab connected; waiting for video playback" });
  } catch (error) {
    await stop();
    throw error;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== "offscreen") return false;
  const operation = message.type === "CAPTURE_START" ? start(message) : message.type === "CAPTURE_STOP" ? stop() : Promise.resolve(tick(message));
  operation.then(data => respond({ success: true, data })).catch(error => respond({ success: false, error: error.message }));
  return true;
});
setInterval(() => { void deliver().catch(() => {}); }, 10000);
void deliver().catch(() => {});
