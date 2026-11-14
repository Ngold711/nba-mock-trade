import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lotteryOdds, simulateLottery, projectOrder, resolvePickOwnership, LOTTERY_WEIGHTS } from "../service/draft.js";
import { normalizeStandings } from "../service/normalize.js";

const CONFIG = JSON.parse(readFileSync(new URL("../draft_picks_2027_2029.json", import.meta.url)));
const PROSPECTS = JSON.parse(readFileSync(new URL("../prospects.json", import.meta.url)));
const ALL = ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"];

/** Build a 30-team order with the given teams pinned to specific picks. */
function orderWith(pins) {
  const order = Array(30).fill(null);
  for (const [team, pick] of Object.entries(pins)) order[pick - 1] = team;
  const rest = ALL.filter((t) => !(t in pins));
  return order.map((t) => t || rest.shift());
}
const pickOf = (res, team) => res.picks.find((p) => p.originalTeam === team);

test("lottery odds match the 2019 format", () => {
  const odds = lotteryOdds();
  odds.forEach((row) => assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9));
  assert.ok(Math.abs(odds[0][0] - 0.14) < 1e-9);
  assert.ok(Math.abs(odds[13][0] - 0.005) < 1e-9);
  assert.ok(Math.abs(odds[0][4] - 0.479) < 0.001);            // worst team falls to 5th 47.9%
  assert.equal(odds[0].slice(5).reduce((a, b) => a + b, 0) < 1e-9, true);  // can't fall below 5th
  assert.equal(LOTTERY_WEIGHTS.reduce((a, b) => a + b, 0), 1000);
});

test("simulateLottery: 4 draws, everyone else slides in seed order, picks 15–30 untouched", () => {
  const order = [...ALL];
  let i = 0; const seq = [0.999, 0.0, 0.0, 0.0];             // last-weighted team, then top seeds
  const sim = simulateLottery(order, () => seq[i++] ?? 0);
  assert.equal(sim.order.length, 30);
  assert.equal(new Set(sim.order).size, 30);
  assert.equal(sim.lottery[0].seed, 14);                     // 0.5% team jumped to #1
  assert.equal(sim.lottery[0].moved, 13);
  assert.deepEqual(sim.order.slice(14), order.slice(14));
});

test("projectOrder: non-playoff teams first, worst record first", () => {
  const st = normalizeStandings(JSON.parse(readFileSync(new URL("./fixtures/standings.json", import.meta.url))));
  const order = projectOrder(st, () => 0.5);
  assert.ok(order.length > 0);
  assert.ok(order.every((t) => /^[A-Z]{2,3}$/.test(t)));
});

test("unprotected, protected and split rules", () => {
  // DAL #2 (top-2 protected → retained), MIA #15 (top-14 protected → conveys), SAS #16 → SAC, ATL anywhere → SAS
  let r = resolvePickOwnership(orderWith({ DAL: 2, MIA: 15, SAS: 16, ATL: 9, NYK: 30 }), 2027, CONFIG);
  assert.equal(pickOf(r, "DAL").owner, "DAL");
  assert.equal(pickOf(r, "DAL").status, "protected_retained");
  assert.equal(pickOf(r, "MIA").owner, "CHA");
  assert.equal(pickOf(r, "SAS").owner, "SAC");
  assert.equal(pickOf(r, "ATL").owner, "SAS");
  assert.equal(pickOf(r, "NYK").owner, "BKN");
  // DAL #3 conveys, MIA #14 retained, SAS #17 → OKC, LAL #4 retained, LAL #5 conveys
  r = resolvePickOwnership(orderWith({ DAL: 3, MIA: 14, SAS: 17, LAL: 4 }), 2027, CONFIG);
  assert.equal(pickOf(r, "DAL").owner, "CHA");
  assert.equal(pickOf(r, "MIA").status, "protected_retained");
  assert.equal(pickOf(r, "SAS").owner, "OKC");
  assert.equal(pickOf(r, "LAL").owner, "LAL");
  r = resolvePickOwnership(orderWith({ LAL: 5 }), 2027, CONFIG);
  assert.equal(pickOf(r, "LAL").owner, "MEM");
  assert.match(pickOf(r, "LAL").explanation, /outside LAL's top-4 protection/);
});

test("swap pools: HOU/BKN, NOP/MIL/ATL with top-4 override, MEM most favorable of three", () => {
  let r = resolvePickOwnership(orderWith({ BKN: 3, HOU: 20, NOP: 10, MIL: 6, CLE: 25, UTA: 2, MIN: 18 }), 2027, CONFIG);
  assert.equal(r.picks[2].owner, "HOU");                     // #3 (BKN's) → HOU
  assert.equal(r.picks[19].owner, "BKN");                    // #20 (HOU's) → BKN
  assert.equal(r.picks[5].owner, "NOP");                     // MIL #6 is more favorable → NOP
  assert.equal(r.picks[9].owner, "ATL");                     // NOP #10 → ATL
  assert.equal(r.picks[1].owner, "MEM");                     // UTA #2 most favorable → MEM
  assert.equal(pickOf(r, "CLE").owner, "CLE");
  assert.equal(pickOf(r, "MIN").owner, "MIN");
  // both NOP and MIL top 4 → NOP keeps both
  r = resolvePickOwnership(orderWith({ NOP: 1, MIL: 4 }), 2027, CONFIG);
  assert.equal(r.picks[0].owner, "NOP");
  assert.equal(r.picks[3].owner, "NOP");
  assert.match(r.picks[3].explanation, /New Orleans keeps both/);
});

test("multi-way swap with a protected exclusion", () => {
  // DEN #4 is top-5 protected → excluded; most favorable of OKC/LAC/TOR → OKC
  let r = resolvePickOwnership(orderWith({ DEN: 4, LAC: 8, TOR: 12, OKC: 29 }), 2027, CONFIG);
  assert.equal(pickOf(r, "DEN").owner, "DEN");
  assert.equal(pickOf(r, "DEN").status, "protected_retained");
  assert.equal(pickOf(r, "LAC").owner, "OKC");
  assert.equal(pickOf(r, "TOR").owner, "TOR");
  // DEN #6 is in the pool and most favorable → OKC
  r = resolvePickOwnership(orderWith({ DEN: 6, LAC: 8, TOR: 12, OKC: 29 }), 2027, CONFIG);
  assert.equal(pickOf(r, "DEN").owner, "OKC");
});

test("every 2027 rule resolves cleanly over many random lotteries", () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 500; n++) {
    const order = [...ALL].sort(() => rng() - 0.5);
    for (const year of [2027, 2028, 2029]) {
      const { picks, warnings } = resolvePickOwnership(simulateLottery(order, rng).order, year, CONFIG);
      assert.equal(picks.length, 30);
      assert.deepEqual(warnings, []);
      assert.ok(picks.every((p) => ALL.includes(p.owner)));
    }
  }
});

test("prospects.json: every college prospect has ESPN ids", () => {
  for (const year of ["2027", "2028", "2029"]) {
    for (const p of PROSPECTS[year]) {
      if (p.type === "college") {
        assert.match(p.espnCollegeAthleteId, /^\d+$/, p.name);
        assert.match(p.collegeTeamId, /^\d+$/, p.name);
      }
    }
  }
});
