// POST /api/live-token { role: "host" | "listener", name }
// Hosts need the host password. Listeners can only listen, never broadcast.
import { getConfig, hasLivekit } from '../lib/config.js';
import { handle, allow, json, readJson, requireHost, HttpError } from '../lib/http.js';
import { hostToken, listenerToken } from '../lib/livekit.js';

export default handle(async (req) => {
  allow(req, 'POST');
  const cfg = getConfig();
  if (!hasLivekit(cfg)) {
    throw new HttpError(503, 'Live broadcasting is not set up yet. Add the LiveKit settings in Netlify.');
  }
  const body = await readJson(req);

  if (body.role === 'host') {
    await requireHost(req, cfg);
    const name = String(body.name || '').trim().slice(0, 40) || 'Host';
    return json({ url: cfg.livekit.url, ...hostToken(cfg, name) });
  }
  return json({ url: cfg.livekit.url, ...listenerToken(cfg) });
});

export const config = { path: '/api/live-token' };
