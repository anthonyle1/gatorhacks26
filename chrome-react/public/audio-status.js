/* Shared presentation for the side panel and React review. Enabled is a preference,
   recording is a tab stream, and capturing means verified video audio is sampled. */
function describeAudioStatus(capture = {}, backend = {}, enabled = true) {
  const stale = !capture.last_media_at || Date.now() - capture.last_media_at > 3000;
  let label = 'NOT RECORDING', tone = 'inactive';
  let detail = 'Select your YouTube/Instagram video tab and click the Prune icon in Chrome\'s toolbar, then start tracking.';
  if (!enabled) detail = 'Tab audio is disabled. Enable it to include speech in assessments.';
  else if (capture.recording) {
    label = 'CONNECTED — WAITING'; tone = 'waiting';
    if (stale) detail = 'Tab connected, but no video timing received. Refresh the selected video tab.';
    else if (capture.capture_reason === 'unverified_video') detail = 'Audio is not being sampled: the video identity could not be verified.';
    else if (capture.capture_reason === 'paused') detail = 'Video paused. Audio is not being sampled.';
    else if (capture.capture_reason === 'buffering') detail = 'Video buffering. Waiting for playable audio.';
    else if (capture.capturing) {
      label = 'RECORDING'; tone = 'recording';
      detail = capture.signal_level > .001 ? 'Audio signal detected for the current video.' : 'Sampling the video, but no audio signal detected. Check playback and mute controls.';
    } else detail = 'Waiting for verified video playback before sampling audio.';
  } else if (capture.detail) detail = capture.detail;
  if (!capture.recording && capture.permission_required) { label = 'PERMISSION NEEDED'; tone = 'waiting'; }
  if (backend.enabled === false) { label = 'AUDIO UNAVAILABLE'; tone = 'error'; detail = backend.disabled_reason || 'Backend audio is disabled; using metadata and comments.'; }
  const asr = backend.asr;
  const model = !backend.reachable ? 'ASR: backend status unavailable' : !asr ? 'ASR: restart the backend to load audio diagnostics' :
    `Whisper ${asr.model}: ${asr.state === 'loaded' ? 'loaded' : asr.state === 'installed' ? 'installed, ready to load' : asr.state === 'missing_dependencies' ? 'dependencies missing' : 'weights not downloaded'}`;
  const uploaded = backend.uploaded_segments || 0;
  const ready = backend.usable_transcript_excerpts || 0;
  const processing = (backend.processing_states?.queued || 0) + (backend.processing_states?.processing || 0);
  const exclusions = Object.entries(backend.excluded_segments || {}).map(([reason, count]) => `${count} ${reason.replaceAll('_', ' ')}`).join(', ');
  const counts = `Saved audio: ${(capture.captured_seconds || 0).toFixed(1)}s · Uploads pending: ${capture.pending || 0} · Uploaded: ${uploaded} · Processing: ${processing}`;
  const transcript = (backend.finalized ? `${backend.review_transcript_excerpts || 0} transcript excerpts in finalized review evidence${backend.late_transcript_excerpts ? `; ${backend.late_transcript_excerpts} arrived after the cutoff` : ''}` :
    `${ready} usable transcript excerpts${ready ? ' available for assessment at Finish' : ' — no speech is available for the prompt yet'}`) + `${exclusions ? `. Excluded: ${exclusions}` : ''}.`;
  return { label, tone, detail, model, counts, transcript };
}
globalThis.describeAudioStatus = describeAudioStatus;
