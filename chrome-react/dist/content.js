
console.log("Healthy Doomscrolling is running! (comments-once v3)");

// ========================================
// 1. SESSION TRACKING
// ========================================

let currentVideoId = null;
let currentPlatform = null;
let videoStartedAt = null;
let currentVideoSeconds = 0;
let currentVisitId = null;
let currentQualified = false;
let qualificationSent = false;
let minimumWatchSeconds = 0;
let lastPlaybackCheck = Date.now();
let currentMetadata = { title: "", caption: "" };
let currentOccurrence = null;
let occurrenceGeneration = 0;
let previousMediaTime = null;
let previousClockTime = null;
let clockInterval = null;
const unsentEvents = new Map();
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
  const media = getActiveInstagramVideo();
  const playback = media && !media.paused && !media.ended && media.readyState >= 2;

  const videoId = video?.videoId ?? null;
  const platform = video?.platform ?? null;

  const changed =
    videoId !== currentVideoId ||
    platform !== currentPlatform || (playback && !currentOccurrence);

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

    currentVideoId = playback ? videoId : null;
    currentPlatform = playback ? platform : null;
    currentOccurrence = null;
    currentVisitId = crypto.randomUUID();
    currentQualified = false;
    qualificationSent = false;
    lastPlaybackCheck = now;
    currentMetadata = readVideoMetadata();

    session.currentVideoId = videoId;
    session.currentPlatform = platform;

    currentVideoSeconds = 0;

    videoStartedAt = videoId && playback
      ? new Date().toISOString()
      : null;

    if (videoId && playback) {
      beginOccurrence(video, media);
      qualifyCurrentVideo();

      console.log(
        "New video detected:",
        platform,
        videoId
      );
    }
  } else if (videoId && !document.hidden) {
    currentMetadata = readVideoMetadata();
    if (minimumWatchSeconds === 0) { session.durationSeconds += elapsed; currentVideoSeconds += elapsed; }
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

function readVideoMetadata() {
  return {
    title: (document.querySelector('meta[property="og:title"]')?.content || document.title || '').slice(0, 1000),
    caption: (document.querySelector('meta[property="og:description"]')?.content || '').slice(0, 16000)
  };
}

function buildVideoEvent(videoId, platform, startedAt, seconds) {
  return {
    event_id: currentVisitId || crypto.randomUUID(), video_id: videoId, platform,
    video_session_id: (platform === "youtube" ? "yt_" : "ig_") + videoId,
    occurrence_id: currentOccurrence?.occurrence_id || null,
    collection_visit_id: currentVisitId,
    ...currentMetadata,
    sequence_number: Math.max(1, session.videoHistory.length),
    started_at: startedAt, ended_at: new Date().toISOString(),
    dwell_seconds: Number(seconds.toFixed(2)), interest_match: null
  };
}

function sendVideoEvent(videoId, platform, startedAt, seconds) {
  const event = buildVideoEvent(videoId, platform, startedAt, seconds);
  unsentEvents.set(event.event_id, event);
  return transmitVideoEvent(event);
}

function beginOccurrence(video, media) {
  currentOccurrence = {
    occurrence_id: crypto.randomUUID(), video_session_id: (video.platform === "youtube" ? "yt_" : "ig_") + video.videoId,
    platform: video.platform, source_id: video.videoId, generation: ++occurrenceGeneration,
    started_at: new Date().toISOString(), duration: Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null,
    plan_version: 1,
  };
  previousMediaTime = media.currentTime;
  previousClockTime = Date.now();
  chrome.runtime.sendMessage({ type: "PLAYBACK_EVENT", occurrence: currentOccurrence, visit_id: currentVisitId }, () => { void chrome.runtime.lastError; });
}
function qualifyCurrentVideo() {
  if (!currentVideoId || currentVideoSeconds < minimumWatchSeconds) return;
  if (!currentQualified) {
    currentQualified = true;
    session.videoCount++;
    session.videoHistory.push({ videoId: currentVideoId, platform: currentPlatform, timestamp: videoStartedAt });
    chrome.runtime.sendMessage({ type: 'ACTIVITY_EVENT', event: buildVideoEvent(currentVideoId, currentPlatform, videoStartedAt, currentVideoSeconds) }, () => { void chrome.runtime.lastError; });
    if (minimumWatchSeconds > 0) session.durationSeconds += currentVideoSeconds;
  }
  if (minimumWatchSeconds > 0 && !qualificationSent) {
    qualificationSent = true;
    chrome.runtime.sendMessage({ type: 'VIDEO_QUALIFIED', visit_id: currentVisitId, played_seconds: currentVideoSeconds }, response => {
      if (chrome.runtime.lastError || !response?.success) qualificationSent = false;
    });
  }
}
function mediaClock() {
  const now = Date.now();
  const elapsed = Math.max(0, Math.min(.5, (now - lastPlaybackCheck) / 1000));
  lastPlaybackCheck = now;
  const detected = getCurrentVideo();
  const media = getActiveInstagramVideo();
  if (!currentOccurrence || !media || detected?.videoId !== currentVideoId || detected.platform !== currentPlatform) return;
  // Backward seeks and loops begin distinct capture occurrences, preserving overlap.
  const traversed = media.currentTime - previousMediaTime;
  const expected = media.paused ? 0 : (Date.now() - previousClockTime) / 1000 * media.playbackRate;
  if (previousMediaTime !== null && (traversed < -.2 || traversed - expected > .4 ||
      (Number.isFinite(media.duration) && currentOccurrence.duration !== media.duration))) beginOccurrence(detected, media);
  previousMediaTime = media.currentTime;
  previousClockTime = Date.now();
  const captureReason = media.paused || media.ended ? "paused" : media.readyState < 3 ? "buffering" :
    !mediaIdentityMatches(media, detected) ? "unverified_video" : "playing";
  if (minimumWatchSeconds > 0 && !document.hidden && !media.paused && !media.ended && media.readyState >= 3) {
    currentVideoSeconds += elapsed;
    if (currentQualified) session.durationSeconds += elapsed;
    qualifyCurrentVideo();
  }
  chrome.runtime.sendMessage({ type: "MEDIA_CLOCK", occurrence_id: currentOccurrence.occurrence_id,
    media_time: media.currentTime, rate: media.playbackRate,
    playing: captureReason === "playing", capture_reason: captureReason,
  }, () => { void chrome.runtime.lastError; });
}

function mediaIdentityMatches(media, detected) {
  if (document.querySelector('.ad-showing')) return false;
  const renderer = media.closest?.('ytd-reel-video-renderer');
  const rendererId = renderer?.getAttribute('video-id');
  if (rendererId) return rendererId === detected.videoId;
  let container = media.parentElement;
  for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
    const ids = new Set([...container.querySelectorAll('a[href]')].map(link => {
      const match = link.getAttribute('href')?.match(detected.platform === 'youtube' ? /\/shorts\/([^/?#]+)/ : /\/reels?\/([^/?#]+)/);
      return match?.[1];
    }).filter(Boolean));
    if (ids.size) return ids.size === 1 && ids.has(detected.videoId);
  }
  // Unknown DOM ownership is missing audio, never a guessed attribution.
  return false;
}

function transmitVideoEvent(event) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: "VIDEO_EVENT", event }, response => {
        if (chrome.runtime.lastError) {
          console.warn("Extension message failed:", chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        if (response?.success) unsentEvents.delete(event.event_id);
        else console.warn("Video upload failed:", response?.error);
        resolve(Boolean(response?.success));
      });
    } catch (error) {
      console.warn("Could not send video event:", error.message);
      resolve(false);
    }
  });
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
          ...readVideoMetadata(),
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

async function startTracking(reset = false) {
  const state = await chrome.storage.local.get(["trackingPaused", "sessionMinimumWatchSeconds"]);
  if (state.trackingPaused !== false) return;
  minimumWatchSeconds = globalThis.PruneCollection?.seconds(state.sessionMinimumWatchSeconds) || 0;
  lastPlaybackCheck = Date.now();
  clearInterval(trackingInterval);
  clearInterval(commentInterval);
  clearInterval(clockInterval);
  if (reset) {
    session = { durationSeconds: 0, videoCount: 0, currentVideoId: null, currentPlatform: null, videoHistory: [] };
    currentVideoId = null; currentPlatform = null; videoStartedAt = null; currentVideoSeconds = 0;
  }
  lastCheck = Date.now();
  trackingInterval = setInterval(trackScrolling, minimumWatchSeconds > 0 ? 250 : 1000);
  clockInterval = setInterval(mediaClock, 250);
  commentInterval = setInterval(processInstagramReel, 1000);
  trackScrolling();
  processInstagramReel();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FLUSH_SESSION") {
    if (minimumWatchSeconds > 0) mediaClock();
    clearInterval(trackingInterval);
    clearInterval(commentInterval);
    clearInterval(clockInterval);
    const previous = currentVideoId;
    const platform = currentPlatform;
    const started = videoStartedAt;
    const seconds = currentVideoSeconds;
    currentVideoId = null; videoStartedAt = null; currentPlatform = null;
    const uploads = [...unsentEvents.values()].map(transmitVideoEvent);
    if (previous && started) uploads.push(sendVideoEvent(previous, platform, started, seconds));
    if (minimumWatchSeconds > 0) uploads.push(chrome.storage.local.set({ scrollingSession: session }).then(() => true));
    Promise.all(uploads).then(results => sendResponse({ success: results.every(Boolean) }));
    return true;
  }
  if (message.type === "RESUME_SESSION") {
    startTracking(true).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  return false;
});
startTracking().catch(error => console.warn("Tracking unavailable:", error.message));

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
  clearInterval(clockInterval);
});
