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
  let topicsRefreshGeneration = 0;

  async function refreshDetectionTopics() {
    const generation = ++topicsRefreshGeneration;
    const list = document.getElementById('detection-topics-list');
    const status = document.getElementById('detection-topics-status');
    const section = list.closest('section');
    section.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${API_BASE}/detection/topics`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Topics unavailable');
      const data = await response.json();
      if (!Array.isArray(data.topics)) throw new Error('Invalid topics');
      if (generation !== topicsRefreshGeneration) return;
      const checkedTopics = new Map();
      for (const root of data.topics) {
        for (const topic of [root, ...(root.descendants || [])]) checkedTopics.set(topic.id, topic);
      }
      const items = [...checkedTopics.values()].sort((a, b) => a.name.localeCompare(b.name)).map(topic => {
        const item = document.createElement('li');
        item.textContent = topic.name;
        return item;
      });
      list.replaceChildren(...items);
      document.getElementById('detection-topics-count').textContent = String(items.length);
      status.textContent = items.length ? '' : 'No topics pruned yet.';
      status.hidden = items.length > 0;
    } catch {
      if (generation !== topicsRefreshGeneration) return;
      status.hidden = false;
      status.textContent = list.children.length ? 'Could not refresh topics. Showing the last loaded list.' : 'Could not load pruned topics. Check that the backend is running.';
    } finally {
      if (generation === topicsRefreshGeneration) section.setAttribute('aria-busy', 'false');
    }
  }

  // ---------------------------------------------------------------------------
  // SAMPLE DATA
  // ---------------------------------------------------------------------------
  // October 2026, days 1 to 24. 1 = calm, 2 = some, 3 = heavy.
  // const SAMPLE_DAY_LEVELS = {};
  // [1, 1, 2, 1, 1, 3, 2, 1, 1, 1, 2, 3, 3, 1, 1, 2, 1, 1, 1, 2, 2, 3, 1, 2].forEach((lv, i) => {
  //   SAMPLE_DAY_LEVELS[`2026-10-${String(i + 1).padStart(2, '0')}`] = lv;
  // });

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
    $('#session-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('#session-count').textContent = String(session.videoCount || 0);
    $('.session-card').dataset.state = state.sessionBusy ? 'busy' : recording ? 'recording' : unfinished ? 'paused' : 'idle';
    $('#session-status').textContent = state.sessionBusy ? 'Working...' : recording ? 'Recording' : unfinished ? 'Paused' : 'Ready';
    const button = $('#session-toggle');
    $('#session-toggle-label').textContent = state.sessionBusy ? 'Please wait...' : unfinished ? 'Finish & review' : 'Start session';
    button.setAttribute('aria-busy', String(state.sessionBusy));
    button.disabled = !state.sessionReady || state.sessionBusy;
    $('#session-note').textContent = recording ? 'Scroll as usual. Finish when you are ready to see what grew in your tree.' : unfinished ? 'Your session is saved. Finish it to see your review, then start fresh.' : 'Start a session, then scroll as usual. Finish to grow your topic tree.';
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
  // Calendar — daily insights from the backend
  // ---------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  let selectedCalendarDate = null;
  let calendarDetailRequestId = 0;

  // Map of YYYY-MM-DD -> daily summary
  let monthlyInsights = new Map();

  // Prevent an older fetch from overwriting a newer month's data.
  let calendarRequestId = 0;
  let calendarLoading = false;
  let calendarError = false;

  async function loadCalendarInsights() {
    const requestId = ++calendarRequestId;

    const year = state.month.getFullYear();
    const monthIndex = state.month.getMonth();

    const month = `${year}-${pad(monthIndex + 1)}`;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Clear stale data before loading another month.
    monthlyInsights = new Map();
    calendarLoading = true;
    calendarError = false;
    renderCalendar();

    try {
      const params = new URLSearchParams({month, timezone});

      const response = await fetch(`${API_BASE}/local-sessions/daily?${params.toString()}`);

      if (!response.ok) {throw new Error(`Calendar request failed: ${response.status}`);}

      const data = await response.json();

      // User may have navigated to another month while loading.
      if (requestId !== calendarRequestId) return;

      monthlyInsights = new Map((data.days || []).map(day => [day.date, day]));

      calendarError = false;
    } catch (error) {
      if (requestId !== calendarRequestId) return;

      monthlyInsights = new Map();
      calendarError = true;

      console.warn("Could not load daily insights:", error);
    } finally {
      if (requestId === calendarRequestId) {
        calendarLoading = false;
        renderCalendar();
      }
    }
  }

  async function showDaySummary(date) {
    const requestId = ++calendarDetailRequestId;
    selectedCalendarDate = date;

    let container = document.querySelector('#prune-day-summary');

    if (!container) {
      container = document.createElement('div');
      container.id = 'prune-day-summary';
      container.className = 'prune-day-summary';

      // Add to the existing calendar card, below its grid/legend.
      const calendarGrid = document.querySelector('#cal-grid');
      calendarGrid?.parentElement?.appendChild(container);
    }

    if (!container) return;

    container.replaceChildren();

    const heading = el('strong', '', `Daily insights · ${date}`);
    const message = el('p', '', 'Loading daily activity…');
    container.append(heading, message);

    try {
      const params = new URLSearchParams({timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,});

      const response = await fetch(`${API_BASE}/local-sessions/daily/${date}?${params}`);

      if (!response.ok) throw new Error('Could not load day');

      const data = await response.json();
      if (requestId !== calendarDetailRequestId) return;

      container.replaceChildren(heading);

      const summary = data.summary;

      container.appendChild(
        el('p', '', `${summary.videos_watched} videos · ${Math.round(summary.watch_seconds / 60)} min watched`)
      );

      container.appendChild(
        el('p', '', `${summary.negative_count} potential warnings · ${summary.not_assessed_count} not assessed`)
      );

      const categoryHeading = el('strong', '', 'Top topics');
      container.appendChild(categoryHeading);

      if (!data.top_categories.length) {
        container.appendChild(
          el('p', '', 'No categories available for this day.')
        );
      } else {
        const list = el('ul', 'prune-day-summary__topics');

        data.top_categories.slice(0, 3).forEach(topic => {
          list.appendChild(
            el('li', '', `${topic.name} · ${topic.video_count} videos`)
          );
        });

        container.appendChild(list);
      }

      const link = el('a', '', 'View full day →');
      link.href = `${WEBSITE_URL}/calendar?date=${date}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      container.appendChild(link);
    } catch {
      if (requestId !== calendarDetailRequestId) return;
      container.replaceChildren(heading, el('p', '', 'Daily insights are unavailable.'));
    }
  }

  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();

    $('#cal-heading').textContent = new Intl.DateTimeFormat(
      'en-US', {month: 'long', year: 'numeric',}).format(state.month);

    const grid = $('#cal-grid');
    grid.replaceChildren();

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstWeekday; i++) {
      grid.appendChild(el('span', 'cal__cell cal__cell--blank'));}

    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(state.month);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);

      const isFuture = date > todayStart;
      const isToday = date.getTime() === todayStart.getTime();

      const key = dateKey(year, month, d);
      const activity = monthlyInsights.get(key);

      let cell;

      if (!isFuture && activity && activity.videos_watched > 0) {
        const hasWarning = activity.negative_count > 0;
        const hasUncertainty = activity.uncertain_count > 0;
        const hasUnrated = activity.not_assessed_count > 0;

        // Existing CSS already supports calm/some/heavy day colors.
        // Here they represent assessment status, not a daily
        // hostility score.
        const levelClass = hasWarning ? 'heavy' : hasUncertainty || hasUnrated ? 'some' : 'calm';

        cell = el('a', `cal__cell cal__cell--${levelClass}`, String(d));

        // Open the actual selected date in the dashboard.
        cell.href = `${WEBSITE_URL}/calendar?date=${key}`;
        cell.target = '_blank';
        cell.rel = 'noopener';

        cell.addEventListener('click', event => {event.preventDefault(); void showDaySummary(key);});

        const warningDescription = hasWarning ? `, ${activity.negative_count} potential content warnings` : '';

        const unknownDescription = hasUncertainty || hasUnrated ? ', some assessments incomplete or uncertain' : '';

        cell.setAttribute(
          'aria-label',
          `${monthName} ${d}: ${activity.videos_watched} video encounters${warningDescription}${unknownDescription}. View details.`
        );

        cell.title =
          `${activity.videos_watched} videos watched` +
          (hasWarning
            ? ` · ${activity.negative_count} potential warnings`
            : '') +
          (hasUncertainty || hasUnrated
            ? ' · Some assessments uncertain or unavailable'
            : '');
      } else {
        cell = el(
          'span',
          `cal__cell ${
            isFuture
              ? 'cal__cell--future'
              : 'cal__cell--none'
          }`,
          String(d)
        );

        let description = 'no recorded completed-session activity';

        if (isFuture) {description = 'upcoming';
        } else if (calendarLoading) {description = 'loading';
        } else if (calendarError) {description = 'activity unavailable';}

        cell.setAttribute('aria-label', `${monthName} ${d} (${description})`);
      }

      if (isToday) {cell.classList.add('cal__cell--today');}

      grid.appendChild(cell);
    }

    const currentMonth = today.getFullYear() * 12 + today.getMonth();

    $('#cal-next').disabled = year * 12 + month >= currentMonth;
  }

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------
  function setLinks() {
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
    void refreshDetectionTopics();
    renderCalendar();
    void loadCalendarInsights();
    topicGarden = new window.TopicGarden(API_BASE);
    const showView = settings => {
      $('#garden-view').hidden = settings;
      $('#settings-view').hidden = !settings;
      $('#settings-link').setAttribute('aria-expanded', String(settings));
      if (!settings) void topicGarden.refresh();
    };
    $('#settings-link').addEventListener('click', () => { showView(true); $('#settings-back').focus(); });
    $('#settings-back').addEventListener('click', () => { showView(false); $('#settings-link').focus(); });
    const renderDetectionDelay = value => {
      const seconds = globalThis.PruneDetection.delay(value);
      $('#detection-delay').value = String(seconds);
      $('#detection-delay-value').textContent = `${seconds} seconds`;
      $('#detection-delay').setAttribute('aria-valuetext', `${seconds} seconds of visible playback`);
    };
    $('#detection-delay').addEventListener('input', event => renderDetectionDelay(Number(event.target.value)));
    $('#detection-delay').addEventListener('change', async event => {
      try {
        await chrome.storage.local.set({ detectionDelaySeconds: globalThis.PruneDetection.delay(Number(event.target.value)) });
        $('#detection-delay-error').hidden = true;
        $('#detection-delay-saved').textContent = 'Saved. Applies immediately.';
      } catch {
        $('#detection-delay-error').textContent = 'Could not save detection delay. Please try again.';
        $('#detection-delay-error').hidden = false;
      }
    });
    let minimum = 0, lastMinimum = 2;
    const renderMinimum = value => {
      minimum = globalThis.PruneCollection?.seconds(value) || 0;
      $('#skip-short-videos').checked = minimum > 0;
      $('#minimum-watch-seconds').value = String(minimum);
      $('#minimum-watch-value').textContent = `${minimum} ${minimum === 1 ? 'second' : 'seconds'}`;
      $('#minimum-watch-seconds').setAttribute('aria-valuetext', minimum ? `${minimum} seconds minimum` : 'Collect all videos');
      $('#collection-setting-description').textContent = minimum ? `Videos played for less than ${minimum} ${minimum === 1 ? 'second' : 'seconds'} will be skipped.` : 'All played videos are collected.';
    };
    const saveMinimum = async value => {
      renderMinimum(value);
      if (minimum > 0) lastMinimum = minimum;
      try {
        await chrome.storage.local.set({ minimumWatchSeconds: minimum, lastMinimumWatchSeconds: lastMinimum });
        $('#collection-settings-error').hidden = true;
        $('#collection-settings-saved').textContent = 'Saved for your next session';
      } catch {
        $('#collection-settings-error').textContent = 'Could not save your settings. Please try again.';
        $('#collection-settings-error').hidden = false;
      }
    };
    $('#skip-short-videos').addEventListener('change', event => { void saveMinimum(event.target.checked ? lastMinimum || 2 : 0); });
    $('#minimum-watch-seconds').addEventListener('input', event => renderMinimum(event.target.value));
    $('#minimum-watch-seconds').addEventListener('change', event => { void saveMinimum(event.target.value); });
    const refreshVisibleTree = () => {
      if (document.visibilityState !== 'hidden') { void topicGarden.refresh(); void refreshDetectionTopics(); }
    };
    document.addEventListener('visibilitychange', refreshVisibleTree);
    window.addEventListener('focus', refreshVisibleTree);
    window.addEventListener('pageshow', refreshVisibleTree);
    chrome.runtime?.onMessage?.addListener(message => { if (message?.type === 'REFRESH_TOPIC_TREE') refreshVisibleTree(); });
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
      $('#audio-toggle').textContent = audioRecording ? 'Disconnect audio' : 'Connect video audio';
      $('#audio-enabled').disabled = audioRecording;
      $('#audio-state').textContent = display.label.charAt(0) + display.label.slice(1).toLowerCase();
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
      void loadCalendarInsights();
    });

    $('#cal-next').addEventListener('click', () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      void loadCalendarInsights();
    });


    if (hasStorage) {
      const stored = await chrome.storage.local.get(['scrollingSession', 'pruneTopicTree', 'lastSessionReview', 'audioCaptureEnabled', 'audioCaptureStatus', 'audioBackendStatus', 'minimumWatchSeconds', 'lastMinimumWatchSeconds', ...SESSION_KEYS]);
      const detectionSettings = await chrome.storage.local.get('detectionDelaySeconds');
      renderDetectionDelay(detectionSettings.detectionDelaySeconds);
      $('#detection-delay').disabled = false;
      lastMinimum = globalThis.PruneCollection?.seconds(stored.lastMinimumWatchSeconds) || 2;
      renderMinimum(stored.minimumWatchSeconds);
      $('#skip-short-videos').disabled = false;
      $('#minimum-watch-seconds').disabled = false;
      $('#audio-enabled').checked = stored.audioCaptureEnabled !== false;
      renderAudio(stored.audioCaptureStatus, stored.audioBackendStatus);
      void topicGarden.start(stored.pruneTopicTree || stored.lastSessionReview);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.detectionPreferencesPending?.newValue === true) {
          topicsRefreshGeneration++;
          $('#detection-topics-status').textContent = 'Updating saved topics…';
          $('#detection-topics-status').hidden = false;
          $('#detection-topics-list').closest('section').setAttribute('aria-busy', 'true');
        } else if (changes.detectionBlacklistVersion || changes.detectionPreferencesPending?.newValue === false || changes.pruneTreeReset) {
          void refreshDetectionTopics();
        }
        if (changes.detectionDelaySeconds) renderDetectionDelay(changes.detectionDelaySeconds.newValue);
        if (changes.minimumWatchSeconds) renderMinimum(changes.minimumWatchSeconds.newValue);
        if (changes.lastMinimumWatchSeconds) lastMinimum = globalThis.PruneCollection?.seconds(changes.lastMinimumWatchSeconds.newValue) || 2;
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
    setInterval(refreshVisibleTree, 3000);
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
