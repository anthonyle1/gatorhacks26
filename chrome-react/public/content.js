
console.log("Healthy Doomscrolling is running! (comments-once v3)");

// ========================================
// 1. SESSION TRACKING
// ========================================

let currentVideoId = null;
let currentPlatform = null;
let videoStartedAt = null;
let currentVideoSeconds = 0;
let lastCheck = Date.now();

let trackingInterval = null;
let commentInterval = null;

let session = {
  durationSeconds: 0,
  videoCount: 0,
  currentVideoId: null,
  currentPlatform: null,
  videoHistory: []
};

// ========================================
// 2. DETECT CURRENT VIDEO
// ========================================

function getCurrentVideo() {
  const path = window.location.pathname;
  const hostname = window.location.hostname;

  // YouTube Shorts
  if (
    hostname === "www.youtube.com" ||
    hostname === "youtube.com"
  ) {
    const match = path.match(/^\/shorts\/([^/]+)/);

    if (match) {
      return {
        platform: "youtube",
        videoId: match[1]
      };
    }
  }

  // Instagram Reels
  if (
    hostname === "www.instagram.com" ||
    hostname === "instagram.com"
  ) {
    const match = path.match(/^\/reels?\/([^/]+)/);

    if (match) {
      return {
        platform: "instagram",
        videoId: match[1]
      };
    }
  }

  return null;
}

// ========================================
// 3. TRACK SCROLLING
// ========================================

async function trackScrolling() {
  const now = Date.now();

  const elapsed = Math.min(
    (now - lastCheck) / 1000,
    2
  );

  lastCheck = now;

  const video = getCurrentVideo();

  const videoId = video?.videoId ?? null;
  const platform = video?.platform ?? null;

  const changed =
    videoId !== currentVideoId ||
    platform !== currentPlatform;

  if (changed) {
    // Finish tracking previous video
    if (currentVideoId && videoStartedAt) {
      sendVideoEvent(
        currentVideoId,
        currentPlatform,
        videoStartedAt,
        currentVideoSeconds
      );
    }

    currentVideoId = videoId;
    currentPlatform = platform;

    session.currentVideoId = videoId;
    session.currentPlatform = platform;

    currentVideoSeconds = 0;

    videoStartedAt = videoId
      ? new Date().toISOString()
      : null;

    if (videoId) {
      session.videoCount++;

      session.videoHistory.push({
        videoId,
        platform,
        timestamp: videoStartedAt
      });

      console.log(
        "New video detected:",
        platform,
        videoId
      );
    }
  } else if (videoId && !document.hidden) {
    session.durationSeconds += elapsed;
    currentVideoSeconds += elapsed;
  }

  try {
    await chrome.storage.local.set({
      scrollingSession: session
    });
  } catch (error) {
    console.warn(
      "Extension storage unavailable:",
      error.message
    );

    clearInterval(trackingInterval);
    clearInterval(commentInterval);
  }
}

// ========================================
// 4. SEND VIDEO EVENTS TO BACKGROUND
// ========================================

function sendVideoEvent(
  videoId,
  platform,
  startedAt,
  seconds
) {
  const event = {
    event_id: crypto.randomUUID(),
    video_id: videoId,
    platform,
    sequence_number: session.videoHistory.length,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    dwell_seconds: Number(seconds.toFixed(2)),
    interest_match: null
  };

  try {
    chrome.runtime.sendMessage(
      {
        type: "VIDEO_EVENT",
        event
      },
      response => {
        if (chrome.runtime.lastError) {
          console.warn(
            "Extension message failed:",
            chrome.runtime.lastError.message
          );
          return;
        }

        if (!response?.success) {
          console.warn(
            "Video upload failed:",
            response?.error
          );
        } else {
          console.log(
            "Video saved to backend:",
            platform,
            videoId
          );
        }
      }
    );
  } catch (error) {
    console.warn(
      "Could not send video event:",
      error.message
    );
  }
}

// ========================================
// 5. FIND ACTIVE INSTAGRAM VIDEO
// ========================================

function getActiveInstagramVideo() {
  const videos = [
    ...document.querySelectorAll("video")
  ];

  const candidates = videos
    .map(video => {
      const rect = video.getBoundingClientRect();

      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) -
        Math.max(rect.top, 0)
      );

      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, window.innerWidth) -
        Math.max(rect.left, 0)
      );

      return {
        video,
        visibleArea: visibleHeight * visibleWidth,
        playing: !video.paused
      };
    })
    .filter(item => item.visibleArea > 0)
    .sort((a, b) => {
      if (a.playing !== b.playing) {
        return a.playing ? -1 : 1;
      }

      return b.visibleArea - a.visibleArea;
    });

  return candidates[0]?.video ?? null;
}

// ========================================
// 6. FIND COMMENT BUTTON FOR ACTIVE REEL
// ========================================

function findActiveReelCommentButton(video) {
  if (!video) return null;

  let container = video.parentElement;

  while (
    container &&
    container !== document.body
  ) {
    const icons = [
      ...container.querySelectorAll(
        'svg[aria-label="Comment"], ' +
        'svg[aria-label="Comments"]'
      )
    ];

    const buttons = icons
      .map(icon =>
        icon.closest('button, [role="button"]')
      )
      .filter(Boolean)
      .filter(button => {
        const rect = button.getBoundingClientRect();

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        );
      });

    const videosInContainer =
      container.querySelectorAll("video");

    // Prevent selecting another Reel's button
    if (
      buttons.length === 1 &&
      videosInContainer.length === 1
    ) {
      return buttons[0];
    }

    container = container.parentElement;
  }

  return null;
}

// ========================================
// 7. EXTRACT INSTAGRAM COMMENTS
// ========================================

function getInstagramComments(dialog) {
  if (!dialog) return [];

  const lines = dialog.innerText
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const comments = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    // Matches timestamps such as 11w, 2d, 4h
    if (/^\d+[smhdw]$/.test(lines[i])) {
      const text = lines[i + 1];

      if (
        text &&
        text !== "Reply" &&
        !/likes?$/i.test(text) &&
        !seen.has(text)
      ) {
        seen.add(text);
        comments.push(text);
      }
    }

    if (comments.length >= 10) {
      break;
    }
  }

  return comments;
}

// ========================================
// 8. SEND INSTAGRAM COMMENTS TO BACKGROUND
// ========================================

function sendInstagramComments(videoId, comments) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "INSTAGRAM_COMMENTS",
          video_id: videoId,
          comments
        },
        response => {
          if (chrome.runtime.lastError) {
            console.error(
              "Instagram message failed:",
              chrome.runtime.lastError.message
            );

            resolve(false);
            return;
          }

          if (!response?.success) {
            console.error(
              "Instagram upload failed:",
              response?.error
            );

            resolve(false);
            return;
          }

          console.log(
            "Instagram comments sent to backend:",
            response.data
          );

          resolve(true);
        }
      );
    } catch (error) {
      console.error(
        "Could not send Instagram comments:",
        error.message
      );

      resolve(false);
    }
  });
}

// ========================================
// 9. AUTOMATIC INSTAGRAM COMMENT COLLECTION
// ========================================

let processingReel = false;

// Tracks the Reel currently being viewed
let activeReelId = null;

// Reels whose comments were already auto-opened
const openedReels = new Set();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function getInstagramDialog() {
  return document.querySelector('div[role="dialog"]');
}

async function processInstagramReel() {
  const reel = getCurrentVideo();

  if (!reel || reel.platform !== "instagram") {
    return;
  }

  const reelId = reel.videoId;

  // Detect navigation to another Reel
  if (reelId !== activeReelId) {
    console.log("Switched to Reel:", reelId);
    activeReelId = reelId;
  }

  // Never reopen a Reel's comments automatically
  // after they've already been opened.
  if (
    processingReel ||
    openedReels.has(reelId)
  ) {
    return;
  }

  processingReel = true;

  try {
    // Give Instagram time to update the Reel
    await sleep(700);

    if (getCurrentVideo()?.videoId !== reelId) {
      return;
    }

    const activeVideo = getActiveInstagramVideo();

    if (!activeVideo) {
      console.log("No active Instagram video found");
      return;
    }

    const button =
      findActiveReelCommentButton(activeVideo);

    if (!button) {
      console.log(
        "Could not find active Reel comment button"
      );
      return;
    }

    // Don't interfere with an existing dialog
    if (getInstagramDialog()) {
      return;
    }

    // IMPORTANT: Remember this Reel before clicking.
    // Closing comments won't cause another click.
    openedReels.add(reelId);

    console.log(
      "Opening comments once for Reel:",
      reelId
    );

    button.click();

    let comments = [];
    let dialogAppeared = false;

    // Wait up to 4 seconds for comments
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(400);

      // Stop if the user scrolled away
      if (getCurrentVideo()?.videoId !== reelId) {
        console.log(
          "Reel changed during comment collection"
        );
        return;
      }

      const dialog = getInstagramDialog();

      if (!dialog) {
        // The user may have closed the comments.
        if (dialogAppeared) {
          console.log(
            "Comments manually closed:",
            reelId
          );
          return;
        }

        continue;
      }

      dialogAppeared = true;
      comments = getInstagramComments(dialog);

      if (comments.length > 0) {
        break;
      }
    }

    if (comments.length === 0) {
      console.log(
        "No comments extracted for Reel:",
        reelId
      );
      return;
    }

    if (getCurrentVideo()?.videoId !== reelId) {
      return;
    }

    console.log("Instagram Reel ID:", reelId);
    console.log("Extracted comments:", comments);

    // Send comments to FastAPI via background.js
    const uploaded = await sendInstagramComments(
      reelId,
      comments
    );

    if (uploaded) {
      console.log(
        "Successfully processed Reel:",
        reelId
      );
    }
  } catch (error) {
    console.error(
      "Instagram comment processing error:",
      error
    );
  } finally {
    processingReel = false;
  }
}

// ========================================
// 10. START TRACKING
// ========================================

trackingInterval = setInterval(
  trackScrolling,
  1000
);

commentInterval = setInterval(
  processInstagramReel,
  1000
);

trackScrolling();
processInstagramReel();

// ========================================
// 11. PAGE EXIT
// ========================================

window.addEventListener("pagehide", () => {
  if (currentVideoId && videoStartedAt) {
    sendVideoEvent(
      currentVideoId,
      currentPlatform,
      videoStartedAt,
      currentVideoSeconds
    );
  }

  clearInterval(trackingInterval);
  clearInterval(commentInterval);
});