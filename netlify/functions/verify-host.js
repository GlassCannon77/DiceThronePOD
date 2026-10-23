// POST /api/verify-host — checks the studio sign-in password.
import { getConfig } from '../lib/config.js';
import { handle, allow, json, requireHost } from '../lib/http.js';

export default handle(async (req) => {
  allow(req, 'POST');
  await requireHost(req, getConfig());
  return json({ ok: true });
});

export const config = { path: '/api/verify-host' };
