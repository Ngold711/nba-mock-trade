// End-to-end through the HTTP server with ESPN stubbed by the captured fixtures.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.QUIET = "1";
const fx = (n) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
const realFetch = globalThis.fetch;
let espnCalls = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes("espn.com")) return realFetch(url, opts);
  espnCalls++;
  const name = u.includes("/scoreboard") ? "scoreboard" : u.includes("/summary") ? "summary" : u.includes("/roster") ? "roster"
    : u.includes("/injuries") ? "injuries" : u.includes("/standings") ? "standings" : u.includes("/transactions") ? "transactions" : "teams";
  return new Response(fx(name), { status: 200, headers: { "content-type": "application/json" } });
};

const { server } = await import("../server.js");
let base;
before(() => new Promise((r) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); globalThis.fetch = realFetch; });
const getJson = async (p) => { const res = await fetch(base + p); return { status: res.status, body: await res.json() }; };

test("api routes return normalized data with cache meta", async () => {
  const sb = await getJson("/api/scoreboard");
  assert.equal(sb.status, 200);
  assert.equal(sb.body.data.games[0].home.abbr, "IND");
  assert.ok(sb.body.meta.refreshInMs > 0);

  const game = await getJson("/api/games/401909296");
  assert.equal(game.body.data.teams.length, 2);

  const roster = await getJson("/api/rosters/LAL");              // abbreviation resolved via /teams
  assert.equal(roster.body.data.team.abbr, "LAL");
  const gsw = await getJson("/api/rosters/GSW");                 // common alias → ESPN "GS"
  assert.equal(gsw.status, 200);

  const inj = await getJson("/api/injuries?team=ATL");
  assert.ok(inj.body.data.every((i) => i.team.abbr === "ATL"));

  assert.equal((await getJson("/api/standings")).body.data.conferences.length, 2);
  assert.ok((await getJson("/api/transactions")).body.data.length > 0);
});

test("repeat requests are served from cache", async () => {
  const before = espnCalls;
  await getJson("/api/standings");
  await getJson("/api/standings");
  await getJson("/api/scoreboard");
  assert.equal(espnCalls, before);
});

test("validation and static safety", async () => {
  assert.equal((await getJson("/api/scoreboard?date=nope")).status, 400);
  assert.equal((await getJson("/api/rosters/ZZZ")).status, 404);
  assert.equal((await getJson("/api/nope")).status, 404);
  assert.equal((await fetch(base + "/%2e%2e/%2e%2e/etc/passwd")).status, 404);
  assert.equal((await fetch(base + "/package.json")).status, 404);
  assert.equal((await fetch(base + "/server.js")).status, 404);
  assert.equal((await fetch(base + "/service/normalize.js")).status, 200);   // browser fallback needs it
  assert.equal((await fetch(base + "/test/store.test.js")).status, 404);
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Mock Trade/);
});
