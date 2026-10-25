/*
 * Prune side panel.
 *
 * LIVE data:
 *   - The topic garden uses the global saved taxonomy (topic-tree.js).
 *   - Session controls use the background session commands. "Today so far" uses `scrollingSession`, saved to
 *     chrome.storage.local every second, plus GET {API_BASE}/hostility/{video_id} for each video.
 *
 * SAMPLE data (from the design mockups, replace when the backend can supply it):
 *   - SAMPLE_DAY_LEVELS (the colored calendar days)
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const API_BASE = 'http://localhost:8000'; // same server background.js talks to
  const WEBSITE_URL = 'http://localhost:5173'; // the Prune website (frontend/ dev server)
  const RECHECK_MS = 20000; // re-ask the backend about an unrated Short
  const NEGATIVE_CACHE_MS = 15000;
  const MAX_HISTORY = 30;

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  // ---------------------------------------------------------------------------
  // SAMPLE DATA
  // ---------------------------------------------------------------------------
  // October 2026, days 1 to 24. 1 = calm, 2 = some, 3 = heavy.
  const SAMPLE_DAY_LEVELS = {};
  [1, 1, 2, 1, 1, 3, 2, 1, 1, 1, 2, 3, 3, 1, 1, 2, 1, 1, 1, 2, 2, 3, 1, 2].forEach((lv, i) => {
    SAMPLE_DAY_LEVELS[`2026-10-${String(i + 1).padStart(2, '0')}`] = lv;
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const today = new Date();
  const state = {
    session: null,
    trackingPaused: true, localSessionId: null, finishPending: false, lastCompletedLocalSessionId: null,
    sessionBusy: false, sessionReady: false,
    day: { rated: 0, calm: 0, some: 0, heavy: 0, score: null },
    month: new Date(today.getFullYear(), today.getMonth(), 1),
  };

  const $ = (sel) => document.querySelector(sel);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------------------
  // Backend: GET /hostility/{video_id} -> calm | some | heavy | not_rated
  // ---------------------------------------------------------------------------
  const levelCache = new Map(); // videoId -> { value, at }

  function normalizeLevel(data) {
    // Accepts {"level": "calm"}, {"hostility": "calm"}, or a bare "calm" string.
    const raw =
      typeof data === 'string'
        ? data
        : data && (data.level ?? data.hostility_level ?? data.hostility ?? data.rating ?? data.label);
    const value = String(raw || '').toLowerCase();
    return value === 'calm' || value === 'some' || value === 'heavy' ? value : 'not_rated';
  }

  function pickSummary(data) {
    if (!data || typeof data !== 'object') return '';
    const text = data.summary ?? data.reason ?? data.explanation ?? '';
    return typeof text === 'string' ? text : '';
  }

  async function fetchHostility(videoId) {
    const cached = levelCache.get(videoId);
    if (cached) {
      const settled = cached.value.level === 'calm' || cached.value.level === 'some' || cached.value.level === 'heavy';
      if (settled || Date.now() - cached.at < NEGATIVE_CACHE_MS) return cached.value;
    }

    let value;
    try {
      const response = await fetch(`${API_BASE}/hostility/${encodeURIComponent(videoId)}`);
      if (response.status === 404) {
        value = { level: 'not_rated', summary: '', unreachable: false };
      } else if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      } else {
        const data = await response.json();
        value = { level: normalizeLevel(data), summary: pickSummary(data), unreachable: false };
      }
    } catch {
      value = { level: 'not_rated', summary: '', unreachable: true };
    }
    levelCache.set(videoId, { value, at: Date.now() });
    return value;
  }

  // ---------------------------------------------------------------------------
  // Session controls
  // ---------------------------------------------------------------------------
  const SESSION_KEYS = ['trackingPaused', 'localSessionId', 'finishPending', 'lastCompletedLocalSessionId'];

  function renderSession() {
    const recording = state.trackingPaused === false;
    const unfinished = recording || state.finishPending || !!state.localSessionId;
    const session = state.session || {};
    const seconds = Math.floor(session.durationSeconds || 0);
    $('#session-stats').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} \u00b7 ${session.videoCount || 0} videos`;
    $('#session-status').textContent = state.sessionBusy ? 'Working...' : recording ? 'Recording' : unfinished ? 'Finish pending' : 'Ready to start';
    const button = $('#session-toggle');
    button.textContent = state.sessionBusy ? 'Working...' : unfinished ? 'Finish session' : 'Start tracking';
    button.disabled = !state.sessionReady || state.sessionBusy;
    $('#session-note').textContent = recording ? 'Tracking Shorts and Reels. Finish to update your saved topic tree.' : unfinished ? 'Finish the saved session before starting another.' : 'Start a session to track YouTube Shorts and Instagram Reels.';
    $('#session-review').hidden = !state.lastCompletedLocalSessionId;
  }

  async function syncSessionControls() {
    const stored = await chrome.storage.local.get(['scrollingSession', ...SESSION_KEYS]);
    state.session = stored.scrollingSession || null;
    for (const key of SESSION_KEYS) state[key] = stored[key];
    state.sessionReady = true;
    renderSession();
  }

  async function toggleSession() {
    if (state.sessionBusy || !state.sessionReady) return;
    const finish = state.trackingPaused === false || state.finishPending || !!state.localSessionId;
    state.sessionBusy = true;
    const error = $('#session-error');
    error.hidden = true;
    renderSession();
    try {
      const response = await chrome.runtime.sendMessage({ type: finish ? 'FINISH_SESSION' : 'START_SESSION' });
      if (!response?.success) throw new Error(response?.error || 'Could not update session tracking.');
    } catch (cause) {
      error.textContent = cause.message || 'Could not update session tracking.';
      error.hidden = false;
    } finally {
      try { await syncSessionControls(); }
      catch { error.textContent = 'Could not read session status. Reopen the panel to retry.'; error.hidden = false; }
      state.sessionBusy = false;
      renderSession();
    }
  }

  // ---------------------------------------------------------------------------
  // Today so far
  // ---------------------------------------------------------------------------
  function renderToday() {
    const session = state.session || {};
    const count = session.videoCount || 0;
    $('#today-count').textContent = `${count} ${count === 1 ? 'Short' : 'Shorts'}`;

    const marker = $('#meter-marker');
    const summary = $('#today-summary');
    const { rated, calm, score } = state.day;

    if (rated === 0 || score === null) {
      marker.hidden = true;
      summary.textContent = count === 0 ? 'Nothing watched yet.' : 'Waiting on ratings for your Shorts.';
      return;
    }

    marker.hidden = false;
    marker.style.left = `${Math.round(score * 100)}%`;
    if (score < 0.25) {
      summary.textContent = calm === rated ? 'All calm so far.' : 'Mostly calm, with a few rough patches.';
    } else if (score < 0.6) {
      summary.textContent = 'A mix of calm and rough patches.';
    } else {
      summary.textContent = 'Getting heavy today.';
    }
  }

  async function updateToday() {
    const history = (state.session && state.session.videoHistory) || [];
    const ids = [];
    for (let i = history.length - 1; i >= 0 && ids.length < MAX_HISTORY; i--) {
      if (history[i] && history[i].videoId && !ids.includes(history[i].videoId)) ids.push(history[i].videoId);
    }

    const results = await Promise.all(ids.map((id) => fetchHostility(id)));
    const tally = { rated: 0, calm: 0, some: 0, heavy: 0 };
    results.forEach((r) => {
      if (r.level === 'calm' || r.level === 'some' || r.level === 'heavy') {
        tally.rated++;
        tally[r.level]++;
      }
    });
    const score = tally.rated ? (tally.some * 0.5 + tally.heavy) / tally.rated : null;
    state.day = { ...tally, score };
    renderToday();
  }

  // ---------------------------------------------------------------------------
  // Tree
  // ---------------------------------------------------------------------------
  let topicGarden;

  // ---------------------------------------------------------------------------
  // Calendar
  // ---------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    $('#cal-heading').textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(state.month);

    const grid = $('#cal-grid');
    grid.replaceChildren();

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstWeekday; i++) grid.appendChild(el('span', 'cal__cell cal__cell--blank'));

    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(state.month);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const isFuture = date > todayStart;
      const isToday = date.getTime() === todayStart.getTime();
      const level = SAMPLE_DAY_LEVELS[dateKey(year, month, d)];
      const levelClass = level === 1 ? 'calm' : level === 2 ? 'some' : level === 3 ? 'heavy' : null;

      let cell;
      if (!isFuture && levelClass) {
        cell = el('a', `cal__cell cal__cell--${levelClass}`, String(d));
        cell.href = `${WEBSITE_URL}/calendar`;
        cell.target = '_blank';
        cell.rel = 'noopener';
        cell.setAttribute('aria-label', `${monthName} ${d}: see details`);
      } else {
        cell = el('span', `cal__cell ${isFuture ? 'cal__cell--future' : 'cal__cell--none'}`, String(d));
        cell.setAttribute('aria-label', `${monthName} ${d}${isFuture ? ' (upcoming)' : ' (no data)'}`);
      }
      if (isToday) cell.classList.add('cal__cell--today');
      grid.appendChild(cell);
    }

    const current = today.getFullYear() * 12 + today.getMonth();
    $('#cal-next').disabled = year * 12 + month >= current;
  }

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------
  function setLinks() {
    $('#settings-link').href = `${WEBSITE_URL}/settings`;
    $('#full-tree-link').href = WEBSITE_URL;
    $('#measure-link').href = `${WEBSITE_URL}/how-we-measure`;
  }

  function onSessionChanged(session) {
    const previous = state.session || {};
    state.session = session || null;
    const next = state.session || {};
    renderSession();
    // content.js rewrites the session every second; only react to real changes.
    if (previous.videoCount !== next.videoCount || previous.currentVideoId !== next.currentVideoId) {
      renderToday();
      updateToday();
    }
  }

  async function init() {
    setLinks();
    renderCalendar();
    topicGarden = new window.TopicGarden(API_BASE);
    $('#session-toggle').addEventListener('click', toggleSession);
    $('#audio-enabled').addEventListener('change', async event => {
      await chrome.storage.local.set({ audioCaptureEnabled: event.target.checked });
    });
    let audioRecording = false;
    let audioValue = {}, audioBackend = {};
    function renderAudio(value = audioValue, backend = audioBackend) {
      audioValue = value || {}; audioBackend = backend || {}; value = audioValue;
      audioRecording = !!value.recording;
      const display = describeAudioStatus(audioValue, audioBackend, $('#audio-enabled').checked);
      $('#audio-toggle').textContent = audioRecording ? 'Stop audio capture' : 'Capture selected tab audio';
      $('#audio-enabled').disabled = audioRecording;
      $('#audio-state').textContent = display.label;
      $('#audio-state').dataset.tone = display.tone;
      $('#audio-status').textContent = display.detail;
      $('#audio-model').textContent = display.model;
      $('#audio-progress').textContent = display.counts;
      $('#audio-transcript').textContent = display.transcript;
    }
    $('#audio-toggle').addEventListener('click', async () => {
      const response = await chrome.runtime.sendMessage({ type: audioRecording ? 'CAPTURE_STOP' : 'CAPTURE_START' });
      if (!response?.success) $('#audio-status').textContent = response?.error || 'Audio capture unavailable';
    });
    $('#tree-reset').addEventListener('click', async () => {
      if (!window.confirm('Reset the entire saved tree? This removes all categories, video memberships, and See less preferences across sessions. Individual video analyses are kept.')) return;
      const button = $('#tree-reset');
      const status = $('#tree-reset-status');
      button.disabled = true;
      status.hidden = false;
      status.textContent = 'Resetting...';
      try {
        const response = await chrome.runtime.sendMessage({ type: 'RESET_TOPIC_TREE' });
        if (!response?.success) throw new Error(response?.error || 'Could not reset the tree.');
        topicGarden.clear();
        status.textContent = 'Tree reset. New sessions will build a fresh tree.';
      } catch (error) { status.textContent = error.message || 'Could not reset the tree.'; }
      finally { button.disabled = false; }
    });

    $('#cal-prev').addEventListener('click', () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
      renderCalendar();
    });
    $('#cal-next').addEventListener('click', () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      renderCalendar();
    });

    if (hasStorage) {
      const stored = await chrome.storage.local.get(['scrollingSession', 'pruneTopicTree', 'lastSessionReview', 'audioCaptureEnabled', 'audioCaptureStatus', 'audioBackendStatus', ...SESSION_KEYS]);
      $('#audio-enabled').checked = stored.audioCaptureEnabled !== false;
      renderAudio(stored.audioCaptureStatus, stored.audioBackendStatus);
      void topicGarden.start(stored.pruneTopicTree || stored.lastSessionReview);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.audioCaptureEnabled) { $('#audio-enabled').checked = changes.audioCaptureEnabled.newValue !== false; renderAudio(); }
        if (changes.audioCaptureStatus) renderAudio(changes.audioCaptureStatus.newValue);
        if (changes.audioBackendStatus) renderAudio(audioValue, changes.audioBackendStatus.newValue);
        if (changes.pruneTreeReset?.newValue) topicGarden.clear();
        if (changes.lastSessionReview) void topicGarden.refresh();
        for (const key of SESSION_KEYS) { if (changes[key]) state[key] = changes[key].newValue; }
        if (changes.scrollingSession) onSessionChanged(changes.scrollingSession.newValue);
        renderSession();
      });
      state.session = stored.scrollingSession || null;
      for (const key of SESSION_KEYS) state[key] = stored[key];
      state.sessionReady = true;
    }

    if (!hasStorage) void topicGarden.start();
    setInterval(() => { void topicGarden.refresh(); }, 3000);
    renderSession();
    renderToday();
    updateToday();
    async function refreshAudio() {
      try { await chrome.runtime.sendMessage({ type: 'AUDIO_DIAGNOSTICS' }); } catch { /* Backend availability is shown separately. */ }
      renderAudio();
    }
    void refreshAudio();
    setInterval(() => { void refreshAudio(); }, 3000);

    // Unrated Shorts can become rated once the backend finishes analysing comments.
    setInterval(() => {
      updateToday();
    }, RECHECK_MS);
  }

  init().catch(error => {
    $('#session-status').textContent = 'Unavailable';
    $('#session-error').textContent = error.message || 'Could not load session tracking.';
    $('#session-error').hidden = false;
  });
})();
