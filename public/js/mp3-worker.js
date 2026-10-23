// Background worker that turns raw audio into MP3 while you record,
// so ending a long show doesn't freeze the page.
/* global lamejs */
self.importScripts('/vendor/lame.min.js');

const CHUNK_BYTES = 16 * 1024; // about 2 seconds of audio at 64 kbps

let encoder = null;
let samples = 0;
let parts = [];
let pending = 0;

function keep(int8) {
  if (!int8 || !int8.length) return;
  parts.push(new Uint8Array(int8.buffer, int8.byteOffset, int8.length));
  pending += int8.length;
}

function send(force) {
  if (!pending || (!force && pending < CHUNK_BYTES)) return;
  const out = new Uint8Array(pending);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  parts = [];
  pending = 0;
  self.postMessage({ type: 'chunk', data: out.buffer, samples }, [out.buffer]);
}

function toInt16(floats) {
  const out = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const s = floats[i] < -1 ? -1 : floats[i] > 1 ? 1 : floats[i];
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      encoder = new lamejs.Mp3Encoder(1, msg.sampleRate, msg.kbps);
      samples = 0;
      parts = [];
      pending = 0;
    } else if (msg.type === 'pcm') {
      samples += msg.samples.length;
      keep(encoder.encodeBuffer(toInt16(msg.samples)));
      send(false);
    } else if (msg.type === 'flush') {
      keep(encoder.flush());
      send(true);
      self.postMessage({ type: 'done', samples });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
