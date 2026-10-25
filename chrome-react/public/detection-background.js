/* Runs in the extension service worker. No session ingestion queue is used. */
const detectionRequests = new Map();
const detectionStorage = chrome.storage.session || chrome.storage.local;
let detectionCacheQueue = Promise.resolve();

function cancelDetection(tabId, requestId) {
  const active = detectionRequests.get(tabId);
  if (active && (!requestId || active.id === requestId)) {
    active.controller.abort(); detectionRequests.delete(tabId);
  }
}

async function detectionState(signal) {
  const before = await chrome.storage.local.get(['detectionPreferencesPending', 'detectionPreferencesPendingUntil', 'detectionMutation']);
  if (before.detectionPreferencesPending) {
    if ((before.detectionPreferencesPendingUntil || 0) > Date.now()) throw new Error('Preferences are being updated.');
    // A closed settings/review page may never have run its finally block.
    await chrome.storage.local.set({ detectionPreferencesPending: false });
  }
  const state = await apiRequest('/detection/state', signal ? { signal } : {});
  const after = await chrome.storage.local.get(['detectionPreferencesPending', 'detectionMutation']);
  if (after.detectionPreferencesPending || before.detectionMutation !== after.detectionMutation) throw new Error('Preferences changed.');
  await chrome.storage.local.set({ detectionBlacklistVersion: state.blacklist_version });
  return state;
}

function updateDetectionCache(key, result) {
  detectionCacheQueue = detectionCacheQueue.catch(() => {}).then(async () => {
    const { detectionCache = {} } = await detectionStorage.get('detectionCache');
    const now = Date.now();
    const live = Object.entries(detectionCache).filter(([, entry]) => entry.expires > now).slice(-199);
    const ttl = result.status === 'UNCERTAIN' ? 15000 : 30 * 60 * 1000;
    await detectionStorage.set({ detectionCache: { ...Object.fromEntries(live), [key]: { result, expires: now + ttl } } });
  });
  return detectionCacheQueue;
}

async function runDetection(message, sender, active) {
  const signal = active.controller.signal;
  const current = () => !signal.aborted && detectionRequests.get(sender.tab.id) === active;
  const state = await detectionState(signal);
  if (!current() || state.blacklist_version !== message.evidence.blacklist_version) throw new Error('Stale detection.');
  if (!state.topic_count || !state.configured) return { ...state, status: 'UNCERTAIN', notify: false };
  const evidence = message.evidence;
  const key = JSON.stringify([evidence.platform, evidence.video_id, state.blacklist_version]);
  const { detectionCache = {} } = await detectionStorage.get('detectionCache');
  const cached = detectionCache[key];
  // More evidence can change uncertain results, even before their short TTL expires.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([evidence.title, evidence.caption, evidence.comments])));
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  let result;
  if (cached?.expires > Date.now() && (cached.result.status !== 'UNCERTAIN' || cached.result.evidence_signature === signature)) {
    result = { ...cached.result, request_id: evidence.request_id };
  } else {
    result = await apiRequest('/detection/check', { method: 'POST', body: JSON.stringify(evidence), signal });
    if (result.request_id !== evidence.request_id || result.video_id !== evidence.video_id || result.platform !== evidence.platform || result.blacklist_version !== state.blacklist_version) throw new Error('Stale detection response.');
    if (current()) await updateDetectionCache(key, { ...result, evidence_signature: signature });
  }
  const latest = await chrome.storage.local.get(['detectionBlacklistVersion', 'detectionPreferencesPending', 'trackingPaused']);
  if (!current() || latest.detectionPreferencesPending || latest.trackingPaused !== false || latest.detectionBlacklistVersion !== result.blacklist_version) throw new Error('Stale detection.');
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['DETECTION_CHECK', 'DETECTION_CANCEL', 'DETECTION_STATE', 'DETECTION_REFRESH'].includes(message?.type)) return false;
  if (message.type === 'DETECTION_CANCEL') {
    if (sender.tab) cancelDetection(sender.tab.id, message.request_id);
    sendResponse({ success: true }); return false;
  }
  if (message.type !== 'DETECTION_CHECK') {
    detectionState().then(data => sendResponse({ success: true, data })).catch(() => sendResponse({ success: false }));
    return true;
  }
  if (!sender.tab || sender.frameId !== 0 || !supportedCaptureTab(sender.tab) || !message.evidence?.request_id) {
    sendResponse({ success: false }); return false;
  }
  const previous = detectionRequests.get(sender.tab.id);
  if (previous?.id === message.evidence.request_id) {
    previous.promise.then(sendResponse); return true;
  }
  cancelDetection(sender.tab.id);
  const active = { id: message.evidence.request_id, controller: new AbortController() };
  detectionRequests.set(sender.tab.id, active);
  const timeout = setTimeout(() => active.controller.abort(), 10000);
  active.promise = runDetection(message, sender, active)
    .then(data => ({ success: true, data })).catch(() => ({ success: false }))
    .finally(() => {
      clearTimeout(timeout);
      if (detectionRequests.get(sender.tab.id) === active) detectionRequests.delete(sender.tab.id);
    });
  active.promise.then(sendResponse); return true;
});

chrome.tabs.onRemoved.addListener(tabId => cancelDetection(tabId));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.detectionBlacklistVersion || changes.detectionMutation || changes.detectionDelaySeconds || changes.trackingPaused) {
    for (const tabId of detectionRequests.keys()) cancelDetection(tabId);
  }
});
