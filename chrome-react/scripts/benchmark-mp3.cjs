// Deterministic codec smoke benchmark; this measures no speech recognition quality.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../node_modules/@breezystack/lamejs/dist/lamejs.iife.js'), 'utf8'), sandbox);
const output = path.resolve(__dirname, '../../.cache/audio-benchmark');
fs.mkdirSync(output, { recursive: true });
const report = [];
for (const seconds of [3, 15, 30]) {
  const samples = new Int16Array(44100 * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i * 2 * Math.PI * 440 / 44100) * 10000);
  const elapsed = [];
  let mp3;
  for (let run = 0; run < 4; run++) {
    const started = performance.now();
    const encoder = new sandbox.lamejs.Mp3Encoder(1, 44100, 64);
    const packets = [];
    for (let i = 0; i < samples.length; i += 1152) packets.push(Buffer.from(encoder.encodeBuffer(samples.subarray(i, i + 1152))));
    packets.push(Buffer.from(encoder.flush()));
    mp3 = Buffer.concat(packets);
    elapsed.push(performance.now() - started);
  }
  fs.writeFileSync(path.join(output, `tone-${seconds}s.mp3`), mp3);
  const warm = elapsed.slice(1).sort((a, b) => a - b);
  report.push({ seconds, uploaded_bytes: mp3.length, cold_ms: elapsed[0], warm_median_ms: warm[1], warm_p95_ms: warm[2] });
}
const result = { node: process.version, platform: process.platform, sample_rate: 44100, channels: 1, bitrate_kbps: 64, fixtures: 'synthetic 440Hz tone', results: report };
fs.writeFileSync(path.join(output, 'encoder.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
