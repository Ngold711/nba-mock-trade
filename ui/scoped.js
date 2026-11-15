// Per-user client storage for personal work: the Trade Machine workspace, mock-draft boards and sim counts,
// and award ballots.
//   Signed in → localStorage under `${key}::u:${userId}` (never a shared key, so accounts on one device can't
//               see each other's work).
//   Guest     → an in-memory Map only: nothing is read from or written to localStorage, and a refresh, a new
//               tab or "Continue as Guest" wipes it.
// AI chat history is not stored here at all: members' threads live in the database (/api/ai-threads), guests'
// only in the chat module's memory.
//
// "htx:uid" is a hint written only after the server confirms the session (/api/auth/me, login, signup); pages
// read it synchronously at start-up to pick the right scope, and account.js reloads if it ever disagrees with
// the server.

/** Keys that hold personal work. Anything matching must go through sget/sset. */
export const SCOPED = /^(trade:workspace:v1|draft:v2:\d{4}|draft:simcount:\d{4}|awards:ballot:v2|awards:picks)$/;
/** Legacy, un-scoped keys from before accounts existed (and the old global chat history). Purged on every load. */
export const LEGACY = /^(hooptrax_ai_threads|hooptrax_ai_active|chat:v1|trade:workspace:v1|draft:v2:\d{4}|draft:simcount:\d{4}|awards:ballot|awards:ballot:v2|awards:picks)$/;

const mem = new Map();
const LS = () => { try { return window.localStorage; } catch { return null; } };

export function currentUid() { try { return LS()?.getItem("htx:uid") || null; } catch { return null; } }
export const isScoped = (k) => SCOPED.test(k);
export const scopedKey = (k, uid) => `${k}::u:${uid}`;

export function sget(k) {
  const uid = currentUid();
  if (!uid) return mem.has(k) ? mem.get(k) : null;
  try { return LS().getItem(scopedKey(k, uid)); } catch { return null; }
}
export function sset(k, v) {
  const uid = currentUid();
  if (!uid) { mem.set(k, v); return; }
  try { LS().setItem(scopedKey(k, uid), v); } catch {}
}
export function sdel(k) { const uid = currentUid(); if (!uid) mem.delete(k); else try { LS().removeItem(scopedKey(k, uid)); } catch {} }

/** Wipe guest memory (Continue as Guest, log out). */
export function resetGuestMemory() { mem.clear(); }

/** Sign-in: carry the guest's in-progress work (in memory) into the new account, then drop it from memory. */
export function adoptGuestWork(uid) {
  const ls = LS(); if (!ls || !uid) return 0;
  let n = 0;
  for (const [k, v] of mem) if (isScoped(k) && v != null) { try { ls.setItem(scopedKey(k, uid), v); n++; } catch {} }
  mem.clear();
  return n;
}

/** Log out: remove every cached key for that user from this device. */
export function clearUserCache(uid) {
  const ls = LS(); if (!ls || !uid) return;
  const tail = `::u:${uid}`;
  for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k && k.endsWith(tail)) ls.removeItem(k); }
}

/** Remove pre-account history from this browser (both storages). Idempotent: un-scoped keys are never written now. */
export function purgeLegacy() {
  for (const s of [LS(), (() => { try { return window.sessionStorage; } catch { return null; } })()]) {
    if (!s) continue;
    try { for (let i = s.length - 1; i >= 0; i--) { const k = s.key(i); if (k && LEGACY.test(k)) s.removeItem(k); } } catch {}
  }
}
