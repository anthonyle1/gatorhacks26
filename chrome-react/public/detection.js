/* Page adapter for real-time reminders. Session collection owns none of this state. */
(() => {
  let tracking = false, pending = false, version = null, available = false, requestId = null;
  let host = null, hideTimer = null, frame = null, refreshing = null, stopped = false;
  let sessionId = null;
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
    clearTimeout(hideTimer); host?.remove(); host = null;
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

  function showReminder(name) {
    removeReminder();
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:20px;bottom:90px;z-index:2147483647;max-width:min(320px,calc(100vw - 40px));pointer-events:none';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}aside{font:14px/1.5 system-ui,sans-serif;background:#f5f8ee;color:#1f3a2e;border:1px solid #a8c394;border-radius:14px;padding:14px 34px 14px 16px;box-shadow:0 6px 24px #0002;position:relative}strong{display:block;font-size:14px}p{margin:6px 0 0}button{pointer-events:auto;position:absolute;top:5px;right:6px;border:0;background:transparent;color:#1f3a2e;font:22px system-ui;cursor:pointer}';
    const box = document.createElement('aside'); box.setAttribute('role', 'status');
    const heading = document.createElement('strong'); heading.textContent = '🌱 A topic you’ve pruned';
    const text = document.createElement('p'); text.textContent = `This video may relate to ${name}, a topic you previously removed from your tree.`;
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss topic reminder');
    dismiss.addEventListener('click', removeReminder);
    box.append(heading, text, dismiss); shadow.append(style, box); document.documentElement.append(host);
    hideTimer = setTimeout(removeReminder, 4000);
  }

  const lifecycle = new PruneDetection.Lifecycle({
    read,
    cancel() {
      clearTimeout(retryTimer); retryTimer = null;
      if (requestId) void send({ type: 'DETECTION_CANCEL', request_id: requestId });
      requestId = null; removeReminder();
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
      const latest = await chrome.storage.local.get(['detectionBlacklistVersion', 'detectionPreferencesPending', 'detectionDelaySeconds', 'trackingPaused', 'localSessionId']).catch(() => ({}));
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
      showReminder(result.matched_topic_name);
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
    if (changes.trackingPaused) { tracking = changes.trackingPaused.newValue === false; lifecycle.invalidate(); if (tracking) void refresh(); }
    if (changes.localSessionId) { sessionId = changes.localSessionId.newValue; notified.clear(); lifecycle.invalidate(); }
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
  chrome.storage.local.get(['trackingPaused', 'detectionDelaySeconds', 'detectionPreferencesPending', 'detectionPreferencesPendingUntil', 'localSessionId']).then(state => {
    tracking = state.trackingPaused === false; pending = state.detectionPreferencesPending === true; sessionId = state.localSessionId;
    recoverPending(state.detectionPreferencesPendingUntil);
    lifecycle.configure(state.detectionDelaySeconds); return refresh();
  }).catch(() => {});
})();
