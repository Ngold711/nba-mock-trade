import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRatings, SEEDS, tierOf } from "../service/ratings.js";
import { normalizeSchedule, normalizeSummary } from "../service/normalize.js";
import { scanHonors, POW } from "../ui/awards-extra.js";

const stat = (pts, extra = {}) => ({ gp: 10, min: 30, pts, reb: 5, ast: 4, stl: 1, blk: 0.5, tov: 2, fgm: pts / 2.2, fga: pts / 1.1, ftm: 3, fta: 4, fgPct: 47, threePct: 36, ftPct: 80, tpm: 2, ...extra });

test("2K27 ratings: official OVRs only, nothing estimated from stats", () => {
  const league = { players: [
    { id: "1", name: "Luka Dončić", teamAbbr: "LAL", position: "G" },
    { id: "1", name: "Luka Dončić", teamAbbr: "LAL", position: "G" },                 // duplicate roster row
    { id: "2", name: "Cooper Flagg", teamAbbr: "DAL", position: "F" },
    ...Array.from({ length: 40 }, (_, i) => ({ id: String(100 + i), name: `Player ${i}`, teamAbbr: "BOS", position: "G" })),
  ], teams: { OKC: { displayName: "Oklahoma City Thunder", color: "#007ac1", logo: "x" } } };
  const players = { players: league.players.map((p) => ({ ...p, stats: stat(20) })) };
  const r = buildRatings({ players, league });                               // bundled official snapshot
  assert.deepEqual(r.players.map((p) => p.name), ["Luka Dončić", "Cooper Flagg"]);
  const luka = r.players[0];
  assert.equal(luka.ovr, SEEDS.find(([n]) => n === "Luka Doncic")[1]);
  assert.equal(luka.delta, 1); assert.equal(luka.official, true); assert.equal(luka.estimated, false);
  assert.equal(luka.attrs, null, "no stat-model attributes");
  assert.deepEqual(r.teams, [], "no estimated team ratings");
  assert.equal(r.coverage.official, 2); assert.equal(r.coverage.roster, 42);
  // a synced feed with attributes and team ratings
  const feed = { source: "Official feed", syncedAt: "2026-11-16T03:00:00.000Z", players: [{ name: "Player 3", ovr: 81, delta: -2, attributes: { threePt: 88 }, badges: 12 }],
    teams: [{ team: "Oklahoma City Thunder", ovr: 95, offense: 94, defense: 97 }] };
  const f = buildRatings({ players, league, feed });
  assert.deepEqual(f.players.map((p) => [p.name, p.ovr, p.delta, p.badges]), [["Player 3", 81, -2, 12]]);
  assert.equal(f.players[0].attrs.threePt, 88);
  assert.equal(f.syncedAt, feed.syncedAt);
  assert.deepEqual(f.teams.map((t) => [t.abbr, t.overall, t.defense]), [["OKC", 95, 97]]);
  assert.equal(tierOf(97), "gal"); assert.equal(tierOf(91), "dia"); assert.equal(tierOf(86), "ame"); assert.equal(tierOf(81), "rub"); assert.equal(tierOf(70), "base");
});

test("official ratings sync: cross-check merge, last verified copy on failure, snapshot before first sync", async () => {
  const { mergeFeeds, syncRatings } = await import("../service/ratings2k.js");
  const A = { source: "2K", players: [{ name: "Nikola Jokic", ovr: 96, delta: 0 }, { name: "Jalen Brunson", ovr: 95, delta: 0 }] };
  const B = { source: "2KRatings", players: [{ name: "Nikola Jokić", ovr: 95, delta: 0 }, { name: "Cooper Flagg", ovr: 90, delta: 3 }] };
  const m = mergeFeeds(A, B);
  assert.deepEqual(m.feed.players.map((p) => `${p.name} ${p.ovr}`), ["Nikola Jokic 96", "Jalen Brunson 95", "Cooper Flagg 90"]);
  assert.deepEqual(m.conflicts, [{ name: "Nikola Jokic", primary: 96, secondary: 95 }]);
  const disk = new Map();
  const io = { mkdir: async () => {}, writeFile: async (f, t) => disk.set(String(f), t), readFile: async (f) => { if (!disk.has(String(f))) throw new Error("ENOENT"); return disk.get(String(f)); } };
  disk.set("snap", JSON.stringify({ asOf: "2026-11-15", source: "bundled", players: [{ name: "Luka Doncic", ovr: 97 }] }));
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: `P ${i}`, ovr: 70 + (i % 20) }));
  const ok = async () => ({ ok: true, json: async () => ({ source: "Official", players: rows(12) }) });
  const bad = async () => { throw new Error("offline"); };
  const opts = { io, cacheFile: "cache", cacheDir: "dir", snapshotFile: "snap", now: () => new Date("2026-11-16T03:00:00Z") };
  assert.equal((await syncRatings({ ...opts, env: {} })).source, "bundled");            // no feed configured yet
  const live = await syncRatings({ ...opts, env: { RATINGS_FEED_URL: "u" }, fetchImpl: ok });
  assert.equal(live.players.length, 12); assert.equal(live.syncedAt, "2026-11-16T03:00:00.000Z");
  const kept = await syncRatings({ ...opts, env: { RATINGS_FEED_URL: "u" }, fetchImpl: bad, now: () => new Date("2026-11-16T03:30:00Z") });
  assert.equal(kept.players.length, 12, "upstream failure keeps the last verified sync");
  assert.equal(kept.syncedAt, "2026-11-16T03:00:00.000Z");
});

test("lineups: box-score starters, five-slot positions, injured starter swaps back the night he starts", async () => {
  const { resolveLineups, primaryPosition, depthSlots, boxStarters, lastCompleted } = await import("../service/lineups.js");
  const ath = (id, n) => ({ id, displayName: n });
  const depth = (rows) => ({ depthchart: [{ positions: Object.fromEntries(rows.map(([k, list]) => [k, { athletes: list }])) }] });
  const D = depth([["pg", [ath("1", "Pg One")]], ["sg", [ath("2", "Sg Two"), ath("6", "Bench Six")]], ["sf", [ath("3", "Sf Three")]], ["pf", [ath("4", "Caleb Wilson"), ath("7", "Fill In")]], ["c", [ath("5", "Big Five")]]]);
  const league = { players: [["1", "G"], ["2", "G"], ["3", "F"], ["4", "F"], ["5", "C"], ["6", "G"], ["7", "F"]].map(([id, pos]) => ({ id, name: `P${id}`, teamAbbr: "CHA", position: pos })) };
  const box = (ids) => ({ boxscore: { players: [{ team: { abbreviation: "CHA" }, statistics: [{ athletes: ids.map(([id, g]) => ({ starter: true, athlete: { id, displayName: `P${id}`, position: { abbreviation: g } } })) }] }] } });
  // Caleb Wilson (4) out: the fill-in (7) starts and holds the PF spot
  const out = resolveLineups({ league, teams: [{ team: { abbr: "CHA" }, depth: D, lastGame: { id: "g1" }, starters: boxStarters(box([["1", "G"], ["2", "G"], ["3", "F"], ["7", "F"], ["5", "C"]]), "CHA") }] });
  assert.deepEqual(["PG", "SG", "SF", "PF", "C"].map((s) => out.teams.CHA[s].id), ["1", "2", "3", "7", "5"]);
  // the night he starts again, he's back
  const back = resolveLineups({ league, teams: [{ team: { abbr: "CHA" }, depth: D, lastGame: { id: "g2" }, starters: boxStarters(box([["4", "F"], ["1", "G"], ["5", "C"], ["3", "F"], ["2", "G"]]), "CHA") }] });
  assert.equal(back.teams.CHA.PF.id, "4"); assert.equal(back.positions.PF[0].name, "P4");
  // no box score yet → depth chart #1s
  const pre = resolveLineups({ league, teams: [{ team: { abbr: "CHA" }, depth: D, lastGame: null, starters: null }] });
  assert.equal(pre.teams.CHA.from, "depth"); assert.equal(pre.teams.CHA.PF.id, "4");
  // positions: official 2K position > depth chart > group + stats
  assert.equal(primaryPosition({ group: "G", official: "SF", depth: { slot: "SG" } }).pos, "SF");
  assert.equal(primaryPosition({ group: "G", depth: { slot: "SG" } }).pos, "SG");
  assert.equal(primaryPosition({ group: "F", depth: { slot: "SG" } }).pos, "SF", "a roster forward listed at SG (Michael Porter Jr.) is a SF");
  assert.equal(primaryPosition({ group: "G", depth: { slot: "SF" } }).pos, "SF", "a G-listed wing keeps his depth-chart slot");
  assert.equal(primaryPosition({ group: "F", depth: { slot: "C" } }).pos, "C");
  assert.equal(primaryPosition({ group: "G", stats: { ast: 8, pts: 18 } }).pos, "PG");
  assert.equal(primaryPosition({ group: "F", stats: { reb: 9 } }).pos, "PF");
  assert.deepEqual(depthSlots(D)["6"], { slot: "SG", rank: 1 });
  assert.equal(lastCompleted({ events: [{ id: "a", date: "2026-11-10T00:00Z", competitions: [{ status: { type: { completed: true } } }] }, { id: "b", date: "2026-11-12T00:00Z", competitions: [{ status: { type: { completed: true } } }] }, { id: "c", date: "2026-11-14T00:00Z", competitions: [{ status: { type: { completed: false } } }] }] }).id, "b");
  const all = Object.values(back.positions).flat().map((p) => p.id);
  assert.equal(all.length, new Set(all).size);
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
