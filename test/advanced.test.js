import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanced, inMode, teamEfficiency, scheduleStrength } from "../service/advanced.js";
import { monteCarlo, pickGrid, lotteryTable } from "../service/draft.js";
import { normalizeBio, collegeSplits } from "../service/normalize.js";

const picks = JSON.parse(readFileSync(new URL("../draft_picks_2027_2029.json", import.meta.url)));

test("Basketball Reference metrics: TS%, eFG%, AST/TO, Game Score, Per-36 and totals", () => {
  const s = { gp: 10, min: 30, pts: 30, fgm: 10, fga: 20, tpm: 4, tpa: 9, ftm: 6, fta: 8, reb: 10, ast: 8, stl: 2, blk: 1, tov: 4 };
  const a = advanced(s);
  assert.equal(a.ts, Math.round((30 / (2 * (20 + 0.44 * 8))) * 1000) / 1000);
  assert.equal(a.efg, 0.6);                         // (10 + 0.5·4) / 20
  assert.equal(a.astTo, 2);
  assert.equal(a.gmsc, Math.round((30 + 4 - 14 - 0.8 + 4 + 2 + 5.6 + 0.7 - 4) * 10) / 10);
  assert.equal(a.per36.pts, 36);
  assert.equal(inMode(s, "totals").pts, 300);
  assert.equal(inMode(s, "totals").min, 300);
  assert.equal(inMode(s, "per40").reb, 13.3);
  assert.equal(inMode({ ...s, min: 0 }, "per36").pts, 0);
  assert.equal(advanced({ pts: 0 }).ts, null);
});

test("team efficiency ranks ORtg high-to-low and DRtg low-to-high", () => {
  const e = teamEfficiency(
    { A: { gp: 10, pts: 120, fga: 90, oreb: 10, tov: 12, fta: 25 }, B: { gp: 10, pts: 105, fga: 85, oreb: 12, tov: 15, fta: 20 } },
    { A: { oppPpg: 110 }, B: { oppPpg: 100 } });
  assert.equal(e.A.pace, Math.round((90 - 10 + 12 + 11) * 10) / 10);
  assert.equal(e.A.ranks.ortg, 1);
  assert.equal(e.B.ranks.drtg, 1);
  assert.equal(e.A.net, Math.round((e.A.ortg - e.A.drtg) * 10) / 10);
});

test("remaining strength of schedule, L10 and streak", () => {
  const g = (opp, state, result, date) => ({ opponent: { abbr: opp }, state, result, date });
  const out = scheduleStrength({
    A: { games: [g("B", "post", "W", "2026-11-01"), g("B", "post", "W", "2026-11-02"), g("C", "pre", null, "2026-12-01")] },
    B: { games: [g("A", "post", "L", "2026-11-01"), g("A", "pre", null, "2026-12-02"), g("A", "pre", null, "2026-12-03")] },
  }, { A: 0.8, B: 0.2, C: 0.5 });
  assert.equal(out.A.remSos, 0.5); assert.equal(out.A.l10, "2-0"); assert.equal(out.A.streak, "W2");
  assert.equal(out.B.remSos, 0.8); assert.equal(out.B.streak, "L1");
  assert.equal(out.A.sosRank, 1);                   // easier remaining schedule ranks first
});

test("1,000x Monte Carlo agrees with the exact 3-2-1 odds", () => {
  const order = Array.from({ length: 30 }, (_, i) => `T${i}`);
  let seed = 42; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mc = monteCarlo(order, 4000, { format: "321", rng });
  const exact = lotteryTable("321");
  assert.equal(mc.rows.length, 16);
  for (const r of mc.rows) {
    assert.ok(Math.abs(r.p1 - exact[r.seed - 1].p1) < 0.025, `seed ${r.seed} #1 odds`);
    assert.ok(r.top4 >= r.p1 && r.top10 >= r.top4);
    assert.ok(r.mostLikely >= 1 && r.mostLikely <= 16);
    assert.ok(Math.abs(r.dist.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});

test("pick ownership grid", () => {
  const grid = pickGrid(picks, ["DAL", "CHA", "NYK", "BKN", "PHX"]);
  assert.equal(grid.DAL["2027"].status, "protected");
  assert.equal(grid.DAL["2027"].to, "CHA");
  assert.ok(grid.CHA["2027"].holds.includes("DAL"));
  assert.equal(grid.PHX["2028"].status, "own");
  assert.ok(["unprotected", "swap"].includes(grid.NYK["2027"].status));
});

test("bio draft pedigree and college shooting splits", () => {
  const b = normalizeBio({ athlete: { id: "1", displayName: "Luka Doncic", displayDraft: "2018: Rd 1, Pk 3 (ATL)", displayBirthPlace: "Ljubljana, Slovenia", displayHeight: "6' 8\"", age: 27, displayExperience: "9th Season" } });
  assert.deepEqual([b.draft.year, b.draft.pick, b.draft.overall, b.draft.team, b.country], [2018, 3, 3, "ATL", "Slovenia"]);
  assert.equal(normalizeBio({ athlete: { displayDraft: "2020: Rd 2, Pk 5 (NY)" } }).draft.overall, 35);
  assert.equal(normalizeBio({ athlete: {} }).draft.text, "Undrafted");
  const sp = collegeSplits({ categories: [{ name: "averages", names: ["avgFieldGoalsMade-avgFieldGoalsAttempted", "avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted", "avgFreeThrowsMade-avgFreeThrowsAttempted", "avgTurnovers"],
    statistics: [{ season: { displayName: "2026-27" }, stats: ["5.0-10.3", "1.7-4.0", "3.7-5.7", "2.3"] }] }] }, "2026-27");
  assert.deepEqual([sp.fgm, sp.fga, sp.tpm, sp.fta, sp.tov], [5, 10.3, 1.7, 5.7, 2.3]);
});
