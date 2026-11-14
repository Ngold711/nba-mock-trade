import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, scoreboardTtl, TTL } from "../service/store.js";

const game = (state, date = "2026-11-14T00:00Z") => ({ id: "1", date, status: { state } });

test("scoreboard cadence: 20s live, 30s near tip, sleeps until ~10 min before tip, idle otherwise", () => {
  const now = Date.parse("2026-11-14T20:00:00Z");
  assert.equal(scoreboardTtl({ games: [game("in"), game("post")] }, now), TTL.live);
  assert.equal(scoreboardTtl({ games: [game("pre", "2026-11-14T20:10:00Z")] }, now), TTL.pregame);
  assert.equal(scoreboardTtl({ games: [game("pre", "2026-11-14T19:50:00Z")] }, now), TTL.pregame); // late tip
  assert.equal(scoreboardTtl({ games: [game("pre", "2026-11-14T20:40:00Z")] }, now), 15 * 60e3);   // capped at idle
  assert.equal(scoreboardTtl({ games: [game("pre", "2026-11-14T20:22:00Z")] }, now), 12 * 60e3);
  assert.equal(scoreboardTtl({ games: [game("post")] }, now), TTL.idle);
  assert.ok(TTL.live >= 15e3 && TTL.live <= 30e3);
  assert.ok(TTL.injuries >= 15 * 60e3 && TTL.roster <= 60 * 60e3);
});

function harness(loader) {
  let t = 0;
  const timers = [];
  let calls = 0;
  const store = createStore({
    now: () => t,
    jitter: () => 1,
    setTimer: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    load: async (r, p) => { calls++; return loader(r, p, calls); },
  });
  return {
    store,
    get calls() { return calls; },
    advance: async (ms) => {
      await new Promise((r) => setImmediate(r));   // let pending refresh → schedule chains settle
      t += ms;
      for (const h of [...timers].sort((a, b) => a.at - b.at)) {
        if (h.at <= t) { timers.splice(timers.indexOf(h), 1); await h.fn(); }
      }
    },
    timers,
  };
}

test("caches slow data by TTL and dedupes concurrent requests", async () => {
  const h = harness(() => ["standings"]);
  await Promise.all([h.store.get("standings"), h.store.get("standings"), h.store.get("standings")]);
  assert.equal(h.calls, 1);
  await h.advance(TTL.standings - 1000);
  await h.store.get("standings");
  assert.equal(h.calls, 1);
  await h.advance(2000);
  const { meta } = await h.store.get("standings");
  assert.equal(h.calls, 2);
  assert.equal(meta.stale, false);
});

test("serves stale data on ESPN failure and backs off instead of hammering", async () => {
  const h = harness((r, p, n) => { if (n > 1) throw new Error("ESPN responded 503"); return { games: [] }; });
  await h.store.get("scoreboard");
  await h.advance(TTL.idle + 1);
  const r1 = await h.store.get("scoreboard");
  assert.deepEqual(r1.data, { games: [] });
  assert.equal(r1.meta.stale, true);
  assert.match(r1.meta.error, /503/);
  await h.store.get("scoreboard");                      // inside backoff window: no new request
  assert.equal(h.calls, 2);
  await h.advance(r1.meta.refreshInMs + 1);
  await h.store.get("scoreboard");
  assert.equal(h.calls, 3);
});

test("throws only when there has never been data", async () => {
  const h = harness(() => { throw new Error("offline"); });
  await assert.rejects(h.store.get("injuries"), /offline/);
});

test("watch polls live scoreboards every ~20s and stops when unsubscribed", async () => {
  const h = harness(() => ({ games: [game("in")] }));
  const seen = [];
  const stop = h.store.watch("scoreboard", {}, (d, m) => seen.push(m.refreshInMs));
  await h.advance(0);
  assert.equal(h.calls, 1);
  await h.advance(TTL.live);
  await h.advance(TTL.live);
  assert.equal(h.calls, 3);
  stop();
  assert.equal(h.timers.length, 0);
  await h.advance(TTL.live * 5);
  assert.equal(h.calls, 3);
  assert.ok(seen.length >= 3);
});
