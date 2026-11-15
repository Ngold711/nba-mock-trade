// Per-user client storage (ui/scoped.js) in a fake browser: guests never touch localStorage; members get
// `key::u:<id>` keys; legacy un-scoped keys are purged.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemStorage { constructor() { this.m = new Map(); } get length() { return this.m.size; } key(i) { return [...this.m.keys()][i] ?? null; } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.window = globalThis; globalThis.localStorage = new MemStorage(); globalThis.sessionStorage = new MemStorage();
const S = await import("../ui/scoped.js");
beforeEach(() => { localStorage.m.clear(); sessionStorage.m.clear(); S.resetGuestMemory(); });

test("guests: personal work stays in memory, never in localStorage", () => {
  S.sset("trade:workspace:v1", '{"teams":["LAL"]}');
  assert.equal(S.sget("trade:workspace:v1"), '{"teams":["LAL"]}');
  assert.equal(localStorage.length, 0);
  S.resetGuestMemory();                                       // Continue as Guest / refresh
  assert.equal(S.sget("trade:workspace:v1"), null);
});

test("members: keys are scoped per user id; another account on the same device sees nothing", () => {
  localStorage.setItem("htx:uid", "userA");
  S.sset("draft:v2:2027", "A-board");
  assert.equal(localStorage.getItem("draft:v2:2027::u:userA"), "A-board");
  assert.equal(localStorage.getItem("draft:v2:2027"), null);
  localStorage.setItem("htx:uid", "userB");
  assert.equal(S.sget("draft:v2:2027"), null);
  localStorage.setItem("htx:uid", "userA");
  assert.equal(S.sget("draft:v2:2027"), "A-board");
  S.clearUserCache("userA");                                  // log out
  assert.equal(S.sget("draft:v2:2027"), null);
});

test("sign-in adopts the guest's in-progress work into the new account only", () => {
  S.sset("awards:ballot:v2", "guest-ballot");
  assert.equal(S.adoptGuestWork("userC"), 1);
  assert.equal(localStorage.getItem("awards:ballot:v2::u:userC"), "guest-ballot");
  assert.equal(S.adoptGuestWork("userD"), 0);                 // memory was emptied
});

test("legacy pre-account keys are purged from both storages; scoped keys and preferences survive", () => {
  for (const k of ["hooptrax_ai_threads", "trade:workspace:v1", "draft:v2:2028", "draft:simcount:2027", "awards:ballot:v2", "awards:ballot", "awards:picks"]) localStorage.setItem(k, "old");
  sessionStorage.setItem("hooptrax_ai_active", "x"); sessionStorage.setItem("chat:v1", "[]");
  localStorage.setItem("trade:workspace:v1::u:userA", "mine"); localStorage.setItem("htx:theme", "light"); localStorage.setItem("draft:format", "321");
  S.purgeLegacy();
  assert.deepEqual([...localStorage.m.keys()].sort(), ["draft:format", "htx:theme", "trade:workspace:v1::u:userA"]);
  assert.equal(sessionStorage.length, 0);
  assert.ok(S.isScoped("trade:workspace:v1") && S.isScoped("awards:picks") && !S.isScoped("draft:format") && !S.isScoped("hooptrax_ai_threads"));
});
