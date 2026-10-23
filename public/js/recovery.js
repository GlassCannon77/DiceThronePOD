// Saves the recording to the browser's own storage every few seconds.
// If the tab crashes or closes mid-show, the studio offers to recover it.

const DB_NAME = 'dice-throne-studio';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('sessions', { keyPath: 'id' });
        const chunks = db.createObjectStore('chunks', { autoIncrement: true });
        chunks.createIndex('session', 'session');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const sessions = new Map();
let queue = Promise.resolve();

// Writes go one at a time, in order. Failures never stop the recording.
function enqueue(job) {
  queue = queue.then(job).catch((err) => console.warn('Recovery save skipped:', err));
  return queue;
}

export const recovery = {
  begin(meta) {
    const session = { ...meta, samples: 0, bytes: 0 };
    sessions.set(meta.id, session);
    return enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(session);
      await done(tx);
    });
  },

  add(id, bytes, samples) {
    const session = sessions.get(id);
    if (!session) return Promise.resolve();
    session.samples = samples;
    session.bytes += bytes.length;
    const snapshot = { ...session };
    return enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
      tx.objectStore('chunks').add({ session: id, data: bytes });
      tx.objectStore('sessions').put(snapshot);
      await done(tx);
    });
  },

  async list() {
    try {
      await queue;
      const db = await openDb();
      const tx = db.transaction('sessions', 'readonly');
      const all = await request(tx.objectStore('sessions').getAll());
      return all.filter((s) => s.bytes > 0).sort((a, b) => b.startedAt - a.startedAt);
    } catch {
      return [];
    }
  },

  async load(id) {
    await queue;
    const db = await openDb();
    const tx = db.transaction(['sessions', 'chunks'], 'readonly');
    const session = await request(tx.objectStore('sessions').get(id));
    const parts = await request(tx.objectStore('chunks').index('session').getAll(id));
    if (!session || !parts.length) throw new Error('That recording is no longer saved in this browser.');
    return {
      blob: new Blob(
        parts.map((p) => p.data),
        { type: 'audio/mpeg' },
      ),
      durationSeconds: session.samples / session.sampleRate,
      startedAt: session.startedAt,
    };
  },

  remove(id) {
    sessions.delete(id);
    return enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
      tx.objectStore('sessions').delete(id);
      const index = tx.objectStore('chunks').index('session');
      const keys = await request(index.getAllKeys(id));
      for (const key of keys) tx.objectStore('chunks').delete(key);
      await done(tx);
    });
  },
};
