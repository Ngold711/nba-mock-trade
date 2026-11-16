// Accounts, private saves and the community feed, end to end through the HTTP server (JSON-file storage).
// The same store contract runs against PostgreSQL when PG_TEST_URL is set.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "htx-acct-"));
process.env.QUIET = "1";
process.env.ACCOUNTS_FILE = join(dir, "users.json");
process.env.JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
delete process.env.DATABASE_URL;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => (String(url).includes("espn.com") || String(url).includes("hoopshype") ? new Response("{}", { status: 503 }) : realFetch(url, opts));

const { server } = await import("../server.js");
const { createJsonStore, createPgStore } = await import("../service/accounts-store.js");
const { signJwt, verifyJwt, validateItem } = await import("../service/auth.js");
let base;
before(() => new Promise((r) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); globalThis.fetch = realFetch; });

/** Tiny cookie-jar client. */
function client() {
  let cookie = "";
  const call = async (path, { method = "GET", body, headers = {} } = {}) => {
    const res = await realFetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie"); if (sc) { cookie = sc.split(";")[0]; if (/=;|=$/.test(cookie)) cookie = ""; }
    return { status: res.status, body: await res.json().catch(() => null), setCookie: sc };
  };
  return { call, get cookie() { return cookie; } };
}
const TRADE = { trade: "v1.LAL-BKN.abc123", teams: ["LAL", "BKN"], assets: [{ id: "LAL:p3945274", to: "BKN" }, { id: "BKN:2027-1@NYK", to: "LAL" }], verdict: { status: "legal" }, summary: "LAL ⇄ BKN" };
const DRAFT = { year: "2027", format: "321", rounds: 1, order: ["WAS", "IND"], lottery: [], picks: { 1: "p1", 2: "p2" }, control: ["WAS"] };

test("sign up, session cookie, me, duplicate checks, login by email or @username", async () => {
  const a = client();
  let r = await a.call("/api/auth/signup", { method: "POST", body: { email: "bad", username: "x", password: "short" } });
  assert.equal(r.status, 400); assert.ok(r.body.fields.email && r.body.fields.username && r.body.fields.password);
  r = await a.call("/api/auth/signup", { method: "POST", body: { email: "Alice@Example.com", username: "alice_gm", password: "correct horse 1", favoriteTeam: "CHI" } });
  assert.equal(r.status, 201); assert.equal(r.body.data.user.username, "alice_gm"); assert.equal(r.body.data.user.favoriteTeam, "CHI");
  assert.equal(r.body.data.user.email, undefined);                                  // never sent back
  assert.match(r.setCookie, /htx_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
  assert.equal((await a.call("/api/auth/me")).body.data.user.username, "alice_gm");
  assert.equal((await client().call("/api/auth/signup", { method: "POST", body: { email: "x@y.co", username: "ALICE_GM", password: "whatever123" } })).status, 409);
  assert.equal((await client().call("/api/auth/signup", { method: "POST", body: { email: "alice@example.com", username: "other1", password: "whatever123" } })).status, 409);
  const b = client();
  assert.equal((await b.call("/api/auth/login", { method: "POST", body: { login: "alice_gm", password: "nope-nope" } })).status, 401);
  assert.equal((await b.call("/api/auth/login", { method: "POST", body: { login: "ALICE@example.com", password: "correct horse 1" } })).status, 200);
  assert.equal((await b.call("/api/auth/login", { method: "POST", body: { login: "@alice_gm", password: "correct horse 1" } })).status, 200);
  assert.equal((await b.call("/api/auth/logout", { method: "POST", body: {} })).status, 200);
  assert.equal((await b.call("/api/auth/me")).body.data.user, null);
  // passwords are stored as bcrypt hashes only
  await new Promise((r2) => setTimeout(r2, 400));
  const raw = readFileSync(process.env.ACCOUNTS_FILE, "utf8");
  assert.match(raw, /"\$2[aby]\$11\$/); assert.doesNotMatch(raw, /correct horse/);
});

test("CSRF: cross-site or non-JSON writes are refused; forged/expired tokens are ignored", async () => {
  const c = client();
  assert.equal((await c.call("/api/auth/signup", { method: "POST", body: { email: "e@x.co", username: "evil_1", password: "password123" }, headers: { origin: "https://evil.example" } })).status, 403);
  const res = await realFetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(res.status, 403);
  const forged = signJwt({ sub: "someone" }, "wrong-secret");
  assert.equal(verifyJwt(forged, process.env.JWT_SECRET), null);
  assert.equal((await client().call("/api/auth/me", { headers: { cookie: `htx_session=${forged}` } })).body.data.user, null);
});

test("guests can browse the feed but must sign up to save or upvote", async () => {
  const g = client();
  const r = await g.call("/api/items", { method: "POST", body: { type: "trade", visibility: "private", payload: TRADE } });
  assert.equal(r.status, 401); assert.equal(r.body.error, "Create a free Hooptrax account to save privately or post to the community");
  assert.equal((await g.call("/api/feed")).status, 200);
});

test("save privately vs save & post, feed filters, likes, visibility toggle, delete, counts", async () => {
  const a = client(), b = client();
  await a.call("/api/auth/signup", { method: "POST", body: { email: "gm1@x.co", username: "gm_one", password: "password123", favoriteTeam: "LAL" } });
  await b.call("/api/auth/signup", { method: "POST", body: { email: "gm2@x.co", username: "gm_two", password: "password123" } });
  const priv = (await a.call("/api/items", { method: "POST", body: { type: "trade", visibility: "private", title: "my secret deal", payload: TRADE } })).body.data.item;
  const pub = (await a.call("/api/items", { method: "POST", body: { type: "draft", visibility: "public", title: "Wizards land the #1 pick", payload: DRAFT } })).body.data.item;
  const pubT = (await b.call("/api/items", { method: "POST", body: { type: "trade", visibility: "public", title: "Blockbuster", payload: TRADE } })).body.data.item;
  assert.equal(priv.visibility, "private"); assert.equal(pub.username, "gm_one"); assert.equal(pub.favoriteTeam, "LAL");
  assert.equal((await a.call("/api/items", { method: "POST", body: { type: "draft", visibility: "public", payload: { ...DRAFT, picks: {} } } })).status, 400);
  // feed: public only, newest first, type filter
  let feed = (await client().call("/api/feed")).body.data.items;
  assert.deepEqual(feed.map((x) => x.id), [pubT.id, pub.id]);
  assert.ok(feed.every((x) => !("likedByUserIds" in x) && !("email" in x)));
  assert.deepEqual((await client().call("/api/feed?type=draft")).body.data.items.map((x) => x.id), [pub.id]);
  // private items are invisible to others
  assert.equal((await b.call(`/api/items/${priv.id}`)).status, 404);
  assert.equal((await a.call(`/api/items/${priv.id}`)).status, 200);
  // likes: toggle, one per user, top sort
  let l = await b.call(`/api/items/${pub.id}/like`, { method: "POST", body: {} }); assert.deepEqual(l.body.data, { liked: true, likesCount: 1 });
  l = await b.call(`/api/items/${pub.id}/like`, { method: "POST", body: {} }); assert.deepEqual(l.body.data, { liked: false, likesCount: 0 });
  await b.call(`/api/items/${pub.id}/like`, { method: "POST", body: {} });
  feed = (await b.call("/api/feed?sort=top")).body.data.items;
  assert.equal(feed[0].id, pub.id); assert.equal(feed[0].likedByMe, true); assert.equal(feed[0].likesCount, 1);
  assert.equal((await client().call(`/api/items/${pub.id}/like`, { method: "POST", body: {} })).status, 401);
  assert.equal((await b.call(`/api/items/${priv.id}/like`, { method: "POST", body: {} })).status, 404);
  // owner-only changes
  assert.equal((await b.call(`/api/items/${pub.id}/update`, { method: "POST", body: { visibility: "private" } })).status, 403);
  const flipped = (await a.call(`/api/items/${priv.id}/update`, { method: "POST", body: { visibility: "public" } })).body.data.item;
  assert.equal(flipped.visibility, "public");
  assert.equal((await client().call(`/api/items/${priv.id}`)).status, 200);
  let counts = (await a.call("/api/auth/me")).body.data.counts; assert.deepEqual(counts, { public: 2, private: 0 });
  assert.equal((await a.call(`/api/items/${priv.id}/delete`, { method: "POST", body: {} })).status, 200);
  assert.equal((await a.call(`/api/items/${priv.id}`)).status, 404);
  assert.equal((await a.call("/api/me/items/private")).body.data.items.length, 0);
  assert.equal((await a.call("/api/me/items/public")).body.data.items.length, 1);
  // favorite team follows into posts
  await a.call("/api/me", { method: "POST", body: { favoriteTeam: "GSW", bio: "Dubs" } });
  assert.equal((await client().call(`/api/items/${pub.id}`)).body.data.item.favoriteTeam, "GSW");
});

test("AI chat history is per account: list, upsert, delete, clear; other users can't read or overwrite it", async () => {
  const a = client(), b = client(), g = client();
  await a.call("/api/auth/signup", { method: "POST", body: { email: "ai1@x.co", username: "ai_one", password: "password123" } });
  await b.call("/api/auth/signup", { method: "POST", body: { email: "ai2@x.co", username: "ai_two", password: "password123" } });
  const th = { id: "thrA123456", title: "Who won MVP in 1996", updatedAt: Date.now(), messages: [{ role: "user", text: "Who won MVP in 1996?" }, { role: "assistant", text: "Michael Jordan.", chips: [], cards: [], source: "gemini" }] };
  for (const path of ["/api/ai-threads", "/api/saved-items", "/api/saved-items/private", "/api/profile", "/api/me/items/private"]) assert.equal((await g.call(path)).status, 401, path);
  assert.equal((await g.call("/api/ai-threads", { method: "POST", body: th })).status, 401);
  assert.equal((await a.call("/api/ai-threads", { method: "POST", body: th })).status, 200);
  assert.deepEqual((await a.call("/api/ai-threads")).body.data.threads.map((t) => t.title), ["Who won MVP in 1996"]);
  assert.deepEqual((await b.call("/api/ai-threads")).body.data.threads, []);                      // B sees nothing of A's
  assert.equal((await b.call("/api/ai-threads", { method: "POST", body: { ...th, title: "hijack" } })).status, 409);   // same id, other owner
  assert.equal((await a.call("/api/ai-threads")).body.data.threads[0].title, "Who won MVP in 1996");
  assert.equal((await b.call(`/api/ai-threads/${th.id}/delete`, { method: "POST", body: {} })).body.data.ok, false);
  assert.equal((await b.call("/api/ai-threads/clear", { method: "POST", body: {} })).body.data.deleted, 0);
  assert.equal((await a.call("/api/ai-threads")).body.data.threads.length, 1);
  assert.equal((await a.call("/api/ai-threads", { method: "POST", body: { id: "bad id!", messages: [] } })).status, 400);
  assert.equal((await a.call("/api/ai-threads", { method: "POST", body: th, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await a.call(`/api/ai-threads/${th.id}/delete`, { method: "POST", body: {} })).body.data.ok, true);
  assert.deepEqual((await a.call("/api/ai-threads")).body.data.threads, []);
  // spec routes: /api/saved-items and /api/profile are scoped to the session user
  const it = (await a.call("/api/saved-items", { method: "POST", body: { type: "trade", visibility: "private", payload: TRADE } })).body.data.item;
  assert.deepEqual((await a.call("/api/saved-items/private")).body.data.items.map((x) => x.id), [it.id]);
  assert.deepEqual((await b.call("/api/saved-items/private")).body.data.items, []);
  assert.equal((await b.call(`/api/items/${it.id}`)).status, 404);
  assert.equal((await a.call("/api/profile")).body.data.user.username, "ai_one");
  assert.equal((await a.call("/api/profile")).body.data.user.email, undefined);
});

test("orphaned (pre-account / unowned) items and threads are purged on start-up", async () => {
  const { writeFileSync } = await import("node:fs");
  const f = join(dir, "legacy.json");
  writeFileSync(f, JSON.stringify({
    users: [{ id: "u1", username: "owner", email: "o@x.co", passwordHash: "h", createdAt: "2026-01-01T00:00:00.000Z" }],
    items: [{ id: "keep1", userId: "u1", type: "trade", visibility: "private", payloadJson: {} }, { id: "old1", userId: null, type: "trade", visibility: "public", payloadJson: {} }, { id: "old2", type: "draft", visibility: "public", payloadJson: {} }, { id: "old3", userId: "ghost", type: "draft", visibility: "public", payloadJson: {} }],
    threads: [{ id: "t-keep", userId: "u1", title: "mine", messages: [{ role: "user", text: "hi" }], updatedAt: 1 }, { id: "t-old", userId: null, title: "legacy", messages: [], updatedAt: 1 }],
  }));
  const s = createJsonStore(f); await s.init();
  assert.deepEqual((await s.listItems({ userId: "u1" })).map((x) => x.id), ["keep1"]);
  assert.equal((await s.listFeed({})).length, 0);
  assert.deepEqual((await s.listThreads("u1")).map((t) => t.id), ["t-keep"]);
  await s.flushNow();
  const raw = JSON.parse(readFileSync(f, "utf8"));
  assert.deepEqual(raw.items.map((x) => x.id), ["keep1"]); assert.deepEqual(raw.threads.map((x) => x.id), ["t-keep"]);
});

test("payload validation", () => {
  assert.ok(validateItem({ type: "trade", payload: TRADE }).value);
  assert.match(validateItem({ type: "trade", payload: { ...TRADE, teams: ["LAL", "XXX"] } }).error, /teams/);
  assert.match(validateItem({ type: "trade", payload: { ...TRADE, trade: "<script>" } }).error, /trade/);
  assert.match(validateItem({ type: "poll", payload: {} }).error, /type/);
  assert.match(validateItem({ type: "draft", payload: { ...DRAFT, big: "x".repeat(60000) } }).error, /large/);
});

/* The same store contract against PostgreSQL (PG_TEST_URL=postgres://… npm test). */
async function contract(store) {
  await store.init();
  const u = await store.createUser({ username: "pg_user", email: "PG@x.co", passwordHash: "$2a$11$x", favoriteTeam: "BOS" });
  await assert.rejects(store.createUser({ username: "PG_USER", email: "other@x.co", passwordHash: "h" }), /taken/);
  assert.equal((await store.findUserByLogin("pg@x.co")).id, u.id);
  const v = await store.createUser({ username: "pg_two", email: "two@x.co", passwordHash: "h" });
  const it = await store.createItem({ userId: u.id, username: u.username, favoriteTeam: "BOS", type: "trade", title: "t", payloadJson: TRADE, visibility: "public" });
  assert.deepEqual(it.payloadJson.teams, ["LAL", "BKN"]);
  assert.deepEqual(await store.toggleLike(it.id, v.id), { liked: true, likesCount: 1 });
  assert.deepEqual(await store.toggleLike(it.id, v.id), { liked: false, likesCount: 0 });
  assert.equal((await store.listFeed({ sort: "top" }))[0].id, it.id);
  assert.equal((await store.updateItem(it.id, v.id, { visibility: "private" })), null);
  assert.equal((await store.updateItem(it.id, u.id, { visibility: "private" })).visibility, "private");
  assert.equal((await store.listFeed({})).length, 0);
  assert.deepEqual(await store.counts(u.id), { public: 0, private: 1 });
  await store.updateUser(u.id, { favoriteTeam: "NYK" });
  assert.equal((await store.getItem(it.id)).favoriteTeam, "NYK");
  assert.equal(await store.deleteItem(it.id, v.id), false);
  assert.equal(await store.deleteItem(it.id, u.id), true);
  // AI threads: owner-only
  const t = { id: "pgthread01", title: "t", messages: [{ role: "user", text: "q" }], updatedAt: Date.now() };
  assert.ok(await store.upsertThread(u.id, t));
  assert.equal(await store.upsertThread(v.id, { ...t, title: "hijack" }), null);
  assert.deepEqual((await store.listThreads(u.id)).map((x) => x.title), ["t"]);
  assert.deepEqual(await store.listThreads(v.id), []);
  assert.equal(await store.deleteThread(t.id, v.id), false);
  assert.equal(await store.clearThreads(u.id), 1);
  assert.deepEqual(await store.purgeOrphans(), { items: 0, threads: 0 });
}
test("store contract: JSON file", async () => { await contract(createJsonStore(join(dir, "contract.json"))); });
test("store contract: PostgreSQL", { skip: !process.env.PG_TEST_URL && "set PG_TEST_URL to run" }, async () => {
  const s = await createPgStore(process.env.PG_TEST_URL);
  await s.pool.query("DROP TABLE IF EXISTS saved_items; DROP TABLE IF EXISTS users;");
  try { await contract(s); } finally { await s.close(); }
});

const TIERS = { category: "Top 25 NBA Players Right Now", key: "top25", tiers: { S: [{ n: "Shai Gilgeous-Alexander", id: "4278073", t: "OKC" }], A: [{ n: "Nikola Jokic", id: "3112335", t: "DEN" }], B: [], C: [], D: [], F: [] } };
test("tier lists: validation, post to the Community Feed, Tier Lists filter, fetch by id", async () => {
  assert.ok(validateItem({ type: "tierlist", payload: TIERS }).value);
  assert.match(validateItem({ type: "tierlist", payload: { ...TIERS, tiers: { S: [], A: [] } } }).error, /at least one/);
  assert.match(validateItem({ type: "tierlist", payload: { ...TIERS, tiers: { Z: [{ n: "x" }] } } }).error, /S, A, B, C, D, F/);
  assert.match(validateItem({ type: "tierlist", payload: { ...TIERS, category: "" } }).error, /category/);
  assert.match(validateItem({ type: "tierlist", payload: { ...TIERS, tiers: { S: [{ n: 5 }] } } }).error, /tier S/);
  const c = client();
  await c.call("/api/auth/signup", { method: "POST", body: { email: "tiers@x.co", username: "tier_maker", password: "password123" } });
  const it = (await c.call("/api/items", { method: "POST", body: { type: "tierlist", visibility: "public", title: "My tiers", payload: TIERS } })).body.data.item;
  assert.equal(it.type, "tierlist");
  const feed = (await client().call("/api/feed?type=tierlist")).body.data.items;
  assert.deepEqual(feed.map((x) => x.id), [it.id]);
  const got = (await client().call(`/api/items/${it.id}`)).body.data.item;
  assert.equal(got.payloadJson.tiers.S[0].n, "Shai Gilgeous-Alexander");
});
