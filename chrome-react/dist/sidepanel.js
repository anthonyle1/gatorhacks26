/*
 * Prune side panel.
 *
 * LIVE data:
 *   - "Now playing" and "Today so far" come from `scrollingSession`, which content.js saves to
 *     chrome.storage.local every second, plus GET {API_BASE}/hostility/{video_id} for each video.
 *
 * SAMPLE data (from the design mockups, replace when the backend can supply it):
 *   - BRANCHES (the categories shown in the tree)
 *   - SAMPLE_DAY_LEVELS (the colored calendar days)
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const API_BASE = 'http://localhost:8000'; // same server background.js talks to
  const WEBSITE_URL = 'http://localhost:5173'; // the Prune website (frontend/ dev server)
  const PRUNED_KEY = 'prunePruned';
  const RECHECK_MS = 20000; // re-ask the backend about an unrated Short
  const NEGATIVE_CACHE_MS = 15000;
  const MAX_HISTORY = 30;

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  // ---------------------------------------------------------------------------
  // SAMPLE DATA
  // ---------------------------------------------------------------------------
  const BRANCHES = [
    { id: 'youtuber-apologies', name: 'YouTuber apologies', level: 'heavy' },
    { id: 'influencer-drama', name: 'Influencer drama', level: 'heavy' },
    { id: 'kpop-live-vocals', name: 'K-pop live vocals', level: 'some' },
  ];

  // October 2026, days 1 to 24. 1 = calm, 2 = some, 3 = heavy.
  const SAMPLE_DAY_LEVELS = {};
  [1, 1, 2, 1, 1, 3, 2, 1, 1, 1, 2, 3, 3, 1, 1, 2, 1, 1, 1, 2, 2, 3, 1, 2].forEach((lv, i) => {
    SAMPLE_DAY_LEVELS[`2026-10-${String(i + 1).padStart(2, '0')}`] = lv;
  });

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------
  const LEVELS = {
    heavy: { label: 'Heavy hostility', cls: 'chip--heavy', note: 'Many comments here attack or mock people.' },
    some: { label: 'Some hostility', cls: 'chip--some', note: 'Some comments here put people down.' },
    calm: { label: 'Healthy', cls: 'chip--calm', note: 'Comments here are mostly friendly.' },
    not_rated: {
      label: 'Not rated yet',
      cls: 'chip--unrated',
      note: "This Short doesn't have enough comments to rate yet. It won't count toward your tree.",
    },
  };
  const LEAF_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"></path>' +
    '<path d="M2 21c0-3 1.9-5.4 5.1-6"></path></svg>';
  const SCISSORS_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M20 4 8.1 15.9"></path>' +
    '<path d="M14.5 14.5 20 20"></path><path d="M8.1 8.1 12 12"></path></svg>';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const today = new Date();
  const state = {
    session: null,
    pruned: {},
    now: { id: null, platform: null, status: 'idle', level: null, summary: '' },
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

  function chip(levelKey, extraClass) {
    const def = LEVELS[levelKey];
    const node = el('span', `chip ${def.cls} ${extraClass || ''}`.trim());
    node.innerHTML = LEAF_ICON;
    node.appendChild(document.createTextNode(def.label));
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
    } catch (error) {
      value = { level: 'not_rated', summary: '', unreachable: true };
    }
    levelCache.set(videoId, { value, at: Date.now() });
    return value;
  }

  // ---------------------------------------------------------------------------
  // Now playing
  // ---------------------------------------------------------------------------
  function platformName(platform) {
    return platform === 'instagram' ? 'Instagram Reel' : 'YouTube Short';
  }

  function renderNowPlaying() {
    const { id, platform, status, level, summary, unreachable } = state.now;
    const title = $('#now-title');
    const badge = $('#now-badge');
    const note = $('#now-note');
    badge.replaceChildren();

    if (!id) {
      title.textContent = 'Nothing playing right now';
      note.textContent = 'Open a YouTube Short or Instagram Reel and Prune will rate it.';
      return;
    }

    title.textContent = `${platformName(platform)} · ${id}`;

    if (status === 'loading') {
      note.textContent = 'Checking the comments...';
      return;
    }

    badge.appendChild(chip(level));
    if (unreachable) {
      note.textContent = "Can't reach the Prune server. Is the backend running on localhost:8000?";
    } else {
      note.textContent = level === 'not_rated' ? LEVELS.not_rated.note : summary || LEVELS[level].note;
    }
  }

  async function updateNowPlaying(force) {
    const session = state.session || {};
    const id = session.currentVideoId || null;
    const platform = session.currentPlatform || null;

    if (id !== state.now.id || platform !== state.now.platform) {
      state.now = { id, platform, status: id ? 'loading' : 'idle', level: null, summary: '', unreachable: false };
      renderNowPlaying();
    } else if (!force) {
      return;
    }
    if (!id) return;

    const result = await fetchHostility(id);
    if (state.now.id !== id) return; // user scrolled to another Short meanwhile
    state.now = { id, platform, status: 'done', level: result.level, summary: result.summary, unreachable: result.unreachable };
    renderNowPlaying();
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
  function treeSvg(pruned) {
    const kpop = pruned['kpop-live-vocals']
      ? '<path d="M170 214 C163 209 156 203 150 197" stroke="#6B4A33" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<path d="M145 203 L155 191" stroke="#3A2A1E" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M170 214 C145 196 115 168 92 134" stroke="#6B4A33" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<circle cx="86" cy="124" r="15" fill="#E3B44F"/><circle cx="70" cy="134" r="11" fill="#C9962E"/><circle cx="100" cy="112" r="11" fill="#E9C46A"/>';

    const influencer = pruned['influencer-drama']
      ? '<path d="M171 206 C178 201 185 196 191 191" stroke="#7A6A5C" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<path d="M187 185 L196 197" stroke="#3A2A1E" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M171 206 C200 186 230 160 258 126" stroke="#7A6A5C" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<circle cx="266" cy="116" r="9" fill="#8A5A3B"/><circle cx="252" cy="112" r="7" fill="#A9784F"/><circle cx="276" cy="128" r="6" fill="#8A5A3B"/>' +
        '<ellipse cx="292" cy="172" rx="5" ry="3" fill="#A9784F" transform="rotate(30 292 172)"/>' +
        '<ellipse cx="238" cy="196" rx="5" ry="3" fill="#8A5A3B" transform="rotate(-20 238 196)"/>';

    const youtuber = pruned['youtuber-apologies']
      ? '<path d="M171 180 C173 173 175 167 177 161" stroke="#7A6A5C" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<path d="M171 163 L184 160" stroke="#3A2A1E" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M171 180 C185 145 200 110 218 70" stroke="#7A6A5C" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<circle cx="224" cy="60" r="8" fill="#8A5A3B"/><circle cx="211" cy="58" r="6" fill="#A9784F"/>' +
        '<ellipse cx="250" cy="102" rx="5" ry="3" fill="#8A5A3B" transform="rotate(25 250 102)"/>';

    return (
      '<svg viewBox="0 0 340 330" role="img" aria-label="Your feed tree. Withered branches are where hostility grows.">' +
      '<ellipse cx="170" cy="318" rx="120" ry="10" fill="#E3EADF"/>' +
      '<path d="M169 262 C140 250 105 232 78 206" stroke="#6B4A33" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M171 250 C200 238 238 222 268 196" stroke="#6B4A33" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M170 175 C160 140 146 105 132 72" stroke="#6B4A33" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M170 318 C168 280 172 230 170 165" stroke="#6B4A33" stroke-width="16" fill="none" stroke-linecap="round"/>' +
      '<circle cx="70" cy="196" r="16" fill="#4E9A63"/><circle cx="52" cy="206" r="12" fill="#7DBB8B"/><circle cx="86" cy="184" r="12" fill="#7DBB8B"/><circle cx="60" cy="180" r="11" fill="#4E9A63"/>' +
      '<circle cx="276" cy="188" r="16" fill="#4E9A63"/><circle cx="292" cy="198" r="12" fill="#7DBB8B"/><circle cx="262" cy="176" r="12" fill="#7DBB8B"/><circle cx="286" cy="172" r="11" fill="#4E9A63"/>' +
      '<circle cx="128" cy="62" r="17" fill="#4E9A63"/><circle cx="112" cy="74" r="12" fill="#7DBB8B"/><circle cx="144" cy="50" r="12" fill="#7DBB8B"/><circle cx="120" cy="44" r="11" fill="#4E9A63"/>' +
      kpop +
      influencer +
      youtuber +
      '<path d="M170 168 C171 150 172 135 174 120" stroke="#6B4A33" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="166" cy="118" rx="7" ry="4" fill="#A8D5B2" transform="rotate(-30 166 118)"/>' +
      '<ellipse cx="182" cy="114" rx="7" ry="4" fill="#A8D5B2" transform="rotate(30 182 114)"/>' +
      '</svg>'
    );
  }

  function renderTree() {
    $('#tree').innerHTML = treeSvg(state.pruned);

    const count = BRANCHES.filter((b) => state.pruned[b.id]).length;
    const health = $('#tree-health');
    if (count === 0) {
      health.className = 'chip chip--sm chip--some';
      health.textContent = 'Wilting';
    } else if (count < BRANCHES.length) {
      health.className = 'chip chip--sm chip--recovering';
      health.textContent = 'Recovering';
    } else {
      health.className = 'chip chip--sm chip--thriving';
      health.textContent = 'Thriving';
    }

    const list = $('#branches');
    list.replaceChildren();
    BRANCHES.forEach((b) => {
      const isPruned = !!state.pruned[b.id];
      const row = el('div', 'branch');
      const info = el('div', 'branch__info');
      info.appendChild(el('span', 'branch__name', b.name));
      const level = el('span', `chip chip--xs ${isPruned ? 'chip--cut' : LEVELS[b.level].cls}`, isPruned ? 'Pruned' : LEVELS[b.level].label);
      info.appendChild(level);
      row.appendChild(info);

      const button = el('button', isPruned ? 'btn btn--outline' : 'btn btn--dark');
      button.type = 'button';
      button.dataset.branch = b.id;
      button.dataset.action = isPruned ? 'undo' : 'prune';
      if (isPruned) {
        button.textContent = 'Pruned · Undo';
      } else {
        button.innerHTML = SCISSORS_ICON;
        button.appendChild(document.createTextNode('Prune'));
      }
      row.appendChild(button);
      list.appendChild(row);
    });
  }

  function setPruned(id, value) {
    state.pruned = { ...state.pruned, [id]: value };
    renderTree();
    if (hasStorage) chrome.storage.local.set({ [PRUNED_KEY]: state.pruned });
  }

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
    // content.js rewrites the session every second; only react to real changes.
    if (previous.currentVideoId !== next.currentVideoId || previous.currentPlatform !== next.currentPlatform) {
      updateNowPlaying(false);
    }
    if (previous.videoCount !== next.videoCount || previous.currentVideoId !== next.currentVideoId) {
      renderToday();
      updateToday();
    }
  }

  async function init() {
    setLinks();
    renderCalendar();

    $('#branches').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-branch]');
      if (button) setPruned(button.dataset.branch, button.dataset.action === 'prune');
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
      const stored = await chrome.storage.local.get(['scrollingSession', PRUNED_KEY]);
      state.pruned = stored[PRUNED_KEY] || {};
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.scrollingSession) onSessionChanged(changes.scrollingSession.newValue);
        if (changes[PRUNED_KEY]) {
          state.pruned = changes[PRUNED_KEY].newValue || {};
          renderTree();
        }
      });
      state.session = stored.scrollingSession || null;
    }

    renderTree();
    renderNowPlaying();
    renderToday();
    updateNowPlaying(true);
    updateToday();

    // Unrated Shorts can become rated once the backend finishes analysing comments.
    setInterval(() => {
      const { status, level } = state.now;
      if (status === 'done' && level === 'not_rated') updateNowPlaying(true);
      updateToday();
    }, RECHECK_MS);
  }

  init();
})();
