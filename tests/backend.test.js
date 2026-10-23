// Run with: npm test
// Checks the server functions with a fake Supabase and LiveKit, so no accounts are needed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { buildFeed } from '../netlify/lib/rss.js';
import { createToken } from '../netlify/lib/livekit.js';
import feed from '../netlify/functions/feed.js';
import episodes from '../netlify/functions/episodes.js';
import uploadUrl from '../netlify/functions/upload-url.js';
import liveToken from '../netlify/functions/live-token.js';
import liveStatus from '../netlify/functions/live-status.js';
import health from '../netlify/functions/health.js';

const SB = 'https://demo.supabase.co';
const ENV = {
  URL: 'https://dicethrone.netlify.app',
  HOST_PASSWORD: 'correct horse battery staple',
  OWNER_EMAIL: 'host@example.com',
  SUPABASE_URL: SB,
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  LIVEKIT_URL: 'wss://demo.livekit.cloud',
  LIVEKIT_API_KEY: 'APItest',
  LIVEKIT_API_SECRET: 'secret-for-tests-only',
};

const sampleRow = {
  id: '6f1c2a4e-1b2c-4d3e-8f90-1234567890ab',
  title: 'Episode 1: Barbarian vs. Moon Elf & friends <3',
  description: 'First line.\n\nSecond paragraph with ]]> inside.',
  audio_path: 'episodes/2026-10-22-episode-1-abc123.mp3',
  audio_url: `${SB}/storage/v1/object/public/podcast/episodes/2026-10-22-episode-1-abc123.mp3`,
  audio_bytes: 28800000,
  audio_type: 'audio/mpeg',
  duration_seconds: 3605,
  episode_number: 1,
  season_number: null,
  explicit: false,
  published_at: '2026-10-22T20:00:00Z',
};

let calls = [];
let routes = [];

function route(match, respond) {
  routes.push({ match, respond });
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  calls = [];
  routes = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    calls.push(call);
    const hit = routes.find((r) => r.match(call));
    if (!hit) throw new Error(`Unexpected fetch: ${call.method} ${call.url}`);
    return hit.respond(call);
  };
});

const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const req = (path, { method = 'GET', body, key } = {}) =>
  new Request(`https://dicethrone.netlify.app${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'x-host-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

// ---------- RSS ----------

test('feed escapes text and includes everything Spotify needs', () => {
  const cfg = {
    siteUrl: 'https://dicethrone.netlify.app',
    feedUrl: 'https://dicethrone.netlify.app/feed.xml',
    show: {
      title: 'Dice Throne Podcast',
      description: 'Dice & heroes',
      author: 'Jordan',
      ownerName: 'Jordan',
      ownerEmail: 'host@example.com',
      language: 'en-us',
      explicit: false,
      category: 'Leisure',
      subcategory: 'Games',
      coverUrl: 'https://dicethrone.netlify.app/cover.jpg',
    },
  };
  const future = { ...sampleRow, id: 'future', published_at: '2099-01-01T00:00:00Z' };
  const xml = buildFeed(cfg, [sampleRow, future], new Date('2026-10-23T00:00:00Z'));
  assert.match(xml, /<itunes:email>host@example.com<\/itunes:email>/);
  assert.match(xml, /<itunes:image href="https:\/\/dicethrone.netlify.app\/cover.jpg"\/>/);
  assert.match(xml, /<itunes:category text="Leisure"><itunes:category text="Games"\/><\/itunes:category>/);
  assert.match(xml, /Barbarian vs. Moon Elf &amp; friends &lt;3/);
  assert.match(xml, /<enclosure url="[^"]+abc123\.mp3" length="28800000" type="audio\/mpeg"\/>/);
  assert.match(xml, /<itunes:duration>3605<\/itunes:duration>/);
  assert.match(xml, /<itunes:episode>1<\/itunes:episode>/);
  assert.doesNotMatch(xml, /<itunes:season>/);
  assert.match(xml, /<pubDate>Thu, 22 Oct 2026 20:00:00 GMT<\/pubDate>/);
  assert.doesNotMatch(xml, /future/, 'scheduled episodes stay out of the feed');
  assert.ok(xml.includes(']]]]><![CDATA[>'), 'CDATA end markers are split safely');
});

test('GET /feed.xml reads episodes from Supabase', async () => {
  route((c) => c.url.startsWith(`${SB}/rest/v1/episodes`), () => jsonRes([sampleRow]));
  const res = await feed(req('/feed.xml'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /rss\+xml/);
  const xml = await res.text();
  assert.match(xml, /<title>Dice Throne Podcast<\/title>/);
  assert.match(xml, /<atom:link href="https:\/\/dicethrone.netlify.app\/feed.xml"/);
  assert.equal(calls[0].headers.apikey, 'sb_secret_test');
  assert.equal(calls[0].headers.Authorization, 'Bearer sb_secret_test');
});

test('a missing episodes table gives a clear fix', async () => {
  route(
    () => true,
    () => jsonRes({ code: 'PGRST205', message: "Could not find the table 'public.episodes' in the schema cache" }, 404),
  );
  const res = await feed(req('/feed.xml'));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Run supabase\/schema.sql/);
});

// ---------- Episodes + uploads ----------

test('host actions reject a wrong password', async () => {
  const res = await uploadUrl(req('/api/upload-url', { method: 'POST', key: 'nope', body: { contentType: 'audio/mpeg' } }));
  assert.equal(res.status, 401);
});

test('upload-url returns a signed Supabase upload link', async () => {
  route(
    (c) => c.method === 'POST' && c.url.startsWith(`${SB}/storage/v1/object/upload/sign/podcast/episodes/`),
    (c) => jsonRes({ url: `/object/upload/sign/podcast/${c.url.split('/podcast/')[1]}?token=abc` }),
  );
  const res = await uploadUrl(
    req('/api/upload-url', {
      method: 'POST',
      key: ENV.HOST_PASSWORD,
      body: { title: 'Ep 2: Pyromancer!!', contentType: 'audio/mpeg', size: 1000 },
    }),
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.path, /^episodes\/\d{4}-\d{2}-\d{2}-ep-2-pyromancer-[0-9a-f]{6}\.mp3$/);
  assert.equal(data.uploadUrl, `${SB}/storage/v1/object/upload/sign/podcast/${data.path}?token=abc`);
});

test('upload-url refuses files over the size limit and odd formats', async () => {
  const big = await uploadUrl(
    req('/api/upload-url', { method: 'POST', key: ENV.HOST_PASSWORD, body: { contentType: 'audio/mpeg', size: 60e6 } }),
  );
  assert.equal(big.status, 413);
  const wav = await uploadUrl(
    req('/api/upload-url', { method: 'POST', key: ENV.HOST_PASSWORD, body: { contentType: 'audio/wav', size: 10 } }),
  );
  assert.equal(wav.status, 400);
});

test('POST /api/episodes checks the upload, then saves the episode', async () => {
  const path = 'episodes/2026-10-22-ep-2-abc123.mp3';
  route(
    (c) => c.method === 'HEAD' && c.url.endsWith(path),
    () => new Response(null, { status: 200, headers: { 'content-length': '31457280', 'content-type': 'audio/mpeg' } }),
  );
  route(
    (c) => c.method === 'POST' && c.url === `${SB}/rest/v1/episodes`,
    (c) => jsonRes([{ ...JSON.parse(c.body), id: sampleRow.id, published_at: '2026-10-22T21:00:00Z' }], 201),
  );
  const res = await episodes(
    req('/api/episodes', {
      method: 'POST',
      key: ENV.HOST_PASSWORD,
      body: { path, title: '  Ep 2  ', description: 'Notes', durationSeconds: 61.6, episodeNumber: '2', seasonNumber: '', explicit: true },
    }),
  );
  assert.equal(res.status, 201);
  const saved = JSON.parse(calls[1].body);
  assert.equal(saved.title, 'Ep 2');
  assert.equal(saved.audio_bytes, 31457280);
  assert.equal(saved.duration_seconds, 62);
  assert.equal(saved.episode_number, 2);
  assert.equal(saved.season_number, null);
  assert.equal(saved.explicit, true);
  assert.equal(saved.audio_url, `${SB}/storage/v1/object/public/podcast/${path}`);
  assert.equal(calls[1].headers.Prefer, 'return=representation');
});

test('POST /api/episodes refuses a path outside the episodes folder', async () => {
  const res = await episodes(
    req('/api/episodes', { method: 'POST', key: ENV.HOST_PASSWORD, body: { path: '../secret.mp3', title: 'x' } }),
  );
  assert.equal(res.status, 400);
});

test('DELETE /api/episodes removes the row and the audio file', async () => {
  route((c) => c.method === 'DELETE' && c.url.includes('/rest/v1/episodes?id=eq.'), () => jsonRes([sampleRow]));
  route((c) => c.method === 'DELETE' && c.url === `${SB}/storage/v1/object/podcast`, () => jsonRes([{}]));
  const res = await episodes(req(`/api/episodes?id=${sampleRow.id}`, { method: 'DELETE', key: ENV.HOST_PASSWORD }));
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(calls[1].body), { prefixes: [sampleRow.audio_path] });
});

test('GET /api/episodes hides scheduled episodes and keeps the secret key private', async () => {
  route(() => true, () => jsonRes([sampleRow, { ...sampleRow, id: 'later', published_at: '2099-01-01T00:00:00Z' }]));
  const res = await episodes(req('/api/episodes'));
  const data = await res.json();
  assert.equal(data.episodes.length, 1);
  assert.equal(data.episodes[0].durationSeconds, 3605);
  assert.ok(!JSON.stringify(data).includes('sb_secret'));
});

// ---------- LiveKit ----------

function decode(token) {
  const [h, p, s] = token.split('.');
  const expected = createHmac('sha256', ENV.LIVEKIT_API_SECRET).update(`${h}.${p}`).digest('base64url');
  assert.equal(s, expected, 'signature matches');
  return { header: JSON.parse(Buffer.from(h, 'base64url')), payload: JSON.parse(Buffer.from(p, 'base64url')) };
}

test('listener tokens can listen but never broadcast', async () => {
  const res = await liveToken(req('/api/live-token', { method: 'POST', body: { role: 'listener' } }));
  const data = await res.json();
  assert.equal(data.url, ENV.LIVEKIT_URL);
  const { header, payload } = decode(data.token);
  assert.equal(header.alg, 'HS256');
  assert.equal(payload.iss, 'APItest');
  assert.match(payload.sub, /^listener-/);
  assert.equal(payload.video.canPublish, false);
  assert.equal(payload.video.canSubscribe, true);
  assert.equal(payload.video.room, 'dice-throne-live');
  assert.ok(payload.exp > payload.nbf);
});

test('host tokens need the password', async () => {
  const denied = await liveToken(req('/api/live-token', { method: 'POST', body: { role: 'host', name: 'Jordan' } }));
  assert.equal(denied.status, 401);
  const ok = await liveToken(
    req('/api/live-token', { method: 'POST', key: ENV.HOST_PASSWORD, body: { role: 'host', name: 'Jordan' } }),
  );
  const { payload } = decode((await ok.json()).token);
  assert.match(payload.sub, /^host-/);
  assert.equal(payload.name, 'Jordan');
  assert.equal(payload.video.canPublish, true);
});

test('live-status counts hosts and listeners', async () => {
  route(
    (c) => c.url === 'https://demo.livekit.cloud/twirp/livekit.RoomService/ListParticipants',
    (c) => {
      const { payload } = decode(c.headers.Authorization.replace('Bearer ', ''));
      assert.equal(payload.video.roomAdmin, true);
      return jsonRes({
        participants: [
          { identity: 'host-1a2b', name: 'Jordan' },
          { identity: 'host-9z8y', name: 'Mason' },
          { identity: 'listener-1' },
          { identity: 'listener-2' },
          { identity: 'listener-3' },
        ],
      });
    },
  );
  const data = await (await liveStatus(req('/api/live-status'))).json();
  assert.deepEqual(data, { configured: true, live: true, hosts: ['Jordan', 'Mason'], listeners: 3 });
});

test('live-status treats a missing room as off air', async () => {
  route(() => true, () => jsonRes({ code: 'not_found', msg: 'requested room does not exist' }, 404));
  const data = await (await liveStatus(req('/api/live-status'))).json();
  assert.equal(data.live, false);
});

test('token helper matches the LiveKit claim layout', () => {
  const token = createToken(
    { livekit: { apiKey: 'k', apiSecret: ENV.LIVEKIT_API_SECRET } },
    { identity: 'x', video: { room: 'r', roomJoin: true } },
  );
  const { payload } = decode(token);
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iss', 'nbf', 'sub', 'video']);
});

// ---------- Health ----------

test('health hides fix-it details unless signed in', async () => {
  route((c) => c.url.includes('/rest/v1/'), () => jsonRes([]));
  route((c) => c.url.includes('/storage/v1/bucket/'), () => jsonRes({ id: 'podcast', public: true }));
  route((c) => c.url.includes('/twirp/'), () => jsonRes({ code: 'unauthenticated', msg: 'invalid token' }, 401));
  const anon = await (await health(req('/api/health'))).json();
  assert.equal(anon.host, false);
  assert.ok(anon.checks.every((c) => !('fix' in c)));
  const host = await (await health(req('/api/health', { key: ENV.HOST_PASSWORD }))).json();
  const live = host.checks.find((c) => c.id === 'live');
  assert.equal(live.ok, false);
  assert.match(live.fix, /LIVEKIT_API_KEY/);
  assert.equal(host.checks.find((c) => c.id === 'storage').ok, true);
});
