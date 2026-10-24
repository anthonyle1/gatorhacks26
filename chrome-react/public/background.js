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

const PLATFORM_NAMES = {
  youtube: "youtube_shorts",
  instagram: "instagram_reels"
};

async function getOrCreateSession(platform) {
  const data = await chrome.storage.local.get(
    "backendSessionIds"
  );

  const sessionIds = data.backendSessionIds || {};

  if (sessionIds[platform]) {
    return sessionIds[platform];
  }

  const result = await apiRequest("/sessions", {
    method: "POST",
    body: JSON.stringify({
      user_id: USER_ID,
      platform: PLATFORM_NAMES[platform],
      goal_minutes: 15
    })
  });

  sessionIds[platform] = result.session_id;

  await chrome.storage.local.set({
    backendSessionIds: sessionIds
  });

  return result.session_id;
}

async function queueEvent(event) {
  if (!PLATFORM_NAMES[event.platform]) {
    throw new Error("Unsupported video platform");
  }

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

async function syncEvents() {
  let synced = 0;

  while (true) {
    const stored = await chrome.storage.local.get(
      "pendingEvents"
    );

    const events = stored.pendingEvents || [];

    if (events.length === 0) break;

    // Group uploads by platform so each batch
    // belongs to the correct session.
    const platform = events[0].platform || "youtube";

    const batch = events
      .filter(event =>
        (event.platform || "youtube") === platform
      )
      .slice(0, 100)
      .map(event => ({
        ...event,
        platform
      }));

    const sessionId =
      await getOrCreateSession(platform);

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

    await chrome.storage.local.set({
      pendingEvents: events.filter(
        event => !uploadedIds.has(event.event_id)
      )
    });

    synced += batch.length;
  }

  return { synced };
}

// Prevent simultaneous writes from overlapping.
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
          "Video synchronization failed:",
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

