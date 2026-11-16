import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDirectory, filterDirectory, sortKey, posGroups, TOP75 } from "../service/directory.js";
import { parseRatingsFeed } from "../service/ratings-feed.js";
import { buildRatings } from "../service/ratings.js";
import { liveCareerLeaders, withUnfoldedGames } from "../service/live-leaders.js";
import { systemPrompt } from "../service/chat.js";

const H = JSON.parse(readFileSync(new URL("../nba_history.json", import.meta.url), "utf8"));

test("player directory: one A–Z list by last name, active + legends, filters", () => {
  const league = { players: [{ id: "1966", name: "LeBron James", teamAbbr: "LAL", position: "F" }, { id: "9", name: "Jaren Jackson Jr.", teamAbbr: "MEM", position: "F-C" }] };
  const d = buildDirectory({ league, legends: H.legends });
  assert.ok(d.length > 300);
  const keys = d.map((p) => p.key); assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)), "sorted by last name");
  assert.equal(sortKey("Jaren Jackson Jr."), "jackson jaren");
  assert.equal(d.filter((p) => p.id === "1966").length, 1, "no duplicate for active legends");
  assert.ok(d.find((p) => p.id === "1966").active);
  assert.ok(filterDirectory(d, "hof").every((p) => p.hof) && filterDirectory(d, "hof").some((p) => p.name === "Michael Jordan"));
  assert.ok(filterDirectory(d, "top75").some((p) => p.name === "LeBron James"));
  assert.equal(TOP75.size, 76);
  assert.deepEqual(posGroups("F-C"), ["F", "C"]); assert.deepEqual(posGroups("PG"), ["G"]);
  assert.ok(filterDirectory(d, "C").every((p) => p.g.includes("C")));
});

test("2K27 ratings feed: parse aliases, reject bad rows, override the model; bundled snapshot is valid", () => {
  const f = parseRatingsFeed({ source: "test feed", asOf: "2026-11-20", players: [{ player: "Luka Doncic", overall: "98", change: 1 }, { name: "Nobody", ovr: 150 }, { name: "Shai Gilgeous-Alexander", ovr: 97, attributes: { threePoint: 88 } }] });
  assert.equal(f.players.length, 2); assert.equal(f.players[0].ovr, 98);
  const players = { players: [{ id: "1", name: "Luka Doncic", teamAbbr: "LAL", position: "G", stats: { gp: 10, pts: 38, reb: 7, ast: 8, min: 36 } }, { id: "2", name: "Shai Gilgeous-Alexander", position: "G", stats: { gp: 10, pts: 30, reb: 5, ast: 6, min: 34 } }] };
  const r = buildRatings({ players, feed: f });
  assert.equal(r.players.find((p) => p.name === "Luka Doncic").ovr, 98);
  assert.equal(r.players.find((p) => p.name === "Shai Gilgeous-Alexander").attrs.threePt, 88);
  assert.match(r.note, /test feed/);
  const snap = parseRatingsFeed(JSON.parse(readFileSync(new URL("../ratings_2k27.json", import.meta.url), "utf8")));
  assert.ok(snap.players.length >= 10);
});

test("live career leaders: active totals refreshed (plus games the season line hasn't counted) and re-sorted", async () => {
  const board = { ast: [{ id: "x", name: "Stockton", total: 15806 }, { id: "1", name: "Kidd", total: 12091 }, { id: "1966", name: "LeBron James", total: 12081, active: true, gp: 1600 }] };
  const career = withUnfoldedGames({ gp: 1600, totals: { ast: 12081, pts: 43591 } }, 10, [{ ast: 11, pts: 15, tp: "0-2" }, ...Array(10).fill({ ast: 6 })]);
  assert.equal(career.totals.ast, 12092);
  const live = await liveCareerLeaders(board, async () => career);
  assert.deepEqual(live.ast.map((r) => r.name), ["Stockton", "LeBron James", "Kidd"]);
  assert.equal(live.ast[1].total, 12092);
});

test("system prompt carries today's date and the no-memory rule", () => {
  const p = systemPrompt(Date.parse("2026-11-15T20:00:00Z"));
  assert.match(p, /Sunday, November 15, 2026/);
  assert.match(p, /NEVER answer those from memory/);
});
