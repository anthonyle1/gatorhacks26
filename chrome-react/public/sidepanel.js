/* Prune side panel: live rolling activity, session controls, and saved topic garden. */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const API_BASE = 'http://localhost:8000'; // same server background.js talks to
  const WEBSITE_URL = 'http://localhost:5173'; // the Prune website (frontend/ dev server)
  const RECHECK_MS = 15000; // Refresh activity and analysis checkpoints.

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  let topicsRefreshGeneration = 0;
  let restoringTopics = false, topicRestoreButtons = [], compostSignature = null;
  let compostState = { roots: [], selected: [], count: 0, nodes: new Map() }, compostVersion = null;
  let compostRows = new Map(), compostTopics = [];
  let compostPieces = new Map();

  function renderDetectionCompost(roots, count) {
    const signature = JSON.stringify([roots.map(root => [root.id, root.name]), count]);
    if (signature === compostSignature) return;
    compostSignature = signature;
    compostPieces = new Map();
    const pile = document.getElementById('detection-compost');
    pile.replaceChildren();
    pile.setAttribute('aria-label', `Compost pile with ${roots.length} pruned branches covering ${count} topics`);
    const svgNode = (tag, attributes) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
    const extraHeight = Math.ceil(Math.max(0, roots.length - 8) / 4) * 28;
    const sceneHeight = 200 + extraHeight;
    const svg = svgNode('svg', { viewBox: `0 0 260 ${sceneHeight}`, 'aria-hidden': 'true', focusable: 'false' });
    svg.style.height = `${sceneHeight * .775}px`;
    svg.appendChild(svgNode('ellipse', { cx: 130, cy: 182 + extraHeight, rx: 116, ry: 9, fill: '#dcdcca' }));
    if (roots.length) svg.appendChild(svgNode('path', { d: 'M18 180C40 144 80 126 130 124C180 126 220 144 242 180Z', fill: '#7a5a3e', transform: `translate(0 ${extraHeight})` }));
    const slots = [[40, 134, -8], [130, 138, 10], [86, 122, 4], [20, 114, -18], [150, 118, -6], [64, 102, 16], [118, 98, -12], [92, 82, 6]];
    roots.forEach((topic, index) => {
      const [x, y, rotation] = index < slots.length ? [slots[index][0], slots[index][1] + extraHeight, slots[index][2]] :
        [20 + (index - slots.length) % 4 * 53, 64 + Math.floor((index - slots.length) / 4) * 28, index % 2 ? 8 : -8];
      const position = svgNode('g', { transform: `translate(${x} ${y}) rotate(${rotation})` });
      const branch = svgNode('g', { class: 'detection-compost__piece' });
      compostPieces.set(topic.id, branch);
      branch.style.animationDelay = `${Math.min(index, 8) * 30}ms`;
      branch.appendChild(svgNode('path', { d: 'M4 20C20 16 40 14 66 10M30 15C34 9 38 6 44 4', stroke: '#6b4a33', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }));
      for (const [cx, cy, rx, ry, fill] of [[66, 9, 6, 3.5, '#8a5a3b'], [46, 4, 5, 3, '#8a5a3b'], [20, 22, 5, 3, '#a9784f']]) {
        branch.appendChild(svgNode('ellipse', { cx, cy, rx, ry, fill }));
      }
      const title = svgNode('title', {}); title.textContent = topic.name; branch.appendChild(title);
      position.appendChild(branch); svg.appendChild(position);
    });
    const caption = svgNode('text', { x: 130, y: roots.length ? sceneHeight - 2 : 160, 'text-anchor': 'middle', class: 'detection-compost__caption' });
    caption.textContent = roots.length ? `${roots.length} pruned ${roots.length === 1 ? 'branch' : 'branches'} · ${count} topics` : 'Compost bin empty.';
    svg.appendChild(caption); pile.appendChild(svg);
    const flames = el('div', 'compost-fire'); flames.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index++) flames.appendChild(PruneCompost.icon('flame'));
    pile.appendChild(flames);
  }

  async function permanentlyPruneCompost(ids, name) {
    if (restoringTopics || !ids.length) return;
    const prompt = `Permanently delete "${name}" and all its child topics from your tree?`;
    if (!window.confirm(`${prompt}\n\nThis cannot be undone. Deleted topics stay blocked and cannot be restored.`)) return;
    restoringTopics = true; topicsRefreshGeneration++;
    topicRestoreButtons.forEach(button => { button.disabled = true; });
    $('#compost-clear').disabled = true;
    const feedback = $('#detection-topics-feedback'); feedback.hidden = false;
    feedback.textContent = `Permanently pruning ${name}…`;
    const pile = $('#detection-compost');
    try {
      if (hasStorage) await chrome.storage.local.set({ detectionPreferencesPending: true,
        detectionPreferencesPendingUntil: Date.now() + 20000, detectionMutation: crypto.randomUUID() });
      const response = await fetch(`${API_BASE}/local-sessions/taxonomy/compost`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_ids: ids, blacklist_version: compostVersion, confirmed: true }), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Could not permanently prune topics.');
      if (hasStorage && result.blacklist_version) await chrome.storage.local.set({ detectionBlacklistVersion: result.blacklist_version }).catch(() => {});
      if (Array.isArray(result.tree)) await topicGarden?.applySnapshot(result);
      // Burn only after deletion succeeds, and only inside the compost bin.
      for (const id of ids) {
        compostRows.get(id)?.classList.add('compost-item--burning');
        compostPieces.get(id)?.classList.add('compost-piece--burning');
      }
      pile.classList.add('detection-compost--burning');
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 700));
      const deleted = new Set(result.deleted_ids || ids);
      renderCompostTopics(compostTopics.map(root => ({ ...root, permanent: root.permanent || deleted.has(root.id),
        descendants: (root.descendants || []).map(child => ({ ...child, permanent: child.permanent || deleted.has(child.id) })) })), result.blacklist_version);
      feedback.textContent = `${name} permanently pruned.`;
    } catch (error) {
      feedback.textContent = `${error.message || 'Permanent pruning failed.'} Your saved topics are shown below.`;
    } finally {
      pile.classList.remove('detection-compost--burning');
      if (hasStorage) {
        await chrome.storage.local.set({ detectionPreferencesPending: false }).catch(() => {});
        void chrome.runtime.sendMessage({ type: 'DETECTION_REFRESH' }).catch(() => {});
      }
      restoringTopics = false;
      topicRestoreButtons.forEach(button => { button.disabled = false; });
      await refreshDetectionTopics();
      void topicGarden?.refresh();
    }
  }

  async function unpruneDetectionTopics(roots, name, animateBurn = false) {
    if (restoringTopics || !roots.length) return;
    restoringTopics = true; topicsRefreshGeneration++;
    topicRestoreButtons.forEach(button => { button.disabled = true; });
    $('#compost-clear').disabled = true;
    const feedback = document.getElementById('detection-topics-feedback');
    feedback.hidden = false; feedback.textContent = `Unpruning ${name}…`;
    try {
      if (hasStorage) await chrome.storage.local.set({ detectionPreferencesPending: true,
        detectionPreferencesPendingUntil: Date.now() + roots.length * 15000 + 5000, detectionMutation: crypto.randomUUID() });
      for (const root of roots) {
        const response = await fetch(`${API_BASE}/local-sessions/taxonomy/preferences`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category_id: root.id, reduce: false }), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Could not save topic preference');
        const result = await response.json();
        if (hasStorage && result.blacklist_version) await chrome.storage.local.set({ detectionBlacklistVersion: result.blacklist_version });
      }
      if (animateBurn) {
        compostRows.forEach(row => row.classList.add('compost-item--burning'));
        compostPieces.forEach(piece => piece.classList.add('compost-piece--burning'));
        $('#detection-compost').classList.add('detection-compost--burning');
        if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 700));
      }
      feedback.textContent = `${name} unpruned.`;
    } catch {
      feedback.textContent = `Could not finish unpruning ${name}. Please try again. The list shows the latest saved topics.`;
    } finally {
      if (animateBurn) $('#detection-compost').classList.remove('detection-compost--burning');
      if (hasStorage) {
        await chrome.storage.local.set({ detectionPreferencesPending: false }).catch(() => {});
        void chrome.runtime.sendMessage({ type: 'DETECTION_REFRESH' }).catch(() => {});
      }
      restoringTopics = false;
      topicRestoreButtons.forEach(button => { button.disabled = false; });
      await refreshDetectionTopics();
      void topicGarden?.refresh();
    }
  }

  function renderCompostTopics(topics, version) {
    compostTopics = topics;
    const list = $('#detection-topics-list'), status = $('#detection-topics-status');
    compostVersion = version;
    compostState = PruneCompost.hierarchy(topics);
    compostRows = new Map();
    topicRestoreButtons = [];
    const renderTopic = topic => {
      const item = el('li', 'compost-item'); compostRows.set(topic.id, item);
      const row = el('div', 'compost-row'); row.appendChild(PruneCompost.icon('branch'));
      const label = el('span', 'detection-topic__label', topic.name);
      const roots = topic.coverage;
      const parents = roots.filter(root => root.id !== topic.id);
      if (parents.length) label.appendChild(el('small', 'detection-topic__parent', `Pruned with ${parents.map(root => root.name).join(', ')}`));
      if (!roots.length) label.appendChild(el('small', 'detection-topic__parent', 'Parent topic'));
      row.appendChild(label);
      if (roots.length) {
      if (!parents.length) {
      const restore = el('button', 'detection-topic__restore', 'Unprune');
      restore.type = 'button';
      restore.title = `Unprune ${roots.map(root => root.name).join(', ')} to restore ${topic.name}`;
      restore.setAttribute('aria-label', restore.title);
      restore.addEventListener('click', () => unpruneDetectionTopics(roots, topic.name));
      restore.appendChild(PruneCompost.icon('restore'));
      topicRestoreButtons.push(restore);
      row.appendChild(restore);
      }
      const burn = el('button', 'compost-delete'); burn.type = 'button';
      burn.title = `Delete ${topic.name} and its child topics forever`; burn.setAttribute('aria-label', burn.title);
      burn.appendChild(PruneCompost.icon('flame'));
      burn.addEventListener('click', () => permanentlyPruneCompost([topic.id], topic.name));
      topicRestoreButtons.push(burn); row.appendChild(burn);
      }
      item.appendChild(row);
      if (topic.children.length) {
        const children = el('ul', 'compost-children'); children.setAttribute('aria-label', `Child topics of ${topic.name}`);
        topic.children.forEach(child => children.appendChild(renderTopic(child))); item.appendChild(children);
      }
      return item;
    };
    const items = compostState.roots.map(renderTopic);
    list.replaceChildren(...items);
    renderDetectionCompost([...compostState.nodes.values()].filter(topic => topic.coverage.length), compostState.count);
    $('#compost-clear').disabled = !compostState.selected.length;
    document.getElementById('detection-topics-count').textContent = String(compostState.count);
    status.textContent = items.length ? '' : topics.some(topic => topic.permanent) ?
      'Compost bin empty. Permanently pruned topics stay blocked.' : 'No topics pruned yet.';
    status.hidden = items.length > 0;
  }

  async function refreshDetectionTopics() {
    if (restoringTopics) return;
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
      renderCompostTopics(data.topics, data.blacklist_version);
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
    day: { videos: [], unavailable: false },
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
  function renderActivityVideo(video) {
    const row = el('li', 'today-video');
    row.appendChild(el('strong', '', video.title || video.video_id));
    row.appendChild(el('p', 'note-sm', `${video.platform} · ${Math.round(video.dwell_seconds || 0)}s watched`));
    row.appendChild(el('p', '', PruneActivity.insightText(video)));
    row.appendChild(el('p', 'note-sm', PruneActivity.commentText(video)));
    return row;
  }

  function renderToday() {
    const videos = state.day?.videos || [];
    const totals = PruneActivity.summarize(videos);
    $('#today-count').textContent = `${totals.videos_watched} video${totals.videos_watched === 1 ? '' : 's'}`;
    const signals = totals.warning_count + totals.positive_insight_count;
    $('#meter-marker').hidden = signals === 0;
    if (signals) $('#meter-marker').style.left = `${Math.round(totals.warning_count / signals * 100)}%`;
    $('#today-summary').textContent = `${totals.warning_count} warnings · ${totals.positive_insight_count} positive insights` +
      (totals.not_assessed_count ? ` · ${totals.not_assessed_count} videos awaiting assessment` : '') +
      (state.day?.unavailable ? ' · Backend unavailable; showing saved activity' : '');
    const commentVideos = videos.filter(video => video.comment_counts).length;
    $('#today-comments').textContent = commentVideos ?
      `Comments: ${totals.comment_counts.positive} positive · ${totals.comment_counts.neutral} neutral · ${totals.comment_counts.negative} negative · available for ${commentVideos}/${videos.length} videos` :
      'Comment analysis pending or unavailable';
    const list = $('#today-video-list'); list.replaceChildren();
    for (const video of videos.slice(-20).reverse()) list.appendChild(renderActivityVideo(video));
    if (!videos.length) list.appendChild(el('li', 'note-sm', 'No videos watched in the past 24 hours.'));
  }

  let todayUpdating = false, todayRefreshQueued = false;
  async function updateToday() {
    if (todayUpdating) { todayRefreshQueued = true; return; }
    todayUpdating = true;
    try {
      const buffered = hasStorage ? await chrome.storage.local.get('dailyActivityEvents') : {};
      state.day = { ...state.day, videos: PruneActivity.recent(state.day?.videos || [], buffered.dailyActivityEvents || []) };
      renderToday();
      if (hasStorage) await chrome.runtime.sendMessage({ type: 'SYNC_DAILY_ACTIVITY' }).catch(() => null);
      let videos = state.day?.videos || [], unavailable = false;
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const response = await fetch(`${API_BASE}/local-sessions/activity/recent?${new URLSearchParams({ timezone })}`, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Activity unavailable');
        videos = (await response.json()).videos || [];
      } catch { unavailable = true; }
      const stored = hasStorage ? await chrome.storage.local.get('dailyActivityEvents') : {};
      state.day = { videos: PruneActivity.recent(videos, stored.dailyActivityEvents || []), unavailable };
      renderToday();
    } finally {
      todayUpdating = false;
      if (todayRefreshQueued) { todayRefreshQueued = false; void updateToday(); }
    }
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

  const calendarCells = new Map();

  async function showDaySummary(date) {
    const requestId = ++calendarDetailRequestId;
    selectedCalendarDate = date;
    for (const [key, cell] of calendarCells) cell.setAttribute('aria-pressed', String(key === date));

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

    window.clearDailySummary?.(container);
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

      if (window.renderDailySummary) {
        window.renderDailySummary(container, data);
        return;
      }
      container.replaceChildren(heading);

      const summary = data.summary;

      container.appendChild(
        el('p', '', `${summary.videos_watched} videos · ${Math.round(summary.watch_seconds / 60)} min watched`)
      );

      container.appendChild(
        el('p', '', `${summary.warning_count} warnings · ${summary.positive_insight_count} positive insights · ${summary.not_assessed_count} not assessed`)
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

      const videos = el('ul', 'today-video-list');
      for (const video of data.videos || []) videos.appendChild(renderActivityVideo(video));
      container.appendChild(videos);

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

    calendarCells.clear();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
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
        const hasWarning = activity.warning_count > 0;
        const hasUncertainty = activity.uncertain_count > 0;
        const hasUnrated = activity.not_assessed_count > 0;

        // Existing CSS already supports calm/some/heavy day colors.
        // Here they represent assessment status, not a daily
        // hostility score.
        const levelClass = hasWarning ? 'heavy' : hasUncertainty || hasUnrated ? 'some' : 'calm';

        cell = el('button', `cal__cell cal__cell--${levelClass}`);
        cell.type = 'button';
        cell.appendChild(el('span', '', String(d)));
        cell.appendChild(el('small', 'cal__count', `${activity.videos_watched} videos`));
        cell.setAttribute('aria-pressed', String(selectedCalendarDate === key));
        calendarCells.set(key, cell);

        cell.addEventListener('click', event => {event.preventDefault(); void showDaySummary(key);});

        const warningDescription = hasWarning ? `, ${activity.warning_count} potential content warnings` : '';

        const unknownDescription = hasUncertainty || hasUnrated ? ', some assessments incomplete or uncertain' : '';

        cell.setAttribute(
          'aria-label',
          `${monthName} ${d}: ${activity.videos_watched} video encounters${warningDescription}${unknownDescription}. View details.`
        );

        cell.title =
          `${activity.videos_watched} videos watched` +
          (hasWarning
            ? ` · ${activity.warning_count} potential warnings`
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

        let description = 'no recorded activity';

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
    $('#compost-clear-icon').appendChild(PruneCompost.icon('restore'));
    $('#compost-clear').addEventListener('click', () => unpruneDetectionTopics(compostState.selected, 'All listed topics', true));
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
    let savedAutoSkip = false;
    const renderAutoSkip = value => {
      savedAutoSkip = value === true;
      $('#auto-skip-topics').checked = savedAutoSkip;
    };
    $('#auto-skip-topics').addEventListener('change', async event => {
      const enabled = event.target.checked === true;
      try {
        await chrome.storage.local.set({ detectionAutoSkip: enabled });
        renderAutoSkip(enabled);
        $('#auto-skip-error').hidden = true;
      } catch {
        renderAutoSkip(savedAutoSkip);
        $('#auto-skip-error').textContent = 'Could not save automatic skipping. Please try again.';
        $('#auto-skip-error').hidden = false;
      }
    });
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
      const detectionSettings = await chrome.storage.local.get(['detectionDelaySeconds', 'detectionAutoSkip']);
      renderDetectionDelay(detectionSettings.detectionDelaySeconds);
      renderAutoSkip(detectionSettings.detectionAutoSkip);
      $('#auto-skip-topics').disabled = false;
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
        if (changes.detectionAutoSkip) renderAutoSkip(changes.detectionAutoSkip.newValue);
        if (changes.minimumWatchSeconds) renderMinimum(changes.minimumWatchSeconds.newValue);
        if (changes.lastMinimumWatchSeconds) lastMinimum = globalThis.PruneCollection?.seconds(changes.lastMinimumWatchSeconds.newValue) || 2;
        if (changes.audioCaptureEnabled) { $('#audio-enabled').checked = changes.audioCaptureEnabled.newValue !== false; renderAudio(); }
        if (changes.audioCaptureStatus) renderAudio(changes.audioCaptureStatus.newValue);
        if (changes.audioBackendStatus) renderAudio(audioValue, changes.audioBackendStatus.newValue);
        if (changes.pruneTreeReset?.newValue) topicGarden.clear();
        if (changes.lastSessionReview) void topicGarden.refresh();
        if (changes.dailyActivityEvents || changes.lastSessionReview || changes.lastCompletedLocalSessionId) {
          if (changes.dailyActivityEvents) {
            state.day = { ...state.day, videos: PruneActivity.recent(state.day?.videos || [], changes.dailyActivityEvents.newValue || []) };
            renderToday();
          }
          void updateToday(); void loadCalendarInsights();
          if (selectedCalendarDate) void showDaySummary(selectedCalendarDate);
        }
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

    // Refresh analysis checkpoints and expire encounters as they leave the rolling day.
    setInterval(() => {
      void updateToday(); void loadCalendarInsights();
      if (selectedCalendarDate) void showDaySummary(selectedCalendarDate);
    }, RECHECK_MS);
  }

  init().catch(error => {
    $('#session-status').textContent = 'Unavailable';
    $('#session-error').textContent = error.message || 'Could not load session tracking.';
    $('#session-error').hidden = false;
  });
})();
