/* Shared timing policy; kept independent of recording and audio state. */
(function (root) {
  const delay = value => typeof value === 'number' && Number.isFinite(value) && value >= 1.5 && value <= 10 && Number.isInteger(value * 2) ? value : 1.5;
  class Lifecycle {
    constructor({ read, analyze, cancel, clock = globalThis }) {
      this.read = read; this.analyze = analyze; this.cancel = cancel; this.clock = clock;
      this.delay = 1.5; this.state = 'IDLE'; this.generation = 0; this.key = null; this.timer = null;
    }
    invalidate() {
      this.clock.clearTimeout(this.timer); this.timer = null;
      this.generation++; this.key = null; this.state = 'INVALIDATED'; this.cancel();
    }
    configure(value) { this.delay = delay(value); this.invalidate(); this.reconcile(); }
    reconcile() {
      const video = this.read();
      if (!video) {
        if (this.key !== null) this.invalidate();
        this.state = 'IDLE'; return;
      }
      if (this.key === video.key) return;
      this.invalidate(); this.key = video.key; this.state = 'WAITING';
      const generation = this.generation;
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        if (!this.current(generation, video.key)) { this.reconcile(); return; }
        this.state = 'ANALYZING';
        Promise.resolve(this.analyze(video, generation)).catch(() => this.complete(generation, video.key));
      }, this.delay * 1000);
    }
    current(generation, key) {
      return this.generation === generation && this.key === key && this.read()?.key === key;
    }
    complete(generation, key) {
      if (!this.current(generation, key)) return false;
      this.state = 'COMPLETED'; return true;
    }
  }
  root.PruneDetection = { delay, Lifecycle };
})(globalThis);
