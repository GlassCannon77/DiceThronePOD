// GET /api/live-status → { configured, live, hosts, listeners }
// The listener page checks this to know when the show is on air.
import { getConfig, hasLivekit } from '../lib/config.js';
import { handle, allow, json } from '../lib/http.js';
import { listParticipants, summarize } from '../lib/livekit.js';

export default handle(async (req) => {
  allow(req, 'GET');
  const cfg = getConfig();
  if (!hasLivekit(cfg)) return json({ configured: false, live: false, hosts: [], listeners: 0 });
  const status = summarize(await listParticipants(cfg));
  // Shared by every listener for 10 seconds, so a big audience stays cheap.
  return json({ configured: true, ...status }, 200, {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=10',
  });
});

export const config = { path: '/api/live-status' };
