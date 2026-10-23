// GET    /api/episodes        public list of episodes + show info
// POST   /api/episodes        (host) save an uploaded episode to the feed
// DELETE /api/episodes?id=…   (host) remove an episode from the feed
import { getConfig, hasSupabase } from '../lib/config.js';
import { handle, allow, json, readJson, requireHost, HttpError, toIntOrNull } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

const PATH_RE = /^episodes\/[a-z0-9-]+\.(mp3|m4a)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicShape(ep) {
  return {
    id: ep.id,
    title: ep.title,
    description: ep.description,
    audioUrl: ep.audio_url,
    audioType: ep.audio_type,
    bytes: Number(ep.audio_bytes) || 0,
    durationSeconds: ep.duration_seconds,
    episodeNumber: ep.episode_number,
    seasonNumber: ep.season_number,
    explicit: ep.explicit,
    publishedAt: ep.published_at,
  };
}

function showInfo(cfg) {
  const { title, description, spotifyUrl } = cfg.show;
  return { title, description, spotifyUrl, feedUrl: cfg.feedUrl, coverUrl: '/cover-600.jpg' };
}

export default handle(async (req) => {
  allow(req, 'GET', 'POST', 'DELETE');
  const cfg = getConfig();

  if (req.method === 'GET') {
    if (!hasSupabase(cfg)) return json({ show: showInfo(cfg), episodes: [], setupNeeded: true });
    const rows = await supabase(cfg).listEpisodes();
    const now = Date.now();
    const episodes = rows.filter((ep) => new Date(ep.published_at).getTime() <= now).map(publicShape);
    return json({ show: showInfo(cfg), episodes });
  }

  await requireHost(req, cfg);
  if (!hasSupabase(cfg)) throw new HttpError(503, 'Supabase is not set up yet. Add SUPABASE_URL and SUPABASE_SECRET_KEY.');
  const db = supabase(cfg);

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!UUID_RE.test(id)) throw new HttpError(400, 'Missing or invalid episode id.');
    const removed = await db.deleteEpisode(id);
    if (!removed) throw new HttpError(404, 'That episode was already removed.');
    try {
      await db.removeObject(removed.audio_path);
    } catch (err) {
      console.warn('Episode row removed but the audio file could not be deleted:', err.message);
    }
    return json({ removed: removed.id });
  }

  // POST: the browser already uploaded the audio; now save the episode details.
  const body = await readJson(req);
  const title = String(body.title || '').trim().slice(0, 200);
  const description = String(body.description || '').trim().slice(0, 4000);
  const path = String(body.path || '');
  if (!title) throw new HttpError(400, 'Give the episode a title.');
  if (!PATH_RE.test(path)) throw new HttpError(400, 'Upload path is not valid. Upload the audio again.');

  const file = await db.inspectObject(path);
  if (!file || !file.bytes) throw new HttpError(400, 'The audio upload was not found. Try publishing again.');

  const row = await db.insertEpisode({
    title,
    description,
    audio_path: path,
    audio_url: db.publicUrl(path),
    audio_bytes: file.bytes,
    audio_type: path.endsWith('.m4a') ? 'audio/x-m4a' : 'audio/mpeg',
    duration_seconds: Math.max(0, Math.round(Number(body.durationSeconds) || 0)),
    episode_number: toIntOrNull(body.episodeNumber),
    season_number: toIntOrNull(body.seasonNumber),
    explicit: Boolean(body.explicit),
  });
  return json({ episode: publicShape(row) }, 201);
});

export const config = { path: '/api/episodes' };
