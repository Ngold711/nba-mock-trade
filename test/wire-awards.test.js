import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWire, relativeTime, WIRE_FILTERS } from "../service/wire.js";
import { computeAwards, projectedGames, production, RULE_GAMES } from "../service/awards.js";
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

test("projected games + 65-game rule", () => {
  assert.equal(projectedGames(12, 20), 49);
  assert.equal(projectedGames(20, 20), 82);
  assert.ok(projectedGames(16, 20) >= RULE_GAMES);
  const r = computeAwards(fixture());
  const den0 = r.players.find((p) => p.name === "DEN Player 0");
  assert.equal(den0.ruleRisk, true);
  assert.ok(!r.awards.mvp.leaders.some((e) => e.player.id === den0.id), "rule-risk players are off MVP top 5");
  assert.ok(![...r.awards.allNba.first, ...r.awards.allNba.second, ...r.awards.allNba.third].some((p) => p.ruleRisk));
  // All-Star ignores the rule
  assert.ok([...r.allStar.West.starters, ...r.allStar.West.reserves].some((p) => p.id === den0.id));
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
