
import { useEffect, useState } from "react";
import "./App.css";

interface ScrollingSession {
  durationSeconds: number;
  videoCount: number;
  currentVideoId: string | null;
  currentPlatform: string | null;
}

const initialSession: ScrollingSession = {
  durationSeconds: 0,
  videoCount: 0,
  currentVideoId: null,
  currentPlatform: null
};

function App() {
  const [session, setSession] =
    useState<ScrollingSession>(initialSession);

  useEffect(() => {
    const loadSession = async () => {
      const result = await chrome.storage.local.get(
        "scrollingSession"
      );

      if (result.scrollingSession) {
        setSession(
          result.scrollingSession as ScrollingSession
        );
      }
    };

    loadSession();

    const interval = setInterval(loadSession, 1000);

    return () => clearInterval(interval);
  }, []);

  const minutes = Math.floor(
    session.durationSeconds / 60
  );

  const seconds = Math.floor(
    session.durationSeconds % 60
  );

  const formattedTime =
    `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div className="app">
      <h1>Healthy Doomscrolling</h1>
      <p className="subtitle">
        Track your scrolling habits
      </p>

      <div className="stat-card">
        <span>Time spent scrolling</span>
        <h2>{formattedTime}</h2>
      </div>

      <div className="stat-card">
        <span>Videos watched</span>
        <h2>{session.videoCount}</h2>
      </div>

      <div className="stat-card">
        <span>Current platform</span>
        <h2>
          {session.currentPlatform ?? "None"}
        </h2>
      </div>

      <div className="stat-card">
        <span>Current video ID</span>
        <p className="video-id">
          {session.currentVideoId ?? "No video"}
        </p>
      </div>
    </div>
  );
}

export default App;
