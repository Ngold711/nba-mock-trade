import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPool, emptyConf, addToBallot, removeFromBallot, slotOf, filled, allIds, migrateBallot, modelConf, groupOf, STARTER_SLOTS } from "../service/allstar.js";
import { normalizePlayerStats } from "../service/normalize.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
// data.js assigns window.NBA_DATA; evaluate it with a stub window
const snapshot = (() => { const window = {}; new Function("window", readFileSync(new URL("../data.js", import.meta.url), "utf8"))(window); return window.NBA_DATA.teams; })();

const pl = (id, group, conf = "East") => ({ id: String(id), name: `P${id}`, group, conf });

test("pool is never empty: stats → rosters → snapshot", () => {
  const stats = normalizePlayerStats(fx("players"));
  const a = buildPool({ players: stats });
  assert.equal(a.source, "stats");
  assert.ok(a.pool.length > 0 && a.pool.every((p) => p.conf === "East" || p.conf === "West"));
  assert.ok(a.pool[0].stats && a.pool[0].stats.pts > 0);

  const league = { teams: { BOS: { name: "Celtics", color: "#007A33" } }, players: [{ id: "1", name: "Roster Guy", teamAbbr: "BOS", position: "G", headshot: "h.png" }] };
  const b = buildPool({ league });
  assert.equal(b.source, "rosters");
  assert.equal(b.pool[0].conf, "East");
  assert.equal(b.pool[0].stats, null);

  const c = buildPool({ snapshot });
  assert.equal(c.source, "snapshot");
  assert.ok(c.pool.length > 200);
  assert.ok(c.counts.east > 100 && c.counts.west > 100);

  const d = buildPool({});                 // nothing at all → empty, but the page always passes the snapshot
  assert.equal(d.pool.length, 0);
});

test("stats merge onto roster players by ESPN id; conference without standings", () => {
  const stats = normalizePlayerStats(fx("players"));
  const luka = stats.players.find((p) => p.name === "Luka Doncic");
  const league = { teams: {}, players: [{ id: luka.id, name: "Luka Doncic", teamAbbr: "LAL", position: "G" }, { id: "999", name: "Injured Star", teamAbbr: "IND", position: "G" }] };
  const { pool } = buildPool({ players: stats, league });
  assert.equal(pool.find((p) => p.id === luka.id).stats.pts, 38.6);
  assert.equal(pool.find((p) => p.id === luka.id).conf, "West");
  assert.ok(pool.find((p) => p.id === "999"), "players with no games yet are still votable");
});

test("one-tap voting fills starter (by position) → reserve → honorable mention", () => {
  const c = emptyConf();
  assert.deepEqual(STARTER_SLOTS, ["G", "G", "FC", "FC", "FC"]);
  assert.deepEqual(addToBallot(c, pl(1, "G")).where, { kind: "starters", i: 0 });
  assert.deepEqual(addToBallot(c, pl(2, "FC")).where, { kind: "starters", i: 2 });
  assert.deepEqual(addToBallot(c, pl(3, "G")).where, { kind: "starters", i: 1 });
  assert.deepEqual(addToBallot(c, pl(4, "G")).where, { kind: "reserves", i: 0 });   // guard slots full
  for (let k = 5; k < 9; k++) addToBallot(c, pl(k, "FC"));
  for (let k = 9; k < 13; k++) addToBallot(c, pl(k, "G"));                         // last 4 reserve slots
  assert.equal(filled(c), 12);
  assert.deepEqual(addToBallot(c, pl(15, "G")).where, { kind: "hm", i: 0 });
  addToBallot(c, pl(16, "G")); addToBallot(c, pl(17, "G"));
  const full = addToBallot(c, pl(18, "G"));
  assert.equal(full.ok, false);
  assert.match(full.reason, /full/);
  assert.equal(addToBallot(c, pl(1, "G")).ok, false);                               // no duplicates
});

test("targeted slots, swaps, removal and captain", () => {
  const c = emptyConf();
  assert.equal(addToBallot(c, pl(1, "FC"), { kind: "starters", i: 0 }).ok, false);  // guard slot rejects a big
  assert.equal(addToBallot(c, pl(1, "G"), { kind: "starters", i: 0 }).ok, true);
  c.captain = "1";
  const swap = addToBallot(c, pl(2, "G"), { kind: "starters", i: 0 });
  assert.equal(swap.replaced, "1");
  assert.equal(c.captain, null);                                                    // swapped-out captain cleared
  assert.equal(addToBallot(c, pl(3, "FC"), { kind: "hm", i: 2 }).ok, true);
  assert.deepEqual(slotOf(c, "3"), { kind: "hm", i: 2 });
  assert.equal(removeFromBallot(c, "3"), true);
  assert.equal(slotOf(c, "3"), null);
  assert.deepEqual(allIds(c), ["2"]);
});

test("v1 ballots migrate to fixed slots; model ballot respects the 2G/3FC rule", () => {
  const m = migrateBallot({ East: { starters: ["a", "b", "c", "d", "e"], reserves: ["f", "g"], captain: "a" }, West: { starters: [], reserves: [] } });
  assert.deepEqual(m.East.starters, ["a", "b", "c", "d", "e"]);
  assert.equal(m.East.reserves.length, 7);
  assert.equal(m.East.hm.length, 3);
  assert.equal(m.East.captain, "a");
  assert.equal(migrateBallot(m), m);
  const pool = [...Array(20)].map((_, k) => ({ id: String(k), name: `P${k}`, conf: "East", group: k % 2 ? "G" : "FC", stats: { pts: 30 - k }, position: k % 2 ? "G" : "F" }));
  const mc = modelConf("East", pool, null);
  assert.equal(mc.starters.filter(Boolean).length, 5);
  assert.deepEqual(mc.starters.map((id) => pool[+id].group), ["G", "G", "FC", "FC", "FC"]);
  assert.equal(mc.reserves.filter(Boolean).length, 7);
  assert.equal(mc.hm.filter(Boolean).length, 3);
  assert.equal(groupOf("PG"), "G"); assert.equal(groupOf("F"), "FC"); assert.equal(groupOf("G/F"), "G");
});
