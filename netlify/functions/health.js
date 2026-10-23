// GET /api/health — the studio's setup checklist.
// Anyone sees pass/fail; only a signed-in host sees how to fix each item.
import { getConfig, hasSupabase, hasLivekit } from '../lib/config.js';
import { handle, allow, json, isHost } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { listParticipants } from '../lib/livekit.js';

export default handle(async (req) => {
  allow(req, 'GET');
  const cfg = getConfig();
  const host = isHost(req, cfg);
  const checks = [];

  checks.push({
    id: 'host',
    label: 'Host password',
    ok: Boolean(cfg.hostPassword),
    fix: 'Set HOST_PASSWORD in Netlify environment variables, then redeploy.',
  });
  checks.push({
    id: 'email',
    label: 'Owner email for Spotify',
    ok: Boolean(cfg.show.ownerEmail),
    fix: 'Set OWNER_EMAIL. Spotify sends its verification code to this address.',
  });

  const storage = { id: 'storage', label: 'Episode storage (Supabase)', ok: false };
  if (!hasSupabase(cfg)) {
    storage.fix = 'Set SUPABASE_URL and SUPABASE_SECRET_KEY, then redeploy.';
  } else {
    try {
      await supabase(cfg).check();
      storage.ok = true;
    } catch (err) {
      storage.fix = err.message;
    }
  }
  checks.push(storage);

  const live = { id: 'live', label: 'Live broadcasting (LiveKit)', ok: false, optional: true };
  if (!hasLivekit(cfg)) {
    live.fix = 'Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to broadcast live.';
  } else if (!/^wss?:\/\//i.test(cfg.livekit.url)) {
    live.fix = 'LIVEKIT_URL should start with wss:// (copy it from your LiveKit project settings).';
  } else {
    try {
      await listParticipants(cfg);
      live.ok = true;
    } catch (err) {
      live.fix = err.message;
    }
  }
  checks.push(live);

  return json({
    host,
    checks: host ? checks : checks.map(({ fix, ...rest }) => rest),
    maxUploadMb: cfg.maxUploadMb,
    feedUrl: cfg.feedUrl,
  });
});

export const config = { path: '/api/health' };
