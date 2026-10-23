// Small helpers shared by the listener page and the studio.

// localStorage can be blocked (private windows), so every call is guarded.
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not saved; that's fine */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export async function api(path, { method = 'GET', body, hostKey } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (hostKey) headers['x-host-key'] = hostKey;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `The server answered with an error (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatDuration(totalSeconds) {
  const mins = Math.round((Number(totalSeconds) || 0) / 60);
  if (mins < 1) return 'Under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatDate(iso, withTime = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  if (withTime) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleString(undefined, options);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${n > 0 ? Math.max(1, Math.round(n / 1024)) : 0} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

// Tiny DOM builder: h('p', { class: 'x' }, 'text', otherNode)
// Text is always inserted as text, never as HTML, so episode titles can't inject code.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- The die ----------
// Pips are numbered left-to-right, top-to-bottom (0–8).
const FACES = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};

export function createDie(svg) {
  const pips = [...svg.querySelectorAll('circle')];
  let current = 0;
  function setFace(n) {
    const face = Math.min(6, Math.max(1, Math.round(n)));
    if (face === current) return;
    current = face;
    const lit = new Set(FACES[face]);
    pips.forEach((pip, i) => pip.classList.toggle('lit', lit.has(i)));
  }
  function clear() {
    current = 0;
    pips.forEach((pip) => pip.classList.remove('lit'));
  }
  return { setFace, clear };
}

// Turns loudness into a die face: quiet = 1 pip, loud = 6 pips.
export function startLevelMeter(analyser, onFace) {
  const buf = new Float32Array(analyser.fftSize);
  let level = 0;
  let frame = 0;
  function tick() {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    const target = Math.min(1, Math.max(0, (db + 55) / 45));
    level = target > level ? target : level * 0.88 + target * 0.12;
    onFace(1 + level * 5);
    frame = requestAnimationFrame(tick);
  }
  tick();
  return () => cancelAnimationFrame(frame);
}

export const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
