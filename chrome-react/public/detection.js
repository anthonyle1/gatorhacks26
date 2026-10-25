/* Page adapter for real-time reminders. Session collection owns none of this state. */
(() => {
  let tracking = false, pending = false, version = null, available = false, requestId = null;
  let host = null, frame = null, refreshing = null, stopped = false;
  let sessionId = null;
  let activeReminder = null;
  let alertsOpen = false, alertToggle = null, railStyle = null;
  let slideTimer = null, motionElement = null, restoreToggleFocus = false;
  let historyElement = null, lastRenderedEntry = null;
  let skipToastTimer = null;
  const reminderHistory = [];
  const HISTORY_BATCH = 3;
  let pendingRecoveryTimer = null;
  let retryTimer = null, uncertainKey = null, retryCount = 0;
  const notified = new Set();
  const mediaIds = new WeakMap();
  let mediaSequence = 0;
  const send = message => chrome.runtime.sendMessage(message).catch(() => null);

  function recoverPending(deadline) {
    clearTimeout(pendingRecoveryTimer);
    if (pending) pendingRecoveryTimer = setTimeout(() => { void refresh(); }, Math.max(0, (deadline || 0) - Date.now()) + 50);
  }

  function removeReminder() {
    if (!activeReminder) return;
    activeReminder = null;
    renderAfterExit();
  }

  function cancelReminderForNavigation() {
    if (!activeReminder?.autoSkipped) removeReminder();
  }

  function renderAfterExit(target = motionElement) {
    clearTimeout(slideTimer);
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      renderReminders(); return;
    }
    target.className += ' leaving';
    target.inert = true;
    slideTimer = setTimeout(renderReminders, 260);
  }

  function toggleReminders(open) {
    alertsOpen = open;
    restoreToggleFocus = true;
    if (open) renderReminders(); else renderAfterExit(historyElement);
  }

  function resetReminders() {
    clearTimeout(skipToastTimer);
    clearTimeout(slideTimer); motionElement = null; restoreToggleFocus = false;
    activeReminder = null; reminderHistory.length = 0;
    lastRenderedEntry = null;
    try { sessionStorage.removeItem('pruneAlertHistory'); } catch { /* Storage may be blocked. */ }
    alertsOpen = false;
    railStyle?.remove(); railStyle = null;
    host?.remove(); host = null;
  }

  function saveReminders() {
    try {
      sessionStorage.setItem('pruneAlertHistory', JSON.stringify({ sessionId, entries: reminderHistory }));
    } catch { /* Keep in-memory history if page storage is unavailable. */ }
  }

  function restoreReminders(id) {
    sessionId = id || null;
    try {
      const saved = JSON.parse(sessionStorage.getItem('pruneAlertHistory') || 'null');
      if (id && saved?.sessionId === id && Array.isArray(saved.entries)) {
        reminderHistory.push(...saved.entries.filter(entry => typeof entry?.title === 'string' && typeof entry?.category === 'string').slice(-50));
      } else sessionStorage.removeItem('pruneAlertHistory');
    } catch { /* Malformed history must not prevent tracking. */ }
    renderReminders();
  }

  function updateReminderSession(id) {
    // Finishing removes localSessionId; retain the completed session until a new ID arrives.
    if (!id || id === sessionId) return;
    sessionId = id; notified.clear(); resetReminders(); renderReminders();
  }

  function read() {
    if (stopped || !tracking || pending || !available || !version || document.hidden) return null;
    const video = getCurrentVideo();
    const media = getActiveInstagramVideo();
    if (!video || !media || media.paused || media.ended || media.seeking || media.readyState < 3 || !mediaIdentityMatches(media, video)) return null;
    const rect = media.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top));
    if (!rect.width || !rect.height || width * height < Math.min(rect.width * rect.height, innerWidth * innerHeight) * 0.5) return null;
    if (!mediaIds.has(media)) mediaIds.set(media, ++mediaSequence);
    return { ...video, media, key: `${video.platform}:${video.videoId}:${mediaIds.get(media)}:${version}` };
  }

  function metadata(video) {
    const renderer = video.media.closest('ytd-reel-video-renderer');
    let title = '', caption = '';
    if (renderer) {
      title = renderer.querySelector('#video-title, yt-shorts-video-title-view-model, h2')?.textContent || '';
      caption = renderer.querySelector('#description')?.textContent || '';
    } else {
      let parent = video.media.parentElement;
      for (let depth = 0; parent && depth < 7; depth++, parent = parent.parentElement) {
        if (parent.querySelectorAll('video').length !== 1) break;
        const heading = parent.querySelector('h1');
        if (heading) { caption = heading.textContent || ''; break; }
      }
    }
    // Page metadata is usable only if it explicitly identifies this video.
    const ogUrl = document.querySelector('meta[property="og:url"]')?.content || '';
    if (ogUrl.includes(`/${video.videoId}/`) || ogUrl.endsWith(`/${video.videoId}`) || ogUrl.includes(`v=${video.videoId}&`) || ogUrl.endsWith(`v=${video.videoId}`)) {
      const fallback = readVideoMetadata();
      title ||= fallback.title; caption ||= fallback.caption;
    }
    return { title: title.trim().slice(0, 1000), caption: caption.trim().slice(0, 4000) };
  }

  function nextShort(video) {
    const current = getCurrentVideo();
    if (current?.platform !== 'youtube' || current.videoId !== video.videoId) return false;
    const nextButton = [...document.querySelectorAll(
      'ytd-shorts #navigation-button-down button, ytd-shorts button[aria-label="Next video"], ytd-shorts button[aria-label="Next"]'
    )].find(button => {
      const rect = button.getBoundingClientRect();
      return !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    if (nextButton) { nextButton.click(); return true; }

    const renderer = video.media.closest('ytd-reel-video-renderer');
    const renderers = [...document.querySelectorAll('ytd-shorts ytd-reel-video-renderer')];
    const index = renderers.indexOf(renderer);
    const next = index >= 0 ? renderers[index + 1] : null;
    if (!next) return false;
    next.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    return true;
  }

  function nextVideo(video) {
    if (video.platform === 'youtube') return nextShort(video);
    const current = getCurrentVideo();
    if (current?.platform !== 'instagram' || current.videoId !== video.videoId) return false;
    const button = [...document.querySelectorAll('button[aria-label="Next reel"], [role="button"][aria-label="Next reel"]')].find(node => {
      const rect = node.getBoundingClientRect();
      return !node.disabled && node.getAttribute('aria-disabled') !== 'true' &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    if (button) { button.click(); return true; }
    const videos = [...document.querySelectorAll('video')];
    const index = videos.indexOf(video.media);
    const next = index >= 0 ? videos[index + 1] : null;
    if (!next) return false;
    next.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    return true;
  }

  function showReminder(name, video, { autoSkip = false } = {}) {
    clearTimeout(skipToastTimer);
    const details = metadata(video);
    const entry = { title: details.title || details.caption.split('\n')[0].slice(0, 160) || 'Untitled video', category: name };
    reminderHistory.push(entry);
    if (reminderHistory.length > 50) reminderHistory.shift();
    const reminder = { entry, video, autoSkipped: autoSkip, skipFailed: false };
    activeReminder = reminder;
    // Protect the skip notification from navigation events fired synchronously by click().
    if (autoSkip) {
      try { reminder.autoSkipped = nextVideo(video); }
      catch { reminder.autoSkipped = false; }
      reminder.skipFailed = !reminder.autoSkipped;
      entry.auto_skipped = reminder.autoSkipped;
    }
    saveReminders();
    renderReminders();
    if (reminder.autoSkipped) skipToastTimer = setTimeout(() => {
      if (activeReminder === reminder) removeReminder();
    }, 8000);
  }

  // Lucide Sprout and Sparkle paths, distributed under the ISC license in vendor/LUCIDE-LICENSE.
  function toggleIcon(className, paths, viewBox = '0 0 24 24') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className); svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const d of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  }

  function renderReminders() {
    // A newly arrived alert supersedes any pending exit animation immediately.
    clearTimeout(slideTimer); slideTimer = null; motionElement = null; historyElement = null;
    host?.remove(); host = null;
    if (!tracking && !reminderHistory.length) { railStyle?.remove(); railStyle = null; return; }
    // Only the history toggle changes page layout. Incoming alerts float independently.
    if (!railStyle) {
      railStyle = document.createElement('style');
      document.head.append(railStyle);
    }
    const railWidth = 'min(360px, 48vw)';
    const reservedWidth = alertsOpen ? railWidth : '0px';
    const pageCSS = `@font-face{font-family:'Prune Heading';src:url("${chrome.runtime.getURL('fonts/bricolage-grotesque-700.ttf')}") format('truetype');font-weight:700;font-style:normal;font-display:swap}ytd-app,body > div[id^="mount_"]{width:calc(100% - ${reservedWidth})!important;min-width:0!important;transition:width 320ms cubic-bezier(.22,1,.36,1)!important}ytd-shorts{max-width:100%!important}@media(prefers-reduced-motion:reduce){ytd-app,body > div[id^="mount_"]{transition:none!important}}`;
    if (railStyle.textContent !== pageCSS) railStyle.textContent = pageCSS;
    if (!reminderHistory.length) return;
    host = document.createElement('div');
    host.style.cssText = `position:fixed;right:12px;bottom:20px;z-index:2147483647;width:calc(${railWidth} - 24px);pointer-events:none`;
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial}
      *{box-sizing:border-box}
      .stack{display:flex;flex-direction:column;gap:10px;max-height:calc(100dvh - 100px);font:14px/1.5 system-ui,sans-serif;color:#1f3a2e}
      .history,aside.arriving{animation:slideIn 320ms cubic-bezier(.22,1,.36,1) both}
      .leaving{animation:slideOut 260ms cubic-bezier(.4,0,1,1) both!important;pointer-events:none}
      @keyframes slideIn{from{transform:translateX(12px) translateY(8px);opacity:0}to{transform:translateX(0) translateY(0);opacity:1}}
      @keyframes slideOut{from{transform:translateX(0) translateY(0);opacity:1}to{transform:translateX(12px) translateY(8px);opacity:0}}
      @media(prefers-reduced-motion:reduce){.history,aside.arriving,.leaving{animation:none!important}}
      .stack[hidden]{display:none}
      .history{overflow-y:auto;min-height:0;max-height:210px;pointer-events:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#528344 #e5ecdc;mask-image:linear-gradient(to bottom,transparent,#000 56px);padding:20px 0 3px}
      .history::-webkit-scrollbar{width:7px}.history::-webkit-scrollbar-track{background:#e5ecdc;border-radius:8px}.history::-webkit-scrollbar-thumb{background:#528344;border-radius:8px}.history::-webkit-scrollbar-thumb:hover{background:#35573c}
      ol{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
      li,aside{background:#f5f8ee;border:1px solid #a8c394;border-radius:14px;box-shadow:0 6px 24px #0002}
      li{padding:10px 14px;flex-shrink:0}
      .title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;font-weight:600;overflow-wrap:anywhere}
      .category{display:block;font-size:12px;color:#526b46;margin-top:3px;overflow-wrap:anywhere}
      aside{padding:14px 34px 14px 16px;position:relative;pointer-events:auto;flex-shrink:0}
      strong{display:block;font-size:14px}p{margin:6px 0 0;overflow-wrap:anywhere}
      button{border:0;color:#1f3a2e;cursor:pointer}
      button:focus-visible{outline:2px solid #35573c;outline-offset:3px}
      .dismiss{position:absolute;top:5px;right:6px;background:transparent;font:22px system-ui}
      .next{display:block;margin-top:12px;padding:8px 14px;border-radius:8px;background:#35573c;color:#fff;font:600 14px system-ui}
      .next:hover{background:#26452d}
      .toggle{display:flex;position:relative;flex-direction:column;align-items:center;justify-content:center;gap:0;pointer-events:auto;margin:10px 0 0 auto;width:84px;height:84px;padding:14px;border:0;background:transparent;color:#f3f8e9;isolation:isolate;filter:drop-shadow(0 4px 8px #0002);transition:transform 180ms ease,filter 180ms ease}
      .toggle:hover{transform:translateY(-2px);filter:drop-shadow(0 6px 10px #0003)}
      .toggle:active{transform:scale(.96)}
      .toggle[aria-expanded=true] .clover{fill:#294f3c}
      .toggle:focus-visible{outline:3px solid #9bbb77;outline-offset:3px;border-radius:24px}
      .clover{position:absolute;inset:0;width:100%;height:100%;fill:#1f3a2e;z-index:-1}
      .sprout{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .alert-count{font:700 24px/1 'Prune Heading','Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-1px;font-variant-numeric:tabular-nums}
      .sparkle{position:absolute;right:4px;top:5px;width:18px;height:18px;fill:#e6d58d;stroke:#1f3a2e;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
      @media(prefers-reduced-motion:reduce){.toggle{transition:none}.toggle:hover,.toggle:active{transform:none}}
    `;
    const stack = document.createElement('section'); stack.className = 'stack'; stack.setAttribute('aria-label', 'Recent prune alerts');
    stack.id = 'prune-alert-stack'; stack.hidden = !alertsOpen && !activeReminder;
    motionElement = stack;
    alertToggle = document.createElement('button'); alertToggle.type = 'button'; alertToggle.className = 'toggle';
    const clover = toggleIcon('clover', ['M42 18C22-8-8 22 18 42C-8 62 22 92 42 66C62 92 92 62 66 42C92 22 62-8 42 18Z'], '0 0 84 84');
    const sprout = toggleIcon('sprout', [
      'M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3',
      'M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4', 'M5 21h14',
    ]);
    const count = document.createElement('span'); count.className = 'alert-count'; count.textContent = String(reminderHistory.length);
    const sparkle = toggleIcon('sparkle', ['M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z']);
    alertToggle.append(clover, sprout, count, sparkle);
    alertToggle.setAttribute('aria-label', `${alertsOpen ? 'Close' : 'Open'} prune alerts (${reminderHistory.length})`);
    alertToggle.setAttribute('aria-expanded', String(alertsOpen)); alertToggle.setAttribute('aria-controls', stack.id);
    alertToggle.title = 'Prune alerts';
    alertToggle.addEventListener('click', () => toggleReminders(!alertsOpen));
    stack.addEventListener('keydown', event => {
      if (event.key === 'Escape' && alertsOpen) toggleReminders(false);
    });
    const focusToggle = () => { if (restoreToggleFocus) { restoreToggleFocus = false; alertToggle.focus(); } };
    if (!alertsOpen && !activeReminder) {
      shadow.append(style, stack, alertToggle); document.documentElement.append(host); focusToggle(); return;
    }
    // Keep only the newest batch mounted until the user scrolls toward older alerts.
    const older = reminderHistory.filter(entry => entry !== activeReminder?.entry);
    if (alertsOpen && older.length) {
      const history = document.createElement('div'); history.className = 'history'; history.tabIndex = 0;
      historyElement = history;
      history.setAttribute('role', 'region'); history.setAttribute('aria-label', 'Earlier alerts. Scroll up for more.');
      const list = document.createElement('ol');
      let loaded = 0;
      const loadOlder = () => {
        const previousHeight = history.scrollHeight;
        const previousTop = history.scrollTop;
        const batch = older.slice(Math.max(0, older.length - loaded - HISTORY_BATCH), older.length - loaded);
        const rows = batch.map(entry => {
          const row = document.createElement('li');
          const title = document.createElement('span'); title.className = 'title'; title.textContent = entry.title; title.title = entry.title;
          const category = document.createElement('span'); category.className = 'category'; category.textContent = entry.category;
          row.append(title, category); return row;
        });
        list.prepend(...rows); loaded += batch.length;
        history.scrollTop = previousTop + history.scrollHeight - previousHeight;
      };
      history.append(list); stack.append(history);
      history.addEventListener('scroll', () => { if (history.scrollTop <= 12 && loaded < older.length) loadOlder(); });
      // Short cards may not overflow yet; upward input must still reveal the next batch.
      history.addEventListener('wheel', event => {
        if (event.deltaY < 0 && history.scrollTop <= 12 && loaded < older.length) loadOlder();
      }, { passive: true });
      history.addEventListener('keydown', event => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) && history.scrollTop <= 12 && loaded < older.length) {
          event.preventDefault(); loadOlder();
        }
      });
      // Measure only after mounting so inserting older rows preserves the scroll position.
      shadow.append(style, stack, alertToggle); document.documentElement.append(host);
      loadOlder(); history.scrollTop = history.scrollHeight;
    } else {
      shadow.append(style, stack, alertToggle); document.documentElement.append(host);
    }
    focusToggle();
    if (!activeReminder) return;
    const { entry, video, autoSkipped, skipFailed } = activeReminder;
    const box = document.createElement('aside'); box.setAttribute('role', 'status');
    if (lastRenderedEntry !== entry) box.className = 'arriving';
    lastRenderedEntry = entry;
    const heading = document.createElement('strong'); heading.textContent = autoSkipped ? 'Video automatically skipped' : "A topic you've pruned";
    const text = document.createElement('p'); text.textContent = autoSkipped ?
      `Skipped a video about ${entry.category}, a topic you've pruned.` : skipFailed ?
      `This video may relate to ${entry.category}. Automatic skipping couldn't find the next video. You can scroll to continue.` :
      `This video may relate to ${entry.category}, a topic you previously removed from your tree.`;
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'dismiss'; dismiss.textContent = '\u00d7';
    dismiss.setAttribute('aria-label', 'Dismiss topic reminder'); dismiss.addEventListener('click', removeReminder);
    box.append(heading, text, dismiss);
    if (!autoSkipped) {
      const next = document.createElement('button'); next.type = 'button'; next.className = 'next'; next.textContent = 'Next video';
      next.addEventListener('click', () => {
        if (nextVideo(video)) removeReminder();
        else text.textContent = "The next video isn't available yet. Scroll down in the Shorts feed to continue.";
      });
      box.append(next);
    }
    stack.append(box);
  }

  const lifecycle = new PruneDetection.Lifecycle({
    read,
    cancel() {
      clearTimeout(retryTimer); retryTimer = null;
      if (requestId) void send({ type: 'DETECTION_CANCEL', request_id: requestId });
      requestId = null;
      cancelReminderForNavigation();
    },
    async analyze(video, generation) {
      const id = crypto.randomUUID(); requestId = id;
      const capturedVersion = version;
      const started = performance.now();
      const state = await chrome.storage.local.get(['localReelEvidence', 'localSessionId']).catch(() => ({}));
      if (!lifecycle.current(generation, video.key) || requestId !== id) return;
      const reminderKey = `${state.localSessionId || sessionId}:${video.platform}:${video.videoId}`;
      if (notified.has(reminderKey)) { lifecycle.complete(generation, video.key); return; }
      const storage = chrome.storage.session || chrome.storage.local;
      const { detectionNotified = {} } = await storage.get('detectionNotified').catch(() => ({}));
      if (!lifecycle.current(generation, video.key) || requestId !== id) return;
      if (detectionNotified[reminderKey]) { notified.add(reminderKey); lifecycle.complete(generation, video.key); return; }
      const comments = video.platform === 'instagram' ? [...new Set((state.localReelEvidence?.[video.videoId]?.comments || []).filter(text => typeof text === 'string' && text.trim()))].slice(0, 10).map(text => text.slice(0, 300)) : [];
      const evidenceMs = Math.round(performance.now() - started);
      const response = await send({ type: 'DETECTION_CHECK', evidence: {
        platform: video.platform, video_id: video.videoId, request_id: id,
        blacklist_version: capturedVersion, ...metadata(video), comments,
      } });
      if (!lifecycle.current(generation, video.key) || requestId !== id || version !== capturedVersion) return;
      const latest = await chrome.storage.local.get(['detectionBlacklistVersion', 'detectionPreferencesPending', 'detectionDelaySeconds', 'detectionAutoSkip', 'trackingPaused', 'localSessionId']).catch(() => ({}));
      if (!lifecycle.current(generation, video.key) || requestId !== id || latest.trackingPaused !== false || latest.localSessionId !== state.localSessionId || latest.detectionPreferencesPending || latest.detectionBlacklistVersion !== capturedVersion || PruneDetection.delay(latest.detectionDelaySeconds) !== lifecycle.delay) return;
      lifecycle.complete(generation, video.key); requestId = null;
      const result = response?.data;
      console.debug('Prune detection', { outcome: result?.status || 'unavailable', evidence_ms: evidenceMs, total_ms: Math.round(performance.now() - started) });
      if (result?.blacklist_version && result.blacklist_version !== version) { void refresh(); return; }
      if (!response?.success || result?.status === 'UNCERTAIN') {
        if (uncertainKey !== video.key) { uncertainKey = video.key; retryCount = 0; }
        if (retryCount++ < 1) retryTimer = setTimeout(() => {
          if (lifecycle.current(generation, video.key)) { lifecycle.invalidate(); lifecycle.reconcile(); }
        }, 15000);
      }
      if (!response?.success || result?.status !== 'MATCH' || !result.notify || result.request_id !== id || result.video_id !== video.videoId || result.platform !== video.platform || result.blacklist_version !== capturedVersion || typeof result.matched_topic_name !== 'string') return;
      notified.add(reminderKey);
      // Store only reminder identity/time; no collected text.
      const recent = Object.entries(detectionNotified).filter(([, time]) => time > Date.now() - 86400000).slice(-499);
      void storage.set({ detectionNotified: { ...Object.fromEntries(recent), [reminderKey]: Date.now() } });
      showReminder(result.matched_topic_name, video, { autoSkip: latest.detectionAutoSkip === true });
    },
  });

  async function refresh() {
    if (refreshing || stopped) return refreshing;
    refreshing = (async () => {
      const result = await send({ type: 'DETECTION_STATE' });
      if (!result?.success) { available = false; lifecycle.invalidate(); return; }
      version = result.data.blacklist_version;
      available = result.data.configured && result.data.topic_count > 0;
      lifecycle.reconcile();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  const reconcile = () => {
    if (stopped) return;
    // Invalidate synchronously; reconcile again after layout/SPA updates settle.
    lifecycle.reconcile();
    if (frame === null) frame = requestAnimationFrame(() => { frame = null; lifecycle.reconcile(); });
  };
  for (const event of ['scroll', 'resize', 'popstate', 'yt-navigate-start', 'yt-navigate-finish']) {
    window.addEventListener(event, reconcile, { passive: true, capture: true });
  }
  for (const event of ['pause', 'waiting', 'stalled', 'ended', 'seeking', 'emptied']) {
    document.addEventListener(event, event => {
      if (event.target === getActiveInstagramVideo()) lifecycle.invalidate();
      reconcile();
    }, true);
  }
  for (const event of ['play', 'playing', 'loadeddata', 'seeked', 'visibilitychange']) {
    document.addEventListener(event, () => { reconcile(); if (!document.hidden && !available) void refresh(); }, true);
  }
  window.addEventListener('focus', () => { void refresh(); reconcile(); });
  window.addEventListener('pagehide', () => { stopped = true; lifecycle.invalidate(); cancelAnimationFrame(frame); clearTimeout(pendingRecoveryTimer); observer.disconnect(); });
  window.addEventListener('pageshow', () => { stopped = false; observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['video-id', 'is-active'] }); void refresh(); });
  const observer = new MutationObserver(reconcile);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['video-id', 'is-active'] });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.trackingPaused) { tracking = changes.trackingPaused.newValue === false; lifecycle.invalidate(); if (!tracking) removeReminder(); renderReminders(); if (tracking) void refresh(); }
    if (changes.localSessionId) { updateReminderSession(changes.localSessionId.newValue); lifecycle.invalidate(); }
    if (changes.detectionPreferencesPending) { pending = changes.detectionPreferencesPending.newValue === true; lifecycle.invalidate(); if (!pending) void refresh(); }
    if (changes.detectionPreferencesPending || changes.detectionPreferencesPendingUntil) {
      void chrome.storage.local.get('detectionPreferencesPendingUntil').then(state => recoverPending(state.detectionPreferencesPendingUntil));
    }
    if (changes.detectionMutation || changes.detectionBlacklistVersion) {
      lifecycle.invalidate();
      if (changes.detectionBlacklistVersion) version = changes.detectionBlacklistVersion.newValue;
      if (!pending) void refresh();
    }
    if (changes.detectionDelaySeconds) lifecycle.configure(changes.detectionDelaySeconds.newValue);
    if (changes.localReelEvidence && uncertainKey === lifecycle.key && lifecycle.state === 'COMPLETED' && retryCount <= 1) {
      retryCount++; lifecycle.invalidate();
    }
    reconcile();
  });
  chrome.storage.local.get(['trackingPaused', 'detectionDelaySeconds', 'detectionPreferencesPending', 'detectionPreferencesPendingUntil', 'localSessionId', 'lastCompletedLocalSessionId']).then(state => {
    tracking = state.trackingPaused === false; pending = state.detectionPreferencesPending === true;
    restoreReminders(state.localSessionId || state.lastCompletedLocalSessionId);
    recoverPending(state.detectionPreferencesPendingUntil);
    lifecycle.configure(state.detectionDelaySeconds); return refresh();
  }).catch(() => {});
})();
