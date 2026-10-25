class PrunePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.started = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length) {
      if (!this.offset) this.started = currentTime;
      for (let i = 0; i < channels[0].length; i++) {
        for (const channel of channels) this.buffer[this.offset] += channel[i] / channels.length;
        if (++this.offset === this.buffer.length) {
          this.port.postMessage({ pcm: this.buffer, time: this.started }, [this.buffer.buffer]);
          this.buffer = new Float32Array(2048);
          this.offset = 0;
          this.started = currentTime + (i + 1) / sampleRate;
        }
      }
    }
    return true;
  }
}
registerProcessor("prune-pcm", PrunePCM);
