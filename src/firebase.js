import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get } from 'firebase/database';

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
