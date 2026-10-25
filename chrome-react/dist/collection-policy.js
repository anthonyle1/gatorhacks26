/* Shared by the worker, content script, and settings UI. Zero means collect all. */
globalThis.PruneCollection = {
  seconds(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(10, Math.round(number))) : 0;
  },
  accepts(seconds, minimum) { return minimum <= 0 || Number(seconds) >= minimum; },
};
