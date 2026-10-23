import { createHash, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

// Wraps a function handler so thrown errors turn into clean JSON responses.
export function handle(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json(
        { error: 'Something went wrong on the server. Check the function log in Netlify for details.' },
        500,
      );
    }
  };
}

export function allow(req, ...methods) {
  if (!methods.includes(req.method)) {
    throw new HttpError(405, `This address only accepts ${methods.join(' or ')} requests.`);
  }
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

const digest = (value) => createHash('sha256').update(String(value)).digest();

export function isHost(req, cfg) {
  const given = req.headers.get('x-host-key') || '';
  if (!cfg.hostPassword || !given) return false;
  return timingSafeEqual(digest(given), digest(cfg.hostPassword));
}

export async function requireHost(req, cfg) {
  if (!cfg.hostPassword) {
    throw new HttpError(503, 'HOST_PASSWORD is not set in Netlify yet. Add it, then redeploy the site.');
  }
  if (!isHost(req, cfg)) {
    // A short pause makes password guessing slower.
    await new Promise((resolve) => setTimeout(resolve, 600));
    throw new HttpError(401, 'That host password is not right.');
  }
}

export function slugify(text, max = 40) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

export function toIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 100000 ? n : null;
}
