import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWire, relativeTime, WIRE_FILTERS } from "../service/wire.js";
import { computeAwards, projectedGames, production, RULE_GAMES, ruleStatus } from "../service/awards.js";
import { normalizeNews, normalizePlayerStats, normalizeTransactions, normalizeInjuries, normalizeScoreboard } from "../service/normalize.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));

test("news + player stats normalizers on real ESPN payloads", () => {
  const news = normalizeNews(fx("news"));
  assert.equal(news.length, 4);
  assert.ok(news[0].headline && news[0].url.startsWith("https://"));
  const { season, players } = normalizePlayerStats(fx("players"));
  assert.equal(season, 2027);
  const luka = players.find((p) => p.name === "Luka Doncic");
  assert.equal(luka.teamAbbr, "LAL");
  assert.equal(luka.stats.gp, 11);
  assert.equal(luka.stats.pts, 38.6);
  assert.ok(luka.stats.fga > 0 && luka.stats.stl > 0);
  assert.match(luka.headshot, /3945274\.png$/);
  assert.doesNotThrow(() => normalizePlayerStats({}));
  assert.doesNotThrow(() => normalizeNews(null));
});

test("buildWire merges all four feeds, caps each, newest first, tags and tones", () => {
  const items = buildWire({
    news: normalizeNews(fx("news")),
    transactions: normalizeTransactions(fx("transactions")),
    injuries: normalizeInjuries(fx("injuries")),
    scoreboard: normalizeScoreboard(fx("scoreboard")),
  }, { now: Date.parse("2026-11-14T12:00:00Z"), perKind: 3 });
  const tags = new Set(items.map((i) => i.tag));
  for (const t of ["NEWS", "INJURY", "FINAL"]) assert.ok(tags.has(t), t);
  assert.ok(items.some((i) => ["TRADE", "SIGNING", "MOVE"].includes(i.tag)));
  assert.ok(items.filter((i) => i.kind === "news").length <= 3);
  assert.ok(items.filter((i) => i.kind === "injury").length <= 3);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].time >= items[i].time);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.ok(items.filter(WIRE_FILTERS.scores).every((i) => i.gameId));
  assert.ok(items.filter((i) => i.tag === "INJURY").every((i) => ["red", "amber"].includes(i.tone)));
  assert.deepEqual(buildWire({}), []);
});

test("relativeTime", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  assert.equal(relativeTime(now - 10e3, now), "now");
  assert.equal(relativeTime(now - 120e3, now), "2m ago");
  assert.equal(relativeTime(now - 3 * 3600e3, now), "3h ago");
});

/* ---------------- awards model on synthetic data ---------------- */
const team = (abbr, id, wins, losses, oppPpg = 112) => ({ team: { id, abbr, name: abbr, displayName: abbr, color: "#000" }, wins, losses, pct: wins / (wins + losses), oppPpg, seed: 1 });
const stats = (o) => ({ gp: 20, min: 34, pts: 20, reb: 5, ast: 5, stl: 1, blk: 0.5, tov: 2, fgm: 8, fga: 16, fgPct: 50, threePct: 36, tpm: 2, ftPct: 80, ftm: 3, fta: 4, dd: 0, td: 0, ...o });
const P = (id, name, teamAbbr, pos, s, extra = {}) => ({ id, name, teamAbbr, position: pos, age: 26, debutYear: null, stats: stats(s), headshot: null, headshotSmall: null, initials: "X", ...extra });

function fixture() {
  const standings = { conferences: [
    { name: "Eastern Conference", abbr: "East", teams: [team("BOS", "2", 16, 4, 105), team("NY", "18", 12, 8)] },
    { name: "Western Conference", abbr: "West", teams: [team("DEN", "7", 15, 5), team("LAL", "13", 6, 14, 118)] },
  ] };
  const prevStandings = { conferences: [
    { name: "Eastern Conference", abbr: "East", teams: [team("BOS", "2", 40, 42), team("NY", "18", 50, 32)] },
    { name: "Western Conference", abbr: "West", teams: [team("DEN", "7", 50, 32), team("LAL", "13", 45, 37)] },
  ] };
  const players = { season: 2027, players: [] };
  const teams = { East: ["BOS", "NY"], West: ["DEN", "LAL"] };
  let n = 0;
  for (const conf of ["East", "West"]) for (const t of teams[conf]) for (let i = 0; i < 10; i++) {
    n++; players.players.push(P(String(n), `${t} Player ${i}`, t, i % 2 ? "G" : i % 3 ? "F" : "C", { pts: 30 - i * 2 - (t === "LAL" ? 3 : 0), gp: i === 0 && t === "DEN" ? 12 : 20, blk: i === 4 ? 3 : 0.5, stl: i === 4 ? 2 : 1 }));
  }
  players.players.push(P("rook", "Rookie Guy", "NY", "G", { pts: 15, min: 28 }, { age: 20 }));
  const prevPlayers = { season: 2026, players: players.players.filter((p) => p.id !== "rook").map((p) => ({ ...p, stats: stats({ ...p.stats, pts: p.id === "3" ? 8 : p.stats.pts, gp: 70 }) })) };
  const starts = { players: Object.fromEntries(players.players.map((p) => [p.id, { gp: p.stats.gp, gs: Number(p.id) % 10 >= 5 ? 2 : p.stats.gp }])) };
  const coaches = { 2: { coach: "Coach B" }, 18: { coach: "Coach N" }, 7: { coach: "Coach D" }, 13: { coach: "Coach L" } };
  return { players, prevPlayers, standings, prevStandings, starts, coaches };
}

test("65-game rule: no early-season demotion; out only once 65 is unreachable", () => {
  assert.equal(projectedGames(12, 20), 49);
  assert.ok(projectedGames(16, 20) >= RULE_GAMES);
  // 8 games missed after 20: on a sub-65 pace, but still eligible and NOT docked
  const r = computeAwards(fixture());
  const den0 = r.players.find((p) => p.name === "DEN Player 0");
  assert.equal(den0.ruleRisk, false); assert.equal(den0.paceRisk, true);
  assert.ok(r.awards.mvp.leaders.some((e) => e.player.id === den0.id), "a pace flag doesn't move a player off the MVP top 5");
  // 18 missed games → 65 impossible → ineligible
  assert.equal(ruleStatus(12, 30).out, true);
  assert.equal(ruleStatus(13, 30).out, false);
  // confirmed long-term absences
  const now = Date.parse("2026-11-16T00:00:00Z");
  assert.equal(ruleStatus(11, 14, { status: "Out", comment: "He will miss the rest of the season after surgery." }, now).out, true);
  assert.equal(ruleStatus(11, 14, { status: "Out", returnDate: "2027-01-20" }, now).out, true);   // ~31 more games
  assert.equal(ruleStatus(11, 14, { status: "Out", returnDate: "2026-11-20" }, now).out, false);  // a short absence
  const long = computeAwards({ ...fixture(), injuries: [{ athlete: { id: den0.id }, status: "Out", comment: "out for the season" }] });
  assert.ok(!long.awards.mvp.leaders.some((e) => e.player.id === den0.id));
  assert.ok(![...long.awards.allNba.first, ...long.awards.allNba.second, ...long.awards.allNba.third].some((p) => p.ruleRisk));
  // All-Star ignores the rule
  assert.ok([...long.allStar.West.starters, ...long.allStar.West.reserves].some((p) => p.id === den0.id));
});

test("AwardScore: missed games aren't docked; efficiency and team success count", async () => {
  const { awardScore } = await import("../service/awards.js");
  const s = { pts: 30, fgm: 10, fga: 20, ftm: 8, fta: 9, reb: 8, ast: 8, stl: 1, blk: 1, tov: 3, gp: 10 };
  assert.equal(awardScore(s, { winPct: 0.8, seed: 1 }), awardScore({ ...s, gp: 6 }, { winPct: 0.8, seed: 1 }));
  assert.ok(awardScore(s, { winPct: 0.8, seed: 1 }) > awardScore(s, { winPct: 0.4, seed: 11 }));
  assert.ok(awardScore({ ...s, fga: 26 }, { winPct: 0.6 }) < awardScore(s, { winPct: 0.6 }));
});

test("All-Star: 5 starters (2G/3FC), 7 reserves, 6 first cuts per conference", () => {
  const r = computeAwards(fixture());
  for (const c of ["East", "West"]) {
    const a = r.allStar[c];
    assert.equal(a.starters.length, 5); assert.equal(a.reserves.length, 7); assert.equal(a.mentions.length, 6);
    assert.equal(a.starters.filter((p) => p.position === "G").length, 2);
    assert.ok([...a.starters, ...a.reserves, ...a.mentions].every((p) => p.conference === c));
    assert.equal(new Set([...a.starters, ...a.reserves, ...a.mentions].map((p) => p.id)).size, 18);
  }
});

test("award ladders: winners weighted by team record, rookies, sixth men, MIP, COY", () => {
  const r = computeAwards(fixture());
  const a = r.awards;
  assert.equal(a.mvp.leaders.length, 5); assert.equal(a.mvp.mentions.length, 3);
  assert.notEqual(a.mvp.leaders[0].player.teamAbbr, "LAL");           // bad team, lower score
  assert.equal(a.roy.leaders[0].player.id, "rook");
  assert.ok(a.smoy.leaders.every((e) => e.player.startRate < 0.5));
  assert.equal(a.mip.leaders[0].player.id, "3");                        // 8 → 26 PPG
  assert.equal(a.dpoy.leaders[0].player.stats.blk, 3);
  assert.equal(a.coy.leaders[0].team.abbr, "BOS");                      // .488 → .800
  assert.equal(a.coy.leaders[0].coach, "Coach B");
  assert.equal(a.allNba.first.length + a.allNba.second.length + a.allNba.third.length, 15);
  assert.ok(production(stats({})) > 0);
});

/* ---------------- McConnell + pick inventory ---------------- */
import { compare, hybridPosition, dailyMystery, gameNumber, recordResult, emptyStats, shareText, searchPlayers, toGamePlayer, MAX_GUESSES } from "../service/mcconnell.js";
import { pickInventory } from "../service/draft.js";

const gp = (o) => ({ id: "x", name: "X", team: "BOS", conf: "East", div: "Atlantic", pos: "G", ht: 78, age: 26, num: 9, ...o });

test("McConnell five-slot positions: exact green, neighbouring slot yellow, hybrid fallback", () => {
  const P = (pos) => ({ team: "BOS", conf: "East", div: "Atlantic", pos, ht: 78, age: 25, num: 1 });
  assert.equal(compare(P("SF"), P("SF")).pos.state, "green");
  assert.equal(compare(P("SG"), P("SF")).pos.state, "yellow");
  assert.equal(compare(P("PF"), P("C")).pos.state, "yellow");
  assert.equal(compare(P("PG"), P("SF")).pos.state, "gray");
  const mpj = toGamePlayer({ id: "4278104", name: "Michael Porter Jr.", position: "F", height: "6' 10\"", teamAbbr: "BKN" }, null, "SF");
  assert.equal(mpj.pos, "SF");
  assert.equal(toGamePlayer({ id: "9", name: "X", position: "G", height: "6' 7\"" }, null, null).pos, "G-F");
});

test("McConnell compare: exact, close (±2 with arrow), far, partial position", () => {
  const m = gp({ id: "m", team: "BOS", pos: "G-F", ht: 80, age: 27, num: 11 });
  const r = compare(gp({ id: "g", team: "NY", conf: "East", div: "Atlantic", pos: "G", ht: 78, age: 31, num: 11 }), m);
  assert.equal(r.team.state, "gray");
  assert.equal(r.conf.state, "green");
  assert.equal(r.div.state, "green");
  assert.equal(r.pos.state, "yellow");                       // G vs G-F share a letter
  assert.deepEqual(r.ht, { state: "yellow", arrow: "↑" });   // 2 inches short, mystery taller
  assert.deepEqual(r.age, { state: "gray", arrow: "↓" });    // 4 years off, mystery younger
  assert.deepEqual(r.num, { state: "green", arrow: "" });
  assert.equal(r.correct, false);
  assert.equal(compare(gp({ pos: "C" }), gp({ pos: "G-F" })).pos.state, "gray");
  assert.equal(compare(m, m).correct, true);
});

test("hybrid positions from snapshot or height", () => {
  assert.equal(hybridPosition("F", 80, "G/F"), "G-F");
  assert.equal(hybridPosition("C", 83, "F/C"), "F-C");
  assert.equal(hybridPosition("G", 79), "G-F");
  assert.equal(hybridPosition("G", 74), "G");
  assert.equal(hybridPosition("F", 82), "F-C");
  assert.equal(hybridPosition("C", 84), "C");
  const p = toGamePlayer({ id: "1", name: "A B", height: `6' 8"`, jersey: "0", age: 22, position: "F", teamAbbr: "BOS", conference: "East", division: "Atlantic" });
  assert.equal(p.ht, 80); assert.equal(p.num, 0);
});

test("daily mystery is deterministic per date and independent of input order", () => {
  const pool = Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i) }));
  const a = dailyMystery(pool, "2026-11-20"), b = dailyMystery([...pool].reverse(), "2026-11-20");
  assert.equal(a.id, b.id);
  const days = new Set(Array.from({ length: 20 }, (_, i) => dailyMystery(pool, `2026-12-${String(i + 1).padStart(2, "0")}`).id));
  assert.ok(days.size > 15);
  assert.equal(gameNumber("2026-11-14"), 1);
  assert.equal(gameNumber("2026-12-14"), 31);
});

test("streaks, distribution and share grid", () => {
  let s = recordResult(emptyStats(), 1, true, 3);
  s = recordResult(s, 2, true, 5);
  assert.equal(s.streak, 2); assert.equal(s.dist[2], 1); assert.equal(s.dist[4], 1);
  assert.deepEqual(recordResult(s, 2, true, 1), s);          // same game recorded once
  s = recordResult(s, 4, true, 2);                           // skipped a day
  assert.equal(s.streak, 1); assert.equal(s.maxStreak, 2);
  s = recordResult(s, 5, false, MAX_GUESSES);
  assert.equal(s.streak, 0); assert.equal(s.played, 4); assert.equal(s.wins, 3);
  const m = gp({ id: "m" });
  const txt = shareText({ results: [compare(gp({ id: "g", team: "NY", ht: 77 }), m), compare(m, m)], won: true, game: 7 });
  assert.equal(txt.split("\n")[0], "McConnell #7 2/8");
  assert.equal(txt.split("\n")[2], "🟩🟩🟩🟩🟩🟩🟩");
  assert.match(txt.split("\n")[1], /^⬛🟩🟩🟩🟨🟩🟩$/);
});

test("autocomplete: accent-insensitive prefix search, excludes guessed", () => {
  const ps = [{ id: "1", name: "Luka Dončić" }, { id: "2", name: "Luke Kennard" }, { id: "3", name: "Nikola Jokić" }];
  assert.deepEqual(searchPlayers(ps, "lu").map((p) => p.id), ["1", "2"]);       // alphabetical
  assert.deepEqual(searchPlayers(ps, "doncic").map((p) => p.id), ["1"]);
  assert.deepEqual(searchPlayers(ps, "luk don").map((p) => p.id), ["1"]);
  assert.deepEqual(searchPlayers(ps, "lu", new Set(["1"])).map((p) => p.id), ["2"]);
});

test("Team Hub pick inventory", () => {
  const cfg = JSON.parse(readFileSync(new URL("../draft_picks_2027_2029.json", import.meta.url)));
  const cha = pickInventory("CHA", cfg)[0].items.map((i) => i.kind);
  assert.deepEqual(cha, ["own", "owns", "owns"]);
  const atl = pickInventory("ATL", cfg)[0].items;
  assert.ok(atl.some((i) => i.kind === "owes" && /SAS/.test(i.text)));
  assert.ok(atl.some((i) => i.kind === "swap"));
  assert.equal(pickInventory("BOS", cfg).every((y) => y.items[0].kind === "own"), true);
});
