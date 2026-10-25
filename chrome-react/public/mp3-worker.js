/* LGPL encoder stays separately bundled so it can be replaced with a compatible build. */
importScripts("vendor/lamejs.js");
self.onmessage = event => {
  const { id, pcm } = event.data;
  try {
    const encoder = new lamejs.Mp3Encoder(1, 44100, 64);
    const parts = [];
    for (let i = 0; i < pcm.length; i += 1152) parts.push(new Int8Array(encoder.encodeBuffer(pcm.subarray(i, i + 1152))));
    parts.push(new Int8Array(encoder.flush()));
    self.postMessage({ id, parts }, parts.map(part => part.buffer));
  } catch {
    self.postMessage({ id, error: "MP3 encoding failed" });
  }
};
