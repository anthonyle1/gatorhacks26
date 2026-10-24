
console.log("Healthy Doomscrolling is running!");

let currentVideoId = null;
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
  }

  // Detect when the user changes Shorts
  if (videoId && videoId !== currentVideoId) {
    currentVideoId = videoId;

    session.videoCount++;
    session.currentVideoId = videoId;

    session.videoHistory.push({
      videoId: videoId,
      timestamp: new Date().toISOString()
    });

    console.log("New Short detected:", videoId);
  }

  if (!videoId) {
    currentVideoId = null;
    session.currentVideoId = null;
  }

  await chrome.storage.local.set({
    scrollingSession: session
  });
}

// Check every second
setInterval(trackScrolling, 1000);
trackScrolling();
