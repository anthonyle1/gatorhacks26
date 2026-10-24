
async function updatePopup() {
  const result = await chrome.storage.local.get(
    "scrollingSession"
  );

  const session = result.scrollingSession;

  if (!session) {
    return;
  }

  const minutes = (
    session.durationSeconds / 60
  ).toFixed(1);

  document.getElementById("duration")
    .textContent = minutes + " min";

  document.getElementById("videoCount")
    .textContent = session.videoCount;

  document.getElementById("currentVideo")
    .textContent = session.currentVideoId || "None";
}

updatePopup();

// Refresh the popup every second
setInterval(updatePopup, 1000);
