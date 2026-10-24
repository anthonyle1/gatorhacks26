console.log("Healthy Doomscrolling is running!");

let currentVideoId = null;
let videoStartedAt = null;
let currentVideoSeconds = 0;
let lastCheck = Date.now();

let session = {
  durationSeconds: 0,
  videoCount: 0,
  currentVideoId: null,
  videoHistory: []
};

function getVideoId() {
  const match = window.location.pathname.match(
    /^\/shorts\/([^/]+)/
  );

  return match ? match[1] : null;
}

async function trackScrolling() {
  const now = Date.now();
  const elapsed = Math.min(
    (now - lastCheck) / 1000,
    2
  );

  lastCheck = now;

  const videoId = getVideoId();

  // Only count time when Shorts is visible
  if (videoId && !document.hidden) {
    session.durationSeconds += elapsed;

    if (videoId === currentVideoId) {
      currentVideoSeconds += elapsed;
    }
  }

  // Detect when the user changes Shorts
  if (videoId !== currentVideoId) {

    // Finish the previous video.
    if (currentVideoId && videoStartedAt) {
      sendVideoEvent(
        currentVideoId,
        videoStartedAt,
        currentVideoSeconds
      );
    }

    currentVideoId = videoId;
    session.currentVideoId = videoId;

    currentVideoSeconds = 0;
    videoStartedAt = videoId
      ? new Date().toISOString()
      : null;

    if (videoId) {
      session.videoCount++;

      session.videoHistory.push({
        videoId: videoId,
        timestamp: videoStartedAt
      });

      console.log(
        "New Short detected:",
        videoId
      );
    }
  }
  
  await chrome.storage.local.set({
    scrollingSession: session
  });
}

function sendVideoEvent(videoId, startedAt, seconds) {
  const event = {
    event_id: crypto.randomUUID(),
    video_id: videoId,
    sequence_number: session.videoHistory.length,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    dwell_seconds: Number(seconds.toFixed(2)),
    interest_match: null
  };

  chrome.runtime.sendMessage(
    {
      type: "VIDEO_EVENT",
      event
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Extension message failed:",
          chrome.runtime.lastError.message
        );
        return;
      }

      if (!response?.success) {
        console.error(
          "Upload failed:",
          response?.error
        );
      } else {
        console.log(
          "Video saved to backend:",
          videoId
        );
      }
    }
  );
}

// Check every second
setInterval(trackScrolling, 1000);
trackScrolling();
