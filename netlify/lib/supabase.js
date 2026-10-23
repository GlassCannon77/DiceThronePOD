// Talks to Supabase (database + file storage) with plain fetch calls,
// so the project needs no npm packages.
import { HttpError } from './http.js';

const MISSING_TABLE = /42P01|PGRST205|relation .*episodes.* does not exist|Could not find the table/i;

export function supabase(cfg) {
  const base = cfg.supabase.url;
  const key = cfg.supabase.key;
  const bucket = cfg.supabase.bucket;
  const auth = { apikey: key, Authorization: `Bearer ${key}` };

  async function call(url, { method = 'GET', body, headers = {} } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { ...auth, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new HttpError(502, `Could not reach Supabase. Check SUPABASE_URL. (${err.message})`);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message = (data && (data.message || data.error || data.msg)) || text || `HTTP ${res.status}`;
      if (MISSING_TABLE.test(`${data?.code || ''} ${message}`)) {
        throw new HttpError(503, 'The episodes table is missing. Run supabase/schema.sql in the Supabase SQL editor.');
      }
      if (/bucket not found/i.test(message)) {
        throw new HttpError(503, `The "${bucket}" storage bucket is missing. Run supabase/schema.sql in the Supabase SQL editor.`);
      }
      if (res.status === 401 || res.status === 403 || /invalid api key|jwt/i.test(message)) {
        throw new HttpError(503, 'Supabase rejected the key. Check SUPABASE_SECRET_KEY.');
      }
      throw new HttpError(502, `Supabase error: ${message}`);
    }
    return data;
  }

  const rest = (path, options) => call(`${base}/rest/v1/${path}`, options);

  return {
    publicUrl(path) {
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
    },

    async listEpisodes() {
      return rest('episodes?select=*&order=published_at.desc');
    },

    async insertEpisode(row) {
      const rows = await rest('episodes', {
        method: 'POST',
        body: row,
        headers: { Prefer: 'return=representation' },
      });
      return rows[0];
    },

    async deleteEpisode(id) {
      const rows = await rest(`episodes?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      });
      return rows[0] || null;
    },

    // Gives the browser a one-time link to upload straight to storage.
    // Big audio files skip the Netlify function size limit this way.
    async createUploadUrl(path) {
      const data = await call(`${base}/storage/v1/object/upload/sign/${bucket}/${path}`, {
        method: 'POST',
        body: {},
      });
      return `${base}/storage/v1${data.url}`;
    },

    // Checks the uploaded file really exists and reads its size.
    async inspectObject(path) {
      let res;
      try {
        res = await fetch(this.publicUrl(path), { method: 'HEAD' });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      return {
        bytes: Number(res.headers.get('content-length')) || 0,
        type: res.headers.get('content-type') || '',
      };
    },

    async removeObject(path) {
      await call(`${base}/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: [path] } });
    },

    async check() {
      await rest('episodes?select=id&limit=1');
      const info = await call(`${base}/storage/v1/bucket/${bucket}`);
      if (info && info.public === false) {
        throw new HttpError(503, `The "${bucket}" bucket must be public so Spotify can download episodes.`);
      }
    },
  };
}
