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

