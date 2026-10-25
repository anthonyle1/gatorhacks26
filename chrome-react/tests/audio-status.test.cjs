const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/audio-status.js'), 'utf8'), context);

test('enabled audio is visibly distinct from actual recording', () => {
  const display = context.describeAudioStatus({}, {}, true);
  assert.equal(display.label, 'NOT RECORDING');
  assert.match(display.transcript, /no speech is available for the prompt yet/);
});
test('connected capture with no verified timing is not presented as recording', () => {
  const display = context.describeAudioStatus({ recording: true, last_media_at: Date.now(), capture_reason: 'unverified_video' }, {}, true);
  assert.equal(display.label, 'CONNECTED — WAITING');
  assert.match(display.detail, /identity could not be verified/);
});
test('confirmed recording reports signal and actual backend transcript counts', () => {
  const display = context.describeAudioStatus({ recording: true, capturing: true, last_media_at: Date.now(), signal_level: .1, captured_seconds: 12 },
    { reachable: true, uploaded_segments: 2, usable_transcript_excerpts: 3, asr: { model: 'base.en', state: 'loaded' } }, true);
  assert.equal(display.label, 'RECORDING');
  assert.match(display.detail, /signal detected/);
  assert.match(display.counts, /Uploaded: 2/);
  assert.match(display.transcript, /3 usable transcript excerpts/);
  assert.match(display.model, /loaded/);
});
test('unusable speech and missing model dependencies are explicit', () => {
  const display = context.describeAudioStatus({}, { reachable: true, asr: { model: 'base.en', state: 'missing_dependencies' }, excluded_segments: { short_speech: 2 } }, true);
  assert.match(display.model, /dependencies missing/);
  assert.match(display.transcript, /2 short speech/);
});

test('missing toolbar invocation is presented as permission needed', () => {
  const display = context.describeAudioStatus({ recording: false, permission_required: true, detail: 'Click the Prune toolbar icon on the video tab.' }, {}, true);
  assert.equal(display.label, 'PERMISSION NEEDED');
  assert.match(display.detail, /toolbar/);
});
