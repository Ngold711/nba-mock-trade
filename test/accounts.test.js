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
}
test("store contract: JSON file", async () => { await contract(createJsonStore(join(dir, "contract.json"))); });
test("store contract: PostgreSQL", { skip: !process.env.PG_TEST_URL && "set PG_TEST_URL to run" }, async () => {
  const s = await createPgStore(process.env.PG_TEST_URL);
  await s.pool.query("DROP TABLE IF EXISTS saved_items; DROP TABLE IF EXISTS users;");
  try { await contract(s); } finally { await s.close(); }
});
