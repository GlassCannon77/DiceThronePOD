// LiveKit handles the live audio. This file makes the access passes (tokens)
// that let a host broadcast or a listener tune in, without any npm package.
import { createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

const b64url = (value) => Buffer.from(value).toString('base64url');

export function createToken(cfg, { identity, name, video, ttlSeconds = 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: cfg.livekit.apiKey, nbf: now - 5, exp: now + ttlSeconds, video };
  if (identity) payload.sub = identity;
  if (name) payload.name = name;
  const unsigned = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', cfg.livekit.apiSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export const randomId = (bytes = 4) => randomBytes(bytes).toString('hex');

export function hostToken(cfg, name) {
  const identity = `host-${randomId()}`;
  return {
    identity,
    token: createToken(cfg, {
      identity,
      name,
      ttlSeconds: 6 * 3600,
      video: { room: cfg.livekit.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    }),
  };
}

export function listenerToken(cfg) {
  const identity = `listener-${randomId()}`;
  return {
    identity,
    token: createToken(cfg, {
      identity,
      name: 'Listener',
      ttlSeconds: 6 * 3600,
      video: { room: cfg.livekit.room, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false },
    }),
  };
}

export function httpUrl(url) {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/+$/, '');
}

export async function listParticipants(cfg) {
  const token = createToken(cfg, { video: { roomAdmin: true, room: cfg.livekit.room }, ttlSeconds: 60 });
  let res;
  try {
    res = await fetch(`${httpUrl(cfg.livekit.url)}/twirp/livekit.RoomService/ListParticipants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ room: cfg.livekit.room }),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach LiveKit. Check LIVEKIT_URL. (${err.message})`);
  }
  const data = await res.json().catch(() => ({}));
  // No room yet just means nobody is live.
  if (res.status === 404 || data.code === 'not_found') return [];
  if (res.status === 401 || res.status === 403 || data.code === 'unauthenticated' || data.code === 'permission_denied') {
    throw new HttpError(503, 'LiveKit rejected the API key or secret. Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET.');
  }
  if (!res.ok) throw new HttpError(502, `LiveKit error: ${data.msg || `HTTP ${res.status}`}`);
  return data.participants || [];
}

export function summarize(participants) {
  const hosts = participants.filter((p) => String(p.identity || '').startsWith('host-'));
  return {
    live: hosts.length > 0,
    hosts: hosts.map((p) => p.name || 'Host'),
    listeners: participants.length - hosts.length,
  };
}
