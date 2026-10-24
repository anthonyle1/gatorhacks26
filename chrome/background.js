const API_BASE = "http://localhost:8000";
const USER_ID = "demo_user";

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ` +
      await response.text()
    );
  }

  return response.json();
}

// Create a backend session if one does not exist.
async function getOrCreateSession() {
  const data = await chrome.storage.local.get(
    "backendSessionId"
  );

  if (data.backendSessionId) {
    return data.backendSessionId;
  }

  const result = await apiRequest("/sessions", {
    method: "POST",
    body: JSON.stringify({
      user_id: USER_ID,
      platform: "youtube_shorts",
      goal_minutes: 15
    })
  });

  await chrome.storage.local.set({
    backendSessionId: result.session_id
  });

  console.log(
    "Backend session created:",
    result.session_id
  );

  return result.session_id;
}

// Save an event locally before uploading.
async function queueEvent(event) {
  const data = await chrome.storage.local.get(
    "pendingEvents"
  );

  const pending = data.pendingEvents || [];

  if (!pending.some(
    item => item.event_id === event.event_id
  )) {
    pending.push(event);
  }

  await chrome.storage.local.set({
    pendingEvents: pending
  });
}

// Upload locally stored events.
async function syncEvents() {
  const data = await chrome.storage.local.get(
    "pendingEvents"
  );

  const pending = data.pendingEvents || [];

  if (pending.length === 0) {
    return { synced: 0 };
  }

  const sessionId = await getOrCreateSession();

  // Backend accepts at most 100 events per batch.
  let synced = 0;

  while (true) {
    const stored = await chrome.storage.local.get(
      "pendingEvents"
    );
    const events = stored.pendingEvents || [];

    if (events.length === 0) {
      break;
    }

    const batch = events.slice(0, 100);

    await apiRequest(
      `/sessions/${sessionId}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          events: batch
        })
      }
    );

    const uploadedIds = new Set(
      batch.map(event => event.event_id)
    );

    const remaining = events.filter(
      event => !uploadedIds.has(event.event_id)
    );

    await chrome.storage.local.set({
      pendingEvents: remaining
    });

    synced += batch.length;
  }

  console.log("Events synced:", synced);

  return { synced };
}

// Serialize messages to avoid overlapping writes.
let syncQueue = Promise.resolve();

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.type !== "VIDEO_EVENT") {
      return false;
    }

    syncQueue = syncQueue
      .catch(() => {})
      .then(async () => {
        await queueEvent(message.event);
        return syncEvents();
      });

    syncQueue
      .then(result => {
        sendResponse({
          success: true,
          ...result
        });
      })
      .catch(error => {
        console.error(
          "Backend synchronization failed:",
          error
        );

        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true;
  }
);

// A finish first flushes content scripts OUTSIDE syncQueue. Their VIDEO_EVENT
// messages use that queue, so awaiting them inside it would deadlock.
async function sessionTabs() {
  return chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://www.instagram.com/*"] });
}

async function finishScrollingSession() {
  await chrome.storage.local.set({ trackingPaused: true, finishPending: true });
  const tabs = await sessionTabs();
  const flushed = await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "FLUSH_SESSION" })));
  if (flushed.some(result => result.status === "rejected" || !result.value?.success)) {
    throw new Error("Could not flush every open video tab. Refresh YouTube/Instagram tabs and try Finish again. Queued events are preserved.");
  }
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    await syncEvents();
    const sessionId = await getOrCreateSession();
    const result = await apiRequest(`/sessions/${encodeURIComponent(sessionId)}/finish`, { method: "PATCH" });
    await chrome.storage.local.set({ lastCompletedSessionId: sessionId, finishPending: false });
    await chrome.storage.local.remove("backendSessionId");
    return result;
  });
  return syncQueue;
}

async function sessionControl(message) {
  if (message.type === "FINISH_SESSION") return finishScrollingSession();
  if (message.type === "START_SESSION") {
    await getOrCreateSession();
    await chrome.storage.local.set({ trackingPaused: false });
    const tabs = await sessionTabs();
    await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: "RESUME_SESSION" })));
    return { status: "active" };
  }
  const state = await chrome.storage.local.get("lastCompletedSessionId");
  if (!state.lastCompletedSessionId) return null;
  const base = `/sessions/${encodeURIComponent(state.lastCompletedSessionId)}/taxonomy`;
  if (message.type === "SESSION_TAXONOMY") return apiRequest(base);
  if (message.type === "RETRY_SESSION_TAXONOMY") return apiRequest(`${base}/retry`, { method: "POST" });
  if (message.type === "TOPIC_PREFERENCE") return apiRequest(`${base}/preferences`, {
    method: "PATCH", body: JSON.stringify({ category_id: message.category_id, reduce: message.reduce })
  });
  if (message.type === "EDIT_TOPIC_CATEGORY") return apiRequest(`${base}/categories/${encodeURIComponent(message.category_id)}`, {
    method: "PATCH", body: JSON.stringify(message.change)
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["FINISH_SESSION", "START_SESSION", "SESSION_TAXONOMY", "RETRY_SESSION_TAXONOMY", "TOPIC_PREFERENCE", "EDIT_TOPIC_CATEGORY"].includes(message.type)) return false;
  sessionControl(message).then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});


/*
 * Upload Instagram Reel comments to FastAPI.
 * Keeps the existing VIDEO_EVENT handler unchanged.
 */

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.type !== "INSTAGRAM_COMMENTS") {
      return false;
    }

    (async () => {
      try {
        const result = await apiRequest(
          "/instagram/comments",
          {
            method: "POST",
            body: JSON.stringify({
              video_id: message.video_id,
              platform: "instagram",
              title: message.title || "",
              caption: message.caption || "",
              comments: message.comments
            })
          }
        );

        console.log(
          "Instagram comments uploaded:",
          message.video_id,
          result.comment_count
        );

        sendResponse({
          success: true,
          data: result
        });
      } catch (error) {
        console.error(
          "Instagram comment upload failed:",
          error
        );

        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();

    // Keep message channel open until request completes.
    return true;
  }
);

