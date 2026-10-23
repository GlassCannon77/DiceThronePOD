// POST /api/upload-url (host) → a one-time link the studio uses to upload audio.
import { getConfig, hasSupabase } from '../lib/config.js';
import { handle, allow, json, readJson, requireHost, HttpError, slugify } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { randomId } from '../lib/livekit.js';

const TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
};

export default handle(async (req) => {
  allow(req, 'POST');
  const cfg = getConfig();
  await requireHost(req, cfg);
  if (!hasSupabase(cfg)) throw new HttpError(503, 'Supabase is not set up yet. Add SUPABASE_URL and SUPABASE_SECRET_KEY.');

  const body = await readJson(req);
  const ext = TYPES[String(body.contentType || '').toLowerCase()];
  if (!ext) throw new HttpError(400, 'Episodes must be MP3 or M4A audio.');

  const size = Number(body.size) || 0;
  if (size > cfg.maxUploadMb * 1024 * 1024) {
    throw new HttpError(413, `This file is over the ${cfg.maxUploadMb} MB upload limit.`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const name = slugify(body.title) || 'episode';
  const path = `episodes/${date}-${name}-${randomId(3)}.${ext}`;
  const uploadUrl = await supabase(cfg).createUploadUrl(path);
  return json({ uploadUrl, path });
});

export const config = { path: '/api/upload-url' };
