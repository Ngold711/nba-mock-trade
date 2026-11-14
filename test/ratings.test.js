import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRatings, SEEDS, tierOf, ovrFromPct } from "../service/ratings.js";
import { normalizeSchedule, normalizeSummary } from "../service/normalize.js";
import { scanHonors, POW } from "../ui/awards-extra.js";

const stat = (pts, extra = {}) => ({ gp: 10, min: 30, pts, reb: 5, ast: 4, stl: 1, blk: 0.5, tov: 2, fgm: pts / 2.2, fga: pts / 1.1, ftm: 3, fta: 4, fgPct: 47, threePct: 36, ftPct: 80, tpm: 2, ...extra });

test("2K27 ratings: seeds keep the official OVR, everyone else is rated from stats", () => {
  const players = { players: [
    { id: "1", name: "Luka Dončić", teamAbbr: "LAL", position: "G", stats: stat(30) },
    ...Array.from({ length: 60 }, (_, i) => ({ id: String(100 + i), name: `Player ${i}`, teamAbbr: i % 2 ? "BOS" : "LAL", position: ["G", "F", "C"][i % 3], stats: stat(4 + i * 0.4) })),
  ] };
  const r = buildRatings({ players });
  const luka = r.players.find((p) => p.id === "1");
  assert.equal(luka.ovr, SEEDS.find(([n]) => n === "Luka Doncic")[1]);
  assert.equal(luka.delta, 1);
  assert.equal(luka.seeded, true);
  const est = r.players.filter((p) => !p.seeded);
  assert.ok(est.every((p) => p.ovr >= 55 && p.ovr <= 93), "estimates stay below the seeded superstar tier");
  assert.ok(est[0].ovr > est.at(-1).ovr);
  for (const p of r.players) for (const v of Object.values(p.attrs)) assert.ok(v >= 25 && v <= 99);
  assert.ok(["PG", "SG", "SF", "PF", "C"].includes(est[0].pos));
  assert.equal(r.teams.length, 2);
  assert.ok(r.teams.every((t) => t.overall >= 65 && t.overall <= 99));
  assert.equal(tierOf(97), "gal"); assert.equal(tierOf(91), "dia"); assert.equal(tierOf(86), "ame"); assert.equal(tierOf(81), "rub"); assert.equal(tierOf(70), "base");
  assert.equal(ovrFromPct(1), 93); assert.equal(ovrFromPct(0.5), 74);
});

test("team schedule and game summary extras normalize", () => {
  const sched = normalizeSchedule({ team: { id: "13", abbreviation: "LAL" }, events: [
    { id: "1", date: "2026-10-22T02:00Z", competitions: [{ status: { type: { completed: true, state: "post" } }, competitors: [
      { homeAway: "home", winner: true, score: { value: 127 }, team: { id: "13", abbreviation: "LAL" } }, { homeAway: "away", winner: false, score: { value: 105 }, team: { id: "9", abbreviation: "GS", shortDisplayName: "Warriors" } }] }] },
    { id: "2", date: "2026-11-15T21:00Z", competitions: [{ status: { type: { completed: false, state: "pre" } }, competitors: [
      { homeAway: "away", team: { id: "13", abbreviation: "LAL" } }, { homeAway: "home", team: { id: "21", abbreviation: "PHX" } }] }] }] });
  assert.deepEqual([sched.games[0].result, sched.games[0].score, sched.games[0].home, sched.games[0].opponent.abbr], ["W", "127-105", true, "GS"]);
  assert.equal(sched.games[1].result, null); assert.equal(sched.games[1].home, false);
  const sum = normalizeSummary({ header: { id: "9", competitions: [{ competitors: [{ homeAway: "away", linescores: [{ displayValue: "30" }, { displayValue: "25" }] }, { homeAway: "home", linescores: [{ displayValue: "20" }] }] }] },
    boxscore: { teams: [{ homeAway: "away", team: { id: "1" }, statistics: [{ name: "fieldGoalPct", displayValue: "48" }, { name: "pointsInPaint", displayValue: "50" }] }] } });
  assert.deepEqual(sum.linescore, { away: [30, 25], home: [20] });
  assert.equal(sum.teamStats[0].stats.pointsInPaint, "50");
  assert.deepEqual(normalizeSummary({}).linescore, { away: [], home: [] });
});

test("weekly honors: seeded weeks and Player of the Week headlines from ESPN news", () => {
  assert.deepEqual(POW.map((w) => w.week), [3, 2, 1]);
  const players = [{ name: "Jalen Brunson", teamAbbr: "NY", conference: "East" }, { name: "Luka Doncic", teamAbbr: "LAL", conference: "West" }];
  const { items, parsed } = scanHonors([
    { headline: "Brunson, Doncic named NBA Players of the Week", description: "Jalen Brunson and Luka Doncic earned the honor.", published: "2026-11-16T18:00Z" },
    { headline: "Trade rumors roundup", description: "" },
  ], players);
  assert.equal(items.length, 1);
  assert.deepEqual(parsed[0].east, ["Jalen Brunson", "NY"]);
  assert.deepEqual(parsed[0].west, ["Luka Doncic", "LAL"]);
});
