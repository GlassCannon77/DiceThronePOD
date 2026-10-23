// The public listener page: live show + episode list.
import {
  api,
  h,
  formatDate,
  formatDuration,
  copyText,
  createDie,
  startLevelMeter,
  prefersReducedMotion,
} from './common.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const die = createDie(stage.querySelector('.die'));
const tuneBtn = $('tune-btn');
const leaveBtn = $('leave-btn');
const unmuteBtn = $('unmute-btn');

let feedUrl = `${location.origin}/feed.xml`;
let room = null;
let audioCtx = null;
let analyser = null;
let stopMeter = null;
let pollTimer = null;
let lastStatus = { live: false, hosts: [], listeners: 0 };
const sources = new Map();

die.setFace(1);

// ---------- Episodes ----------

async function loadEpisodes() {
  try {
    const data = await api('/api/episodes');
    applyShow(data.show);
    renderEpisodes(data.episodes);
  } catch {
    showEmpty('Episodes could not load right now. Refresh the page to try again.');
  }
}

function applyShow(show) {
  if (!show) return;
  document.title = show.title;
  $('show-title').textContent = show.title;
  feedUrl = show.feedUrl || feedUrl;
  if (show.spotifyUrl) {
    for (const link of [$('spotify-link'), $('spotify-top')]) {
      link.href = show.spotifyUrl;
      link.hidden = false;
    }
  }
}

function showEmpty(message) {
  const empty = $('episodes-empty');
  empty.textContent = message;
  empty.hidden = false;
}

function renderEpisodes(episodes) {
  const list = $('episodes');
  list.replaceChildren();
  if (!episodes.length) {
    showEmpty('No episodes yet. The first one shows up here as soon as it’s published.');
    return;
  }
  const clamps = [];
  for (const ep of episodes) {
    const { item, desc, more } = episodeItem(ep);
    list.append(item);
    if (desc) clamps.push([desc, more]);
  }
  // Only show "Show more" when the description is actually cut off.
  requestAnimationFrame(() => {
    for (const [desc, more] of clamps) more.hidden = desc.scrollHeight <= desc.clientHeight + 2;
  });
  if (location.hash.startsWith('#episode-')) document.querySelector(location.hash)?.scrollIntoView();
}

function episodeItem(ep) {
  const hasNumber = ep.episodeNumber !== null && ep.episodeNumber !== undefined;
  let desc = null;
  let more = null;
  if (ep.description) {
    desc = h('p', { class: 'episode-desc' }, ep.description);
    more = h(
      'button',
      {
        class: 'more-btn',
        type: 'button',
        'aria-expanded': 'false',
        hidden: true,
        onclick() {
          const open = desc.classList.toggle('open');
          more.textContent = open ? 'Show less' : 'Show more';
          more.setAttribute('aria-expanded', String(open));
        },
      },
      'Show more',
    );
  }
  const item = h(
    'li',
    { class: 'episode', id: `episode-${ep.id}` },
    h('div', { class: 'episode-num', 'aria-hidden': 'true' }, hasNumber ? ep.episodeNumber : ''),
    h(
      'div',
      {},
      h('h3', {}, hasNumber ? h('span', { class: 'visually-hidden' }, `Episode ${ep.episodeNumber}: `) : null, ep.title),
      h(
        'p',
        { class: 'episode-meta' },
        h('span', {}, formatDate(ep.publishedAt)),
        h('span', {}, formatDuration(ep.durationSeconds)),
        ep.explicit ? h('span', {}, 'Explicit') : null,
      ),
      desc,
      more,
      h('audio', { controls: true, preload: 'none', src: ep.audioUrl }),
    ),
  );
  return { item, desc, more };
}

$('copy-feed').addEventListener('click', async () => {
  const msg = $('copy-msg');
  const ok = await copyText(feedUrl);
  msg.textContent = ok
    ? 'RSS link copied. Paste it into your podcast app’s “add by URL” option.'
    : `Copy this link into your podcast app: ${feedUrl}`;
  msg.hidden = false;
});

// ---------- Live show ----------

function hostsLine(hosts) {
  const names = [...new Set(hosts.filter((n) => n && n !== 'Host'))];
  if (!names.length) return 'The show is on the air';
  if (names.length === 1) return `${names[0]} is on the mic`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are on the mic`;
}

function listenerText(n) {
  if (n <= 0) return '';
  return n === 1 ? '1 listening' : `${n} listening`;
}

function setState(state, info = {}) {
  stage.dataset.state = state;
  const hosts = info.hosts || [];
  if (state === 'off') {
    $('status-text').textContent = 'Off air';
    $('stage-title').textContent = 'No live show right now';
    $('stage-copy').textContent = info.message || 'When the show goes live, this page lights up. Catch up on episodes below.';
    tuneBtn.hidden = true;
    leaveBtn.hidden = true;
    unmuteBtn.hidden = true;
    $('listener-count').textContent = '';
    die.setFace(1);
  } else if (state === 'live') {
    $('status-text').textContent = 'Live now';
    $('stage-title').textContent = hostsLine(hosts);
    $('stage-copy').textContent = 'Press Tune in to listen right here. No account or app needed.';
    tuneBtn.hidden = false;
    tuneBtn.disabled = false;
    tuneBtn.textContent = 'Tune in';
    leaveBtn.hidden = true;
    $('listener-count').textContent = listenerText(info.listeners);
    die.setFace(6);
  } else {
    $('status-text').textContent = 'Live now';
    $('stage-title').textContent = 'You’re listening live';
    $('stage-copy').textContent = hostsLine(hosts);
    tuneBtn.hidden = true;
    leaveBtn.hidden = false;
    if (prefersReducedMotion()) die.setFace(6);
  }
}

function announce(text) {
  $('live-announce').textContent = text;
}

function showError(text) {
  const box = $('live-error');
  box.textContent = text;
  box.hidden = !text;
}

async function pollStatus() {
  if (room) return;
  try {
    const status = await api('/api/live-status');
    const wasLive = lastStatus.live;
    lastStatus = status;
    if (room) return;
    if (status.live) {
      setState('live', status);
      if (!wasLive) announce('The show is live now.');
    } else if (stage.dataset.state !== 'off') {
      setState('off');
    }
  } catch {
    /* keep showing the last known state */
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await pollStatus();
    schedulePoll();
  }, document.hidden ? 60000 : 20000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !room) {
    pollStatus();
    schedulePoll();
  }
});

function remoteHosts() {
  if (!room) return [];
  return [...room.remoteParticipants.values()].filter((p) => p.identity.startsWith('host-'));
}

function refreshRoom() {
  if (!room) return;
  const everyone = [...room.remoteParticipants.values()];
  const hosts = everyone.filter((p) => p.identity.startsWith('host-'));
  const listeners = everyone.length - hosts.length + 1; // +1 is you
  $('stage-copy').textContent = hostsLine(hosts.map((p) => p.name));
  $('listener-count').textContent = listenerText(listeners);
}

function updateUnmute() {
  unmuteBtn.hidden = !room || room.canPlaybackAudio;
}

function onTrack(track) {
  if (track.kind !== 'audio') return;
  const el = track.attach();
  $('remote-audio').append(el);
  if (!audioCtx || prefersReducedMotion()) return;
  try {
    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      stopMeter = startLevelMeter(analyser, (face) => die.setFace(face));
    }
    const src = audioCtx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    src.connect(analyser);
    sources.set(track.sid, src);
  } catch {
    /* the die just won't dance; audio still plays */
  }
}

function onTrackGone(track) {
  track.detach().forEach((el) => el.remove());
  sources.get(track.sid)?.disconnect();
  sources.delete(track.sid);
}

// showEnded: the host left. Skip the instant status check, because the
// cached status can still say "live" for a few seconds.
async function leave(message, { showEnded = false } = {}) {
  const current = room;
  room = null;
  stopMeter?.();
  stopMeter = null;
  sources.forEach((src) => src.disconnect());
  sources.clear();
  analyser = null;
  $('remote-audio').replaceChildren();
  if (current) {
    try {
      await current.disconnect();
    } catch {
      /* already gone */
    }
  }
  setState('off', { message });
  if (message) announce(message);
  if (showEnded) lastStatus = { live: false, hosts: [], listeners: 0 };
  else await pollStatus();
  schedulePoll();
}

async function tuneIn() {
  showError('');
  tuneBtn.disabled = true;
  tuneBtn.textContent = 'Connecting…';
  // Start audio inside the click, so the browser allows sound.
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
  } catch {
    audioCtx = null;
  }
  try {
    if (!window.LivekitClient) {
      throw new Error('The live player could not load. Check your connection and refresh the page.');
    }
    const { Room, RoomEvent } = window.LivekitClient;
    const { url, token } = await api('/api/live-token', { method: 'POST', body: { role: 'listener' } });
    const next = new Room({ adaptiveStream: true });
    next
      .on(RoomEvent.TrackSubscribed, onTrack)
      .on(RoomEvent.TrackUnsubscribed, onTrackGone)
      .on(RoomEvent.ParticipantConnected, refreshRoom)
      .on(RoomEvent.ParticipantDisconnected, () => {
        refreshRoom();
        if (room && !remoteHosts().length) {
          leave('The show just ended. Thanks for listening!', { showEnded: true });
        }
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, updateUnmute)
      .on(RoomEvent.Reconnecting, () => announce('Connection hiccup. Reconnecting…'))
      .on(RoomEvent.Reconnected, () => announce('Reconnected.'))
      .on(RoomEvent.Disconnected, () => {
        if (room === next) leave('You were disconnected. Press Tune in to rejoin.');
      });
    room = next;
    clearTimeout(pollTimer);
    await next.connect(url, token);
    await next.startAudio().catch(() => {});
    if (!remoteHosts().length) {
      await leave('The show just ended. Catch the episode below once it’s published.', { showEnded: true });
      return;
    }
    setState('tuned', { hosts: remoteHosts().map((p) => p.name) });
    refreshRoom();
    updateUnmute();
    announce('You are listening live.');
  } catch (err) {
    const failed = room;
    room = null;
    failed?.disconnect().catch?.(() => {});
    showError(err.message || 'Could not connect to the live show.');
    tuneBtn.disabled = false;
    tuneBtn.textContent = 'Tune in';
    schedulePoll();
  }
}

tuneBtn.addEventListener('click', tuneIn);
leaveBtn.addEventListener('click', () => leave(''));
unmuteBtn.addEventListener('click', async () => {
  await room?.startAudio().catch(() => {});
  await audioCtx?.resume().catch(() => {});
  updateUnmute();
});

loadEpisodes();
pollStatus();
schedulePoll();
