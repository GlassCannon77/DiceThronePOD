// The host studio: mic check, go live, record, publish to the feed.
import {
  api,
  store,
  h,
  formatClock,
  formatBytes,
  formatDate,
  formatDuration,
  copyText,
  createDie,
  startLevelMeter,
  prefersReducedMotion,
} from './common.js';
import { Mp3Recorder } from './recorder.js';
import { recovery } from './recovery.js';

// 64 kbps mono MP3 is about 29 MB per hour, which fits the 50 MB upload
// limit on Supabase's free plan for shows up to roughly 1 hour 45 minutes.
const MP3_KBPS = 64;

const $ = (id) => document.getElementById(id);
const die = createDie($('mic-die'));
die.setFace(1);

const state = {
  hostKey: '',
  maxUploadMb: 50,
  feedUrl: '',
  ctx: null,
  mix: null,
  analyser: null,
  micStream: null,
  micSource: null,
  stopMeter: null,
  recorder: null,
  sessionId: null,
  room: null,
  running: false,
  ending: false,
  startedAt: 0,
  ticker: null,
  remote: new Map(),
  pending: null,
  episodes: [],
};

// ---------- Small UI helpers ----------

function notice(el, text, kind = '') {
  el.textContent = text || '';
  el.className = `notice ${kind}`.trim();
  el.hidden = !text;
}

const consoleError = () => $('console-error');
const publishMsg = () => $('publish-msg');

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  if (label) button.textContent = label;
}

function hostApi(path, options = {}) {
  return api(path, { ...options, hostKey: state.hostKey });
}

// ---------- Sign in ----------

async function signIn(key) {
  await api('/api/verify-host', { method: 'POST', hostKey: key });
  state.hostKey = key;
  store.set('dt.hostKey', key);
  $('signin').hidden = true;
  $('app').hidden = false;
  $('studio-nav').hidden = false;
  $('onair-name').value = store.get('dt.onAirName') || '';
  await Promise.all([loadHealth(), loadEpisodes(), showRecoverable()]);
}

$('signin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = $('password').value;
  if (!key) return;
  busy($('signin-btn'), true, 'Checking…');
  try {
    await signIn(key);
  } catch (err) {
    notice($('signin-error'), err.message, 'error');
  } finally {
    busy($('signin-btn'), false, 'Sign in');
  }
});

$('signout-btn').addEventListener('click', () => {
  if (state.running) {
    notice(consoleError(), 'End the show before signing out.', 'error');
    return;
  }
  store.remove('dt.hostKey');
  location.reload();
});

// ---------- Setup checklist ----------

async function loadHealth() {
  try {
    const data = await hostApi('/api/health');
    state.maxUploadMb = data.maxUploadMb;
    state.feedUrl = data.feedUrl;
    $('feed-url').value = data.feedUrl;
    $('file-note').textContent = `MP3 or M4A recorded somewhere else, up to ${data.maxUploadMb} MB.`;

    $('checklist').replaceChildren(
      ...data.checks.map((check) =>
        h(
          'li',
          { class: check.ok ? 'ok' : '' },
          h('span', { class: 'mark', 'aria-hidden': 'true' }, check.ok ? '✓' : '✕'),
          h(
            'div',
            {},
            h('span', { class: 'visually-hidden' }, check.ok ? 'Ready: ' : 'Needs setup: '),
            h('strong', {}, check.label, check.optional ? ' (optional)' : ''),
            check.ok ? null : h('small', {}, check.fix || 'Not set up yet.'),
          ),
        ),
      ),
    );
    $('setup-panel').hidden = data.checks.every((check) => check.ok);

    const live = data.checks.find((check) => check.id === 'live');
    const optLive = $('opt-live');
    optLive.disabled = !live?.ok;
    if (!live?.ok) optLive.checked = false;
  } catch (err) {
    notice(consoleError(), `Could not check your setup: ${err.message}`, 'error');
  }
}

$('copy-feed').addEventListener('click', async () => {
  const button = $('copy-feed');
  if (await copyText(state.feedUrl)) {
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = 'Copy'), 2000);
  } else {
    $('feed-url').select();
  }
});

// ---------- Microphone ----------

function micMessage(err) {
  if (!window.isSecureContext) return 'The microphone only works on a secure (https) address.';
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it in your browser’s site settings (the icon left of the address bar), then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Plug one in and try again.';
    case 'NotReadableError':
      return 'Another app is using the microphone. Close it and try again.';
    default:
      return `The microphone could not start (${(err && err.message) || 'unknown error'}).`;
  }
}

async function ensureContext() {
  if (!state.ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let ctx = new AudioCtx();
    // MP3 needs one of these sample rates.
    if (![32000, 44100, 48000].includes(ctx.sampleRate)) {
      await ctx.close();
      ctx = new AudioCtx({ sampleRate: 48000 });
    }
    state.ctx = ctx;
    state.mix = ctx.createGain();
    state.analyser = ctx.createAnalyser();
    state.analyser.fftSize = 1024;
  }
  if (state.ctx.state === 'suspended') await state.ctx.resume();
  return state.ctx;
}

async function getMic(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(micMessage(null));
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) return getMic('');
    throw new Error(micMessage(err));
  }
}

function stopMic() {
  state.micSource?.disconnect();
  state.micStream?.getTracks().forEach((track) => track.stop());
  state.micSource = null;
  state.micStream = null;
}

async function startMic(deviceId) {
  const ctx = await ensureContext();
  const stream = await getMic(deviceId);
  stopMic();
  state.micStream = stream;
  state.micSource = ctx.createMediaStreamSource(stream);
  state.micSource.connect(state.mix);
  state.micSource.connect(state.analyser);
  if (!state.stopMeter) state.stopMeter = startLevelMeter(state.analyser, (face) => die.setFace(face));
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    notice(consoleError(), 'Your microphone disconnected. Plug it back in and pick it from the list.', 'error');
  });
  await fillDevices();
  const micBtn = $('mic-btn');
  micBtn.textContent = 'Mic is on';
  micBtn.disabled = true;
}

async function fillDevices() {
  const select = $('mic-select');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const current = state.micStream?.getAudioTracks()[0]?.getSettings().deviceId || '';
  select.replaceChildren(
    ...devices.map((d, i) =>
      h('option', { value: d.deviceId, selected: d.deviceId === current }, d.label || `Microphone ${i + 1}`),
    ),
  );
  select.disabled = state.running || devices.length < 2;
  if (current) store.set('dt.micId', current);
}

$('mic-btn').addEventListener('click', async () => {
  notice(consoleError(), '');
  try {
    await startMic(store.get('dt.micId') || '');
  } catch (err) {
    notice(consoleError(), err.message, 'error');
  }
});

$('mic-select').addEventListener('change', async (event) => {
  notice(consoleError(), '');
  try {
    await startMic(event.target.value);
  } catch (err) {
    notice(consoleError(), err.message, 'error');
  }
});

navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (state.micStream) fillDevices().catch(() => {});
});

// ---------- Start and end the show ----------

$('show-btn').addEventListener('click', () => (state.running ? endShow() : startShow()));

async function startShow() {
  notice(consoleError(), '');
  const optLive = $('opt-live');
  const wantLive = optLive.checked && !optLive.disabled;
  const wantRec = $('opt-record').checked;
  if (!wantLive && !wantRec) {
    notice(consoleError(), 'Turn on at least one: broadcast live or record an episode.', 'error');
    return;
  }
  if (wantRec && state.pending) {
    notice(
      consoleError(),
      'Publish, download or discard the last recording first. It’s waiting in the Publish panel.',
      'error',
    );
    return;
  }

  const button = $('show-btn');
  busy(button, true, 'Starting…');
  let liveOk = false;
  try {
    if (!state.micStream) await startMic(store.get('dt.micId') || '');
    await state.ctx.resume();
    if (wantRec) await startRecording();
    if (wantLive) {
      try {
        await goLive();
        liveOk = true;
      } catch (err) {
        if (!wantRec) throw err;
        notice(consoleError(), `${err.message} Recording continues without the live broadcast.`, 'error');
      }
    }
    state.running = true;
    state.startedAt = Date.now();
    state.ticker = setInterval(tick, 500);
    setRunningUi(true, { live: liveOk, rec: wantRec });
    tick();
  } catch (err) {
    await abortRecording();
    notice(consoleError(), err.message, 'error');
    button.textContent = 'Start show';
  } finally {
    button.disabled = false;
  }
}

async function startRecording() {
  const id = crypto.randomUUID ? crypto.randomUUID() : `rec-${Date.now()}`;
  state.sessionId = id;
  await recovery.begin({ id, startedAt: Date.now(), sampleRate: state.ctx.sampleRate });
  state.recorder = new Mp3Recorder(state.ctx, {
    kbps: MP3_KBPS,
    onChunk: (bytes, samples) => recovery.add(id, bytes, samples),
  });
  await state.recorder.start(state.mix);
}

async function abortRecording() {
  if (state.recorder) {
    await state.recorder.stop().catch(() => {});
    state.recorder = null;
  }
  if (state.sessionId) {
    await recovery.remove(state.sessionId);
    state.sessionId = null;
  }
}

async function goLive() {
  if (!window.LivekitClient) {
    throw new Error('The live audio library did not load. Check your connection and reload the page.');
  }
  const { Room, RoomEvent, Track, AudioPresets } = window.LivekitClient;
  const name = $('onair-name').value.trim().slice(0, 40) || 'Host';
  store.set('dt.onAirName', name);
  const { url, token } = await hostApi('/api/live-token', { method: 'POST', body: { role: 'host', name } });

  const room = new Room({ adaptiveStream: false, dynacast: false });
  room
    .on(RoomEvent.TrackSubscribed, onRemoteTrack)
    .on(RoomEvent.TrackUnsubscribed, onRemoteTrackGone)
    .on(RoomEvent.ParticipantConnected, tick)
    .on(RoomEvent.ParticipantDisconnected, tick)
    .on(RoomEvent.Reconnecting, () => setLivePill('Reconnecting…'))
    .on(RoomEvent.Reconnected, () => setLivePill('On air'))
    .on(RoomEvent.Disconnected, () => {
      if (state.room !== room || !state.running || state.ending) return;
      state.room = null;
      cleanupRemote();
      setLivePill(null);
      notice(
        consoleError(),
        state.recorder
          ? 'The live broadcast dropped. Your recording is still going.'
          : 'The live broadcast dropped. End the show and start again to go back on air.',
        'error',
      );
    });

  try {
    await room.connect(url, token);
    await room.localParticipant.publishTrack(state.micStream.getAudioTracks()[0], {
      source: Track.Source.Microphone,
      audioPreset: AudioPresets.musicHighQuality,
      dtx: false,
      red: true,
    });
  } catch (err) {
    await room.disconnect(false).catch(() => {});
    throw new Error(`Could not go live: ${err.message}`);
  }
  state.room = room;
  room.startAudio().catch(() => {});
}

// Co-hosts who join live: you hear them, and they're mixed into your recording.
function onRemoteTrack(track, publication, participant) {
  if (track.kind !== 'audio') return;
  $('remote-audio').append(track.attach());
  let source = null;
  if (state.recorder && participant.identity.startsWith('host-')) {
    try {
      source = state.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      source.connect(state.mix);
    } catch {
      source = null;
    }
  }
  state.remote.set(track.sid, { source });
  tick();
}

function onRemoteTrackGone(track) {
  track.detach().forEach((el) => el.remove());
  state.remote.get(track.sid)?.source?.disconnect();
  state.remote.delete(track.sid);
  tick();
}

function cleanupRemote() {
  state.remote.forEach(({ source }) => source?.disconnect());
  state.remote.clear();
  $('remote-audio').replaceChildren();
}

// Browsers only play co-host audio after a click on the page.
document.addEventListener('click', () => {
  if (state.room && !state.room.canPlaybackAudio) state.room.startAudio().catch(() => {});
});

async function endShow() {
  if (!state.running || state.ending) return;
  state.ending = true;
  const button = $('show-btn');
  busy(button, true, 'Ending…');
  clearInterval(state.ticker);

  if (state.room) {
    const room = state.room;
    state.room = null;
    await room.disconnect(false).catch(() => {});
  }
  cleanupRemote();

  const sessionId = state.sessionId;
  let result = null;
  if (state.recorder) {
    try {
      result = await state.recorder.stop();
    } catch (err) {
      notice(
        consoleError(),
        `${err.message} Your audio was saved as you went. Find it under Unsaved recordings.`,
        'error',
      );
    }
    state.recorder = null;
  }
  state.sessionId = null;
  state.running = false;
  state.ending = false;
  setRunningUi(false);
  button.disabled = false;

  if (result && result.blob.size) {
    openPublish({
      blob: result.blob,
      type: 'audio/mpeg',
      durationSeconds: result.durationSeconds,
      filename: recordingName(Date.now()),
      sessionId,
    });
  } else if (sessionId) {
    showRecoverable();
  }
}

function setRunningUi(running, flags = {}) {
  const button = $('show-btn');
  button.textContent = running ? 'End show' : 'Start show';
  button.classList.toggle('btn-ember', running);
  $('readout').hidden = !running;
  setLivePill(running && flags.live ? 'On air' : null);
  $('pill-rec').hidden = !(running && flags.rec);
  for (const id of ['opt-live', 'opt-record', 'onair-name']) {
    const input = $(id);
    if (running) input.dataset.wasDisabled = String(input.disabled);
    input.disabled = running || input.dataset.wasDisabled === 'true';
  }
  $('mic-select').disabled = running || $('mic-select').options.length < 2;
  if (!running) $('clock').textContent = '0:00';
}

function setLivePill(text) {
  const pill = $('pill-live');
  pill.hidden = !text;
  pill.textContent = text || '';
  pill.className = text === 'On air' ? 'pill pill-live' : 'pill pill-warn';
}

function tick() {
  if (!state.running) return;
  $('clock').textContent = formatClock((Date.now() - state.startedAt) / 1000);
  const notes = [];
  if (state.room) {
    const everyone = [...state.room.remoteParticipants.values()];
    const cohosts = everyone.filter((p) => p.identity.startsWith('host-'));
    const listeners = everyone.length - cohosts.length;
    notes.push(listeners === 1 ? '1 listening' : `${listeners} listening`);
    if (cohosts.length) notes.push(`with ${cohosts.map((p) => p.name || 'a co-host').join(', ')}`);
  }
  if (state.recorder) {
    notes.push(`${formatBytes(state.recorder.bytes)} recorded`);
    if (state.recorder.bytes > state.maxUploadMb * 1024 * 1024 * 0.9) {
      notes.push(`close to the ${state.maxUploadMb} MB upload limit`);
    }
  }
  $('readout-note').textContent = notes.join(', ');
}

window.addEventListener('beforeunload', (event) => {
  if (state.running || state.pending) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------- Publish ----------

function recordingName(time) {
  return `dice-throne-${new Date(time).toISOString().slice(0, 10)}.mp3`;
}

function nextEpisodeNumber() {
  const numbers = state.episodes.map((ep) => ep.episodeNumber).filter((n) => Number.isInteger(n));
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function openPublish(pending) {
  closePublish();
  pending.url = URL.createObjectURL(pending.blob);
  state.pending = pending;

  $('preview').src = pending.url;
  $('preview-meta').textContent = `${formatDuration(pending.durationSeconds)} long, ${formatBytes(pending.blob.size)}`;
  $('ep-title').value = '';
  $('ep-desc').value = '';
  $('ep-explicit').checked = false;
  $('ep-number').value = String(nextEpisodeNumber());
  $('ep-season').value = state.episodes[0]?.seasonNumber ?? '';
  $('progress').hidden = true;

  const tooBig = pending.blob.size > state.maxUploadMb * 1024 * 1024;
  $('publish-btn').disabled = tooBig;
  notice(
    publishMsg(),
    tooBig
      ? `This file is ${formatBytes(pending.blob.size)}, over the ${state.maxUploadMb} MB upload limit. Download the MP3 to keep it, then see “Longer shows” in the README.`
      : '',
    tooBig ? 'error' : '',
  );

  const panel = $('publish-panel');
  panel.hidden = false;
  panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  $('ep-title').focus({ preventScroll: true });
}

function closePublish() {
  if (state.pending?.url) URL.revokeObjectURL(state.pending.url);
  state.pending = null;
  const preview = $('preview');
  preview.removeAttribute('src');
  preview.load();
  $('publish-panel').hidden = true;
}

function lockPublish(locked) {
  for (const el of $('publish-form').querySelectorAll('input, textarea, button')) {
    if (el.id !== 'download-btn') el.disabled = locked;
  }
}

function uploadFile(url, blob, type, onProgress) {
  return new Promise((resolve, reject) => {
    const ext = type === 'audio/mpeg' ? 'mp3' : 'm4a';
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', new Blob([blob], { type }), `episode.${ext}`);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    const keepSafe = 'Try again, or download the MP3 so you don’t lose it.';
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let reason = '';
      try {
        const data = JSON.parse(xhr.responseText);
        reason = data.message || data.error || '';
      } catch {
        /* not JSON */
      }
      reject(new Error(`Upload failed${reason ? `: ${reason}.` : ` (${xhr.status}).`} ${keepSafe}`));
    };
    xhr.onerror = () => reject(new Error(`Upload failed because the connection dropped. ${keepSafe}`));
    xhr.send(form);
  });
}

function setProgress(fraction) {
  const bar = $('progress');
  bar.hidden = false;
  bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
}

$('publish-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pending = state.pending;
  if (!pending) return;
  const title = $('ep-title').value.trim();
  if (!title) {
    notice(publishMsg(), 'Give the episode a title.', 'error');
    $('ep-title').focus();
    return;
  }

  lockPublish(true);
  $('publish-btn').textContent = 'Publishing…';
  try {
    notice(publishMsg(), 'Uploading audio…');
    setProgress(0);
    const { uploadUrl, path } = await hostApi('/api/upload-url', {
      method: 'POST',
      body: { title, contentType: pending.type, size: pending.blob.size },
    });
    await uploadFile(uploadUrl, pending.blob, pending.type, setProgress);

    notice(publishMsg(), 'Adding it to your feed…');
    await hostApi('/api/episodes', {
      method: 'POST',
      body: {
        path,
        title,
        description: $('ep-desc').value,
        durationSeconds: Math.round(pending.durationSeconds),
        episodeNumber: $('ep-number').value,
        seasonNumber: $('ep-season').value,
        explicit: $('ep-explicit').checked,
      },
    });

    if (pending.sessionId) await recovery.remove(pending.sessionId);
    closePublish();
    await loadEpisodes();
    notice(
      $('library-msg'),
      `Published “${title}”. It’s in your feed now, and Spotify usually shows it within a few hours.`,
      'success',
    );
    $('library-msg').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    showRecoverable();
  } catch (err) {
    notice(publishMsg(), err.message, 'error');
  } finally {
    lockPublish(false);
    $('publish-btn').textContent = 'Publish episode';
    if (state.pending) $('publish-btn').disabled = state.pending.blob.size > state.maxUploadMb * 1024 * 1024;
  }
});

$('download-btn').addEventListener('click', () => {
  const pending = state.pending;
  if (!pending) return;
  const link = h('a', { href: pending.url, download: pending.filename });
  document.body.append(link);
  link.click();
  link.remove();
});

$('discard-btn').addEventListener('click', async () => {
  const pending = state.pending;
  if (!pending) return;
  if (!confirm('Discard this recording? It can’t be recovered afterward.')) return;
  if (pending.sessionId) await recovery.remove(pending.sessionId);
  closePublish();
  showRecoverable();
});

// ---------- Publish a file recorded elsewhere ----------

function audioType(file) {
  const name = file.name.toLowerCase();
  if (file.type === 'audio/mpeg' || name.endsWith('.mp3')) return 'audio/mpeg';
  if (['audio/mp4', 'audio/x-m4a', 'audio/m4a'].includes(file.type) || name.endsWith('.m4a')) return 'audio/mp4';
  return '';
}

function readDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const finish = (seconds) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) ? seconds : 0);
    };
    const timer = setTimeout(() => finish(0), 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(audio.duration);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      finish(0);
    };
    audio.src = url;
  });
}

$('file-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const type = audioType(file);
  if (!type) {
    notice($('library-msg'), 'Pick an MP3 or M4A file.', 'error');
    return;
  }
  if (state.pending && !confirm('Replace the episode waiting in the Publish panel?')) return;
  notice($('library-msg'), '');
  const durationSeconds = await readDuration(file);
  openPublish({ blob: file, type, durationSeconds, filename: file.name, sessionId: null });
  showRecoverable();
});

// ---------- Unsaved recordings ----------

async function showRecoverable() {
  const sessions = (await recovery.list()).filter(
    (s) => s.id !== state.sessionId && s.id !== state.pending?.sessionId,
  );
  $('recover-panel').hidden = !sessions.length;
  $('recover-list').replaceChildren(
    ...sessions.map((s) =>
      h(
        'div',
        { class: 'recover-item' },
        h(
          'div',
          {},
          h('strong', {}, formatDate(s.startedAt, true)),
          h('small', {}, `${formatClock(s.samples / s.sampleRate)} long, ${formatBytes(s.bytes)}`),
        ),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => openRecovered(s.id) }, 'Open'),
          h(
            'button',
            { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => deleteRecovered(s.id) },
            'Delete',
          ),
        ),
      ),
    ),
  );
}

async function openRecovered(id) {
  if (state.pending && !confirm('Replace the episode waiting in the Publish panel?')) return;
  try {
    const saved = await recovery.load(id);
    openPublish({
      blob: saved.blob,
      type: 'audio/mpeg',
      durationSeconds: saved.durationSeconds,
      filename: recordingName(saved.startedAt),
      sessionId: id,
    });
  } catch (err) {
    notice(consoleError(), err.message, 'error');
  }
  showRecoverable();
}

async function deleteRecovered(id) {
  if (!confirm('Delete this recording for good?')) return;
  await recovery.remove(id);
  showRecoverable();
}

// ---------- Published episodes ----------

async function loadEpisodes() {
  try {
    const data = await api('/api/episodes');
    state.episodes = data.episodes || [];
    renderLibrary();
  } catch (err) {
    $('library').replaceChildren(h('li', {}, h('small', {}, `Episodes could not load: ${err.message}`)));
  }
}

function renderLibrary() {
  const episodes = state.episodes;
  $('feed-note').textContent = episodes.length
    ? `${episodes.length} ${episodes.length === 1 ? 'episode is' : 'episodes are'} in your feed.`
    : 'Spotify needs at least one published episode before you submit the feed.';
  if (!episodes.length) {
    $('library').replaceChildren(
      h('li', {}, h('small', {}, 'No episodes yet. Record a show or pick a file below to publish your first one.')),
    );
    return;
  }
  $('library').replaceChildren(
    ...episodes.map((ep) =>
      h(
        'li',
        {},
        h(
          'div',
          {},
          h('strong', {}, ep.episodeNumber != null ? `${ep.episodeNumber}. ${ep.title}` : ep.title),
          h('small', {}, `${formatDate(ep.publishedAt)}, ${formatDuration(ep.durationSeconds)}`),
        ),
        h(
          'button',
          {
            class: 'btn btn-quiet btn-small',
            type: 'button',
            'aria-label': `Remove ${ep.title}`,
            onclick: () => removeEpisode(ep),
          },
          'Remove',
        ),
      ),
    ),
  );
}

async function removeEpisode(ep) {
  if (!confirm(`Remove “${ep.title}” from your feed? Its audio file is deleted too.`)) return;
  try {
    await hostApi(`/api/episodes?id=${encodeURIComponent(ep.id)}`, { method: 'DELETE' });
    notice($('library-msg'), `Removed “${ep.title}”.`, 'success');
    await loadEpisodes();
  } catch (err) {
    notice($('library-msg'), err.message, 'error');
  }
}

// ---------- Start ----------

const savedKey = store.get('dt.hostKey');
if (savedKey) {
  $('signin').hidden = true;
  signIn(savedKey).catch(() => {
    store.remove('dt.hostKey');
    $('signin').hidden = false;
  });
}
