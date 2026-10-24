const API_BASE = "http://localhost:8000";

// Open the Prune side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(error => {
    console.error("Side panel setup failed:", error);
  });

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The backend did not return JSON. Start the backend on port 8000 and try again."); }
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `API request failed (${response.status}).`);
  return data;
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
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    const state = await chrome.storage.local.get(["pendingEvents", "localReelEvidence", "localSessionSnapshot"]);
    const sessionId = await getOrCreateSession();
    let snapshot = state.localSessionSnapshot;
    if (!snapshot) {
      const events = (state.pendingEvents || []).map(event => ({ ...event, platform: event.platform || "youtube" }));
      const reels = new Set(events.filter(event => event.platform === "instagram").map(event => event.video_id));
      snapshot = { events, instagram: Object.values(state.localReelEvidence || {}).filter(item => reels.has(item.video_id)) };
      // Keep the exact snapshot for an idempotent retry if the reply is lost.
      await chrome.storage.local.set({ localSessionSnapshot: snapshot });
    }
    const result = await apiRequest(`/local-sessions/${encodeURIComponent(sessionId)}/finish`, { method: "POST", body: JSON.stringify(snapshot) });
    await chrome.storage.local.set({ lastCompletedLocalSessionId: sessionId, finishPending: false, pendingEvents: [], localReelEvidence: {} });
    await chrome.storage.local.remove(["localSessionId", "localSessionSnapshot", "backendSessionId"]);
    return result;
  });
  return syncQueue;
}

async function sessionControl(message) {
  if (message.type === "FINISH_SESSION") return finishScrollingSession();
  if (message.type === "START_SESSION") {
    const state = await chrome.storage.local.get("finishPending");
    if (state.finishPending) throw new Error("Finish the recorded session before starting another.");
    await getOrCreateSession();
    await chrome.storage.local.set({ trackingPaused: false, scrollingSession: { durationSeconds: 0, videoCount: 0, currentVideoId: null, currentPlatform: null } });
    const tabs = await sessionTabs();
    await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "RESUME_SESSION" })));
    return { status: "active" };
  }
  const state = await chrome.storage.local.get(["lastCompletedLocalSessionId", "lastSessionReview"]);
  if (!state.lastCompletedLocalSessionId) return null;
  const base = `/local-sessions/${encodeURIComponent(state.lastCompletedLocalSessionId)}/taxonomy`;
  if (message.type === "SESSION_TAXONOMY") {
    try {
      const review = await apiRequest(base);
      await chrome.storage.local.set({ lastSessionReview: review });
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
  if (!["FINISH_SESSION", "START_SESSION", "SESSION_TAXONOMY", "RETRY_SESSION_TAXONOMY", "TOPIC_PREFERENCE", "EDIT_TOPIC_CATEGORY"].includes(message?.type)) return false;
  sessionControl(message).then(data => sendResponse({ success: true, data })).catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});
