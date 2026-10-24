
function updatePopup() {
  chrome.storage.local.get(
    ["scrollingSession"],
    (result) => {

      const session = result.scrollingSession;

      if (!session) {
        return;
      }

      const minutes = (
        session.durationSeconds / 60
      ).toFixed(1);

      document.getElementById("duration")
        .textContent = `${minutes} min`;

      document.getElementById("videoCount")
        .textContent = session.videoCount;

      document.getElementById("platform")
        .textContent = session.currentPlatform
          ? session.currentPlatform.toUpperCase()
          : "None";

      document.getElementById("videoId")
        .textContent = session.currentVideoId || "None";
    }
  );
}

// Update every second
setInterval(updatePopup, 1000);

updatePopup();
