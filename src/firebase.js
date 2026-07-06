import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, remove } from 'firebase/database';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Firebase keys cannot contain . # $ [ ]
const safeKey = k => k.replace(/[.#$[\]]/g, '_');

/**
 * storageGet(key, shared)
 *   shared=true  → Firebase Realtime Database (game rooms, visible to all players)
 *   shared=false → localStorage (player name / player ID, this device only)
 * Returns the stored string value, or null if not found.
 */
export const storageGet = async (key, shared) => {
  if (shared) {
    try {
      const snap = await get(ref(db, `str/${safeKey(key)}`));
      return snap.exists() ? snap.val() : null;
    } catch { return null; }
  } else {
    try {
      return localStorage.getItem(`str_${key}`) ?? null;
    } catch { return null; }
  }
};

/**
 * storageSet(key, value, shared)
 *   value should be a string (game state is JSON.stringify'd before calling this).
 */
export const storageSet = async (key, value, shared) => {
  if (shared) {
    try {
      await set(ref(db, `str/${safeKey(key)}`), value);
    } catch { /* silently fail — polling will retry */ }
  } else {
    try {
      localStorage.setItem(`str_${key}`, value);
    } catch { /* private browsing / storage full */ }
  }
};

/**
 * listReports() — read every player-submitted feedback report from the shared `str`
 * node (keys beginning `skip_river_report_`), parse each JSON value, and return them
 * newest-first. Used by the in-app reports admin view (#reports).
 */
export const listReports = async () => {
  try {
    const snap = await get(ref(db, 'str'));
    if (!snap.exists()) return [];
    const all = snap.val() || {};
    const out = [];
    for (const k of Object.keys(all)) {
      if (!k.startsWith('skip_river_report_')) continue;
      let parsed;
      try { parsed = JSON.parse(all[k]); } catch { parsed = { text: String(all[k]) }; }
      out.push({ key: k, ...parsed });
    }
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return out;
  } catch { return []; }
};

/** deleteReport(key) — remove a single report node. Returns true on success. */
export const deleteReport = async key => {
  try { await remove(ref(db, `str/${key}`)); return true; } catch { return false; }
};
