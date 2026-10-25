const API_BASE = "http://localhost:8000";

// Handle the toolbar invocation ourselves so capture uses the tab Chrome granted.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(error => {
    console.error("Side panel setup failed:", error);
  });

function supportedCaptureTab(tab) {
  return Number.isInteger(tab?.id) && /^https:\/\/www\.(youtube|instagram)\.com\//.test(tab.url || "");
}

function capturePermissionError() {
  const error = new Error("Select the YouTube/Instagram video tab, then click the Prune icon in Chrome's toolbar to authorize audio for that page. A button in an already-open side panel cannot grant this permission.");
  error.code = "CAPTURE_PERMISSION_REQUIRED";
  return error;
}

async function recordCaptureError(error) {
  const state = await chrome.storage.local.get("audioCaptureStatus");
  const previous = state.audioCaptureStatus || {};
  const stillConnected = previous.recording === true && await hasOffscreenDocument();
  await chrome.storage.local.set({ audioCaptureStatus: { ...previous, recording: stillConnected, capturing: stillConnected && previous.capturing === true,
    permission_required: error.code === "CAPTURE_PERMISSION_REQUIRED", detail: error.message || "Audio capture unavailable; metadata tracking continues." } });
}

async function handleToolbarInvocation(tab) {
  if (!supportedCaptureTab(tab)) {
    await recordCaptureError(new Error("Chrome pages, extension summary pages, and other sites cannot be captured. Open a YouTube/Instagram video and click the Prune toolbar icon there."));
    return;
  }
  const origin = tab.url.match(/^https:\/\/[^/]+/)[0];
  await chrome.storage.local.set({ audioInvokedTab: { id: tab.id, origin } });
  const state = await chrome.storage.local.get(["trackingPaused", "audioCaptureEnabled", "finishPending", "audioCaptureStatus"]);
  if (state.trackingPaused === false && !state.finishPending && state.audioCaptureEnabled !== false) {
    try { await captureControl({ type: "CAPTURE_START" }, tab); }
    catch (error) { await recordCaptureError(error); }
  } else if (!state.audioCaptureStatus?.recording) {
    await chrome.storage.local.set({ audioCaptureStatus: { recording: false, permission_required: false,
      detail: "Video tab authorized. Press Start tracking to capture its audio." } });
  }
}

chrome.action?.onClicked.addListener(tab => {
  // Opening must begin directly in the user gesture, before asynchronous storage work.
  const opening = chrome.sidePanel.open({ tabId: tab.id }).catch(error => console.error("Could not open side panel:", error));
  return Promise.all([opening, handleToolbarInvocation(tab)]).catch(error => console.error("Toolbar capture setup failed:", error));
});

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...(typeof AbortSignal !== "undefined" ? { signal: AbortSignal.timeout(15000) } : {}),
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The backend did not return JSON. Start the backend on port 8000 and try again."); }
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `API request failed (${response.status}).`);
  return data;
}

async function refreshAudioDiagnostics() {
  const state = await chrome.storage.local.get(["localSessionId", "lastCompletedLocalSessionId"]);
  const sessionId = state.localSessionId || state.lastCompletedLocalSessionId;
  let diagnostics;
  try {
    const result = await apiRequest(sessionId ? `/local-sessions/${encodeURIComponent(sessionId)}/audio-status` : "/local-sessions/health");
    diagnostics = { ...(sessionId ? result : result.audio), reachable: true, review_session_id: sessionId || null };
  } catch { diagnostics = { reachable: false, review_session_id: sessionId || null }; }
  await chrome.storage.local.set({ audioBackendStatus: diagnostics });
  return diagnostics;
}

// Recording is local and succeeds even when the backend is offline.
let syncQueue = Promise.resolve();
async function getOrCreateSession() {
  const state = await chrome.storage.local.get("localSessionId");
  if (state.localSessionId) return state.localSessionId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ localSessionId: id });
  return id;
}

async function queueEvent(event) {
  if (!["youtube", "instagram"].includes(event.platform || "youtube")) throw new Error("Unsupported video platform");
  const state = await chrome.storage.local.get("pendingEvents");
  const events = state.pendingEvents || [];
  if (events.length >= 5000 && !events.some(item => item.event_id === event.event_id)) throw new Error("Session video limit reached. Finish this session.");
  if (!events.some(item => item.event_id === event.event_id)) events.push(event);
  await getOrCreateSession();
  await chrome.storage.local.set({ pendingEvents: events });
  return { recorded: events.length };
}

async function recordComments(message) {
  const state = await chrome.storage.local.get(["localReelEvidence", "trackingPaused", "finishPending"]);
  if (state.trackingPaused && !state.finishPending) return { comment_count: 0 };
  const evidence = state.localReelEvidence || {};
  const comments = (message.comments || []).filter(text => typeof text === "string" && text.trim()).slice(0, 100).map(text => text.slice(0, 3000));
  evidence[message.video_id] = { video_id: message.video_id, title: (message.title || "").slice(0, 1000), caption: (message.caption || "").slice(0, 16000), comments };
  await chrome.storage.local.set({ localReelEvidence: evidence });
  return { comment_count: comments.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["VIDEO_EVENT", "INSTAGRAM_COMMENTS"].includes(message?.type)) return false;
  syncQueue = syncQueue.catch(() => {}).then(() => message.type === "VIDEO_EVENT" ? queueEvent(message.event) : recordComments(message));
  syncQueue.then(data => sendResponse({ success: true, data })).catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

async function sessionTabs() {
  return chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://www.instagram.com/*"] });
}

let finishing = null;
async function hasOffscreenDocument() {
  if (!chrome.offscreen) return false;
  if (typeof chrome.offscreen.hasDocument === "function") return chrome.offscreen.hasDocument();
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
    return contexts.length > 0;
  }
  return false;
}

function audioDeadline(operation, milliseconds) {
  let timer;
  const deadline = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error("Audio flush deadline exceeded")), milliseconds); });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

async function flushAudioForFinish() {
  if (!chrome.offscreen) return { incomplete: false };
  try {
    if (!await hasOffscreenDocument()) return { incomplete: false };
    const result = await audioDeadline(chrome.runtime.sendMessage({ target: "offscreen", type: "CAPTURE_STOP" }), 10000);
    if (!result?.success) throw new Error(result?.error || "The audio recorder did not acknowledge stopping");
    return { incomplete: result.data?.incomplete === true };
  } catch (error) {
    // Closing a broken recorder releases capture, while IndexedDB retains queued MP3s.
    try { await chrome.offscreen.closeDocument(); } catch { /* It may already be gone. */ }
    const previous = await chrome.storage.local.get("audioCaptureStatus");
    await chrome.storage.local.set({ audioCaptureStatus: { ...previous.audioCaptureStatus, recording: false, incomplete: true,
      detail: "Audio could not be flushed completely. The review will use available evidence.", flush_error: String(error.message || error).slice(0, 300) } });
    return { incomplete: true };
  }
}
function finishScrollingSession() {
  if (!finishing) finishing = finishSnapshot().finally(() => { finishing = null; });
  return finishing;
}

async function finishSnapshot() {
  const previous = await chrome.storage.local.get(["trackingPaused", "finishPending", "localSessionId", "pendingEvents", "lastCompletedLocalSessionId"]);
  if (previous.trackingPaused && !previous.finishPending && !previous.localSessionId && !previous.pendingEvents?.length && previous.lastCompletedLocalSessionId) {
    return { session_id: previous.lastCompletedLocalSessionId, status: "completed" };
  }
  await chrome.storage.local.set({ trackingPaused: true, finishPending: true });
  // Flush outside the write queue: content scripts send VIDEO_EVENT into it.
  const tabs = await sessionTabs();
  const flushed = await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "FLUSH_SESSION" })));
  if (flushed.some(result => result.status === "rejected" || !result.value?.success)) {
    throw new Error("Could not flush every video tab. Refresh your YouTube/Instagram tabs and try Finish again. Recorded videos are preserved.");
  }
  const audioFlush = await flushAudioForFinish();
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    const state = await chrome.storage.local.get(["pendingEvents", "localReelEvidence", "localSessionSnapshot", "pendingOccurrences", "audioManifest"]);
    const sessionId = await getOrCreateSession();
    let snapshot = state.localSessionSnapshot;
    if (!snapshot) {
      const events = (state.pendingEvents || []).map(event => ({ ...event, platform: event.platform || "youtube" }));
      const reels = new Set(events.filter(event => event.platform === "instagram").map(event => event.video_id));
      snapshot = { events, instagram: Object.values(state.localReelEvidence || {}).filter(item => reels.has(item.video_id)) };
      const occurrences = Object.values(state.pendingOccurrences || {});
      if (occurrences.length) {
        snapshot.evidence_manifest = occurrences.map(occurrence => ({ occurrence_id: occurrence.occurrence_id,
          segment_ids: state.audioManifest?.[occurrence.occurrence_id] || [],
          capture_state: audioFlush.incomplete ? "uncertain" : state.audioManifest?.[occurrence.occurrence_id]?.length ? "partial" : occurrence.capture_state === "disabled" ? "disabled" : "unavailable" }));
      }
      // Keep the exact snapshot for an idempotent retry if the reply is lost.
      await chrome.storage.local.set({ localSessionSnapshot: snapshot });
    }
    for (const occurrence of Object.values(state.pendingOccurrences || {})) {
      await apiRequest(`/local-sessions/${encodeURIComponent(sessionId)}/occurrences`, { method: "POST", body: JSON.stringify(occurrence) });
    }
    const result = await apiRequest(`/local-sessions/${encodeURIComponent(sessionId)}/finish`, { method: "POST", body: JSON.stringify(snapshot) });
    await chrome.storage.local.set({ lastCompletedLocalSessionId: sessionId, finishPending: false, pendingEvents: [], localReelEvidence: {} });
    await chrome.storage.local.remove(["localSessionId", "localSessionSnapshot", "backendSessionId", "pendingOccurrences", "audioManifest"]);
    return result;
  });
  return syncQueue;
}

async function sessionControl(message) {
  if (message.type === "AUDIO_DIAGNOSTICS") return refreshAudioDiagnostics();
  if (message.type === "RESET_TOPIC_TREE") {
    const result = await apiRequest("/local-sessions/taxonomy", { method: "DELETE" });
    await chrome.storage.local.remove("lastSessionReview");
    await chrome.storage.local.set({ prunePruned: {}, pruneTreeReset: true });
    return result;
  }
  if (message.type === "FINISH_SESSION") return finishScrollingSession();
  if (message.type === "START_SESSION") {
    const state = await chrome.storage.local.get(["finishPending", "trackingPaused", "localSessionId"]);
    if (state.finishPending) throw new Error("Finish the recorded session before starting another.");
    if (state.trackingPaused === false && state.localSessionId) return { status: "active" };
    await getOrCreateSession();
    await chrome.storage.local.set({ trackingPaused: false, scrollingSession: { durationSeconds: 0, videoCount: 0, currentVideoId: null, currentPlatform: null } });
    const tabs = await sessionTabs();
    await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "RESUME_SESSION" })));
    const audio = await chrome.storage.local.get("audioCaptureEnabled");
    if (audio.audioCaptureEnabled !== false && chrome.tabCapture && chrome.offscreen) {
      try { await captureControl({ type: "CAPTURE_START" }); }
      catch (error) {
        await recordCaptureError({ ...error, message: `Audio unavailable: ${error.message} Tracking continues with metadata and comments.` });
      }
    }
    return { status: "active" };
  }
  const state = await chrome.storage.local.get(["lastCompletedLocalSessionId", "lastSessionReview"]);
  if (!state.lastCompletedLocalSessionId) return null;
  const base = `/local-sessions/${encodeURIComponent(state.lastCompletedLocalSessionId)}/taxonomy`;
  if (message.type === "SESSION_TAXONOMY") {
    try {
      const review = await apiRequest(base);
      await chrome.storage.local.set({ lastSessionReview: review });
      if (review.global_video_count > 0) await chrome.storage.local.set({ pruneTreeReset: false });
      return review;
    } catch (error) {
      if (state.lastSessionReview?.session_id === state.lastCompletedLocalSessionId) return { ...state.lastSessionReview, offline: true, detail: "Showing the last saved summary. Start the backend to refresh results." };
      throw error;
    }
  }
  if (message.type === "RETRY_SESSION_TAXONOMY") return apiRequest(`${base}/retry`, { method: "POST" });
  if (message.type === "TOPIC_PREFERENCE") return apiRequest(`${base}/preferences`, { method: "PATCH", body: JSON.stringify({ category_id: message.category_id, reduce: message.reduce }) });
  if (message.type === "EDIT_TOPIC_CATEGORY") return apiRequest(`${base}/categories/${encodeURIComponent(message.category_id)}`, { method: "PATCH", body: JSON.stringify(message.change) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["AUDIO_DIAGNOSTICS", "RESET_TOPIC_TREE", "FINISH_SESSION", "START_SESSION", "SESSION_TAXONOMY", "RETRY_SESSION_TAXONOMY", "TOPIC_PREFERENCE", "EDIT_TOPIC_CATEGORY"].includes(message?.type)) return false;
  sessionControl(message).then(data => sendResponse({ success: true, data })).catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

// Playback registers ownership independently of URL detection and final review snapshots.
async function playbackOccurrence(message, sender) {
  const state = await chrome.storage.local.get(["pendingOccurrences", "trackingPaused", "finishPending", "audioCaptureStatus"]);
  if (state.trackingPaused !== false || state.finishPending) return null;
  const session = await getOrCreateSession();
  const occurrence = { ...message.occurrence, review_session_id: session, tab_id: sender.tab?.id || 0,
    capture_state: state.audioCaptureStatus?.recording && state.audioCaptureStatus.tabId === sender.tab?.id ? "capturing" : "disabled" };
  const pending = state.pendingOccurrences || {};
  if (Object.keys(pending).length >= 5000) throw new Error("Session occurrence limit reached");
  pending[occurrence.occurrence_id] = occurrence;
  await chrome.storage.local.set({ pendingOccurrences: pending });
  // Registration retries must not hold the local event write queue while offline.
  void apiRequest(`/local-sessions/${session}/occurrences`, { method: "POST", body: JSON.stringify(occurrence) }).catch(() => {});
  return occurrence;
}
async function audioExpected(message) {
  const state = await chrome.storage.local.get(["audioManifest", "pendingOccurrences"]);
  const owner = state.pendingOccurrences?.[message.occurrence.occurrence_id];
  if (!owner || owner.review_session_id !== message.occurrence.review_session_id) throw new Error("Stale audio owner");
  const manifest = state.audioManifest || {};
  const ids = manifest[owner.occurrence_id] || [];
  if (ids.length >= 1000) throw new Error("Occurrence segment limit reached");
  if (!ids.includes(message.segment_id)) ids.push(message.segment_id);
  manifest[owner.occurrence_id] = ids;
  await chrome.storage.local.set({ audioManifest: manifest });
}
async function captureControl(message, invokedTab = null) {
  if (message.type === "CAPTURE_START") {
    const state = await chrome.storage.local.get(["audioCaptureEnabled", "trackingPaused", "localSessionId", "audioCaptureFailure", "audioInvokedTab", "audioCaptureStatus"]);
    if (state.audioCaptureEnabled === false || state.trackingPaused !== false) throw new Error("Enable audio and start a session first.");
    if (state.audioCaptureFailure?.review_session_id === state.localSessionId) throw new Error(state.audioCaptureFailure.reason);
    if (!chrome.tabCapture || !chrome.offscreen) throw new Error("This browser does not support tab audio capture.");
    const tab = invokedTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!supportedCaptureTab(tab)) throw new Error("Select the YouTube/Instagram video tab, then click the Prune toolbar icon. Chrome pages and extension pages cannot be captured.");
    const origin = tab.url.match(/^https:\/\/[^/]+/)[0];
    if (state.audioInvokedTab?.id !== tab.id || state.audioInvokedTab.origin !== origin) throw capturePermissionError();
    if (state.audioCaptureStatus?.recording && state.audioCaptureStatus.tabId === tab.id && await hasOffscreenDocument()) return { recording: true, tab_id: tab.id };
    if (!await hasOffscreenDocument()) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA", "WORKERS"], justification: "Capture selected tab audio and encode local MP3 segments" });
    if (state.audioCaptureStatus?.recording) await chrome.runtime.sendMessage({ target: "offscreen", type: "CAPTURE_STOP" });
    // Navigation may revoke activeTab while the offscreen document is being created.
    const current = chrome.tabs.get ? await chrome.tabs.get(tab.id) : tab;
    if (!supportedCaptureTab(current) || current.url.match(/^https:\/\/[^/]+/)[0] !== origin) throw capturePermissionError();
    let streamId;
    try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }); }
    catch (error) {
      if (/activeTab|not been invoked|Chrome pages cannot be captured/i.test(error.message || "")) throw capturePermissionError();
      throw error;
    }
    const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "CAPTURE_START", tab_id: tab.id, stream_id: streamId });
    if (!result?.success) throw new Error(result?.error || "Audio capture unavailable");
    await chrome.storage.local.set({ audioCaptureStatus: { recording: true, capturing: false, tabId: tab.id,
      permission_required: false, detail: "Tab connected; waiting for video playback" } });
    return { recording: true, tab_id: tab.id };
  }
  if (await hasOffscreenDocument()) return chrome.runtime.sendMessage({ target: "offscreen", type: "CAPTURE_STOP" });
  return { recording: false };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === "offscreen") return false;
  if (message.target === "background" && ["AUDIO_STATUS", "AUDIO_FAILURE"].includes(message.type)) {
    (async () => {
      if (message.type === "AUDIO_STATUS") {
        const state = await chrome.storage.local.get("audioCaptureStatus");
        const update = Object.fromEntries(Object.entries(message.update || {}).filter(([key]) => ["recording", "capturing", "capture_reason", "last_media_at", "signal_level", "video_session_id", "captured_seconds", "tabId", "incomplete", "pending", "detail"].includes(key)));
        await chrome.storage.local.set({ audioCaptureStatus: { ...state.audioCaptureStatus, ...update } });
      } else {
        await chrome.storage.local.set({ audioCaptureFailure: { review_session_id: message.review_session_id, reason: message.reason } });
      }
      respond({ success: true });
    })().catch(error => respond({ success: false, error: error.message }));
    return true;
  }
  if (["PLAYBACK_EVENT", "AUDIO_EXPECTED"].includes(message.type)) {
    syncQueue = syncQueue.catch(() => {}).then(() => message.type === "PLAYBACK_EVENT" ? playbackOccurrence(message, sender) : audioExpected(message));
    syncQueue.then(data => respond({ success: true, data })).catch(error => respond({ success: false, error: error.message }));
    return true;
  }
  if (message.type === "MEDIA_CLOCK") {
    (async () => {
      const state = await chrome.storage.local.get(["pendingOccurrences", "audioCaptureStatus", "trackingPaused"]);
      const occurrence = state.pendingOccurrences?.[message.occurrence_id];
      if (state.trackingPaused === false && occurrence && state.audioCaptureStatus?.recording && state.audioCaptureStatus.tabId === sender.tab?.id)
        await chrome.runtime.sendMessage({ ...message, target: "offscreen", occurrence, tab_id: sender.tab.id });
      respond({ success: true });
    })().catch(() => respond({ success: false }));
    return true;
  }
  if (["CAPTURE_START", "CAPTURE_STOP"].includes(message.type)) {
    captureControl(message).then(data => respond({ success: true, data })).catch(async error => {
      if (message.type === "CAPTURE_START") await recordCaptureError(error);
      respond({ success: false, error: error.message });
    });
    return true;
  }
  return false;
});
chrome.tabs.onRemoved?.addListener(async id => {
  const state = await chrome.storage.local.get("audioCaptureStatus");
  if (state.audioCaptureStatus?.tabId === id) await captureControl({ type: "CAPTURE_STOP" });
});
