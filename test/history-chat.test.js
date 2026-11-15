import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, findEntities, localAnswer, buildContext, chipsFor } from "../service/chat.js";

const H = JSON.parse(readFileSync(new URL("../nba_history.json", import.meta.url)));
const league = {
  teams: { BOS: { displayName: "Boston Celtics", name: "Celtics", location: "Boston" }, NY: { displayName: "New York Knicks", name: "Knicks", location: "New York" }, LAL: { displayName: "Los Angeles Lakers", name: "Lakers", location: "Los Angeles" } },
  players: [{ id: "3934672", name: "Jalen Brunson", teamAbbr: "NY", position: "G", age: 30, salary: 37700000 }, { id: "1966", name: "LeBron James", teamAbbr: "PHI", position: "F" }],
};
const data = { league, history: H, stats: { players: [{ id: "3934672", stats: { gp: 12, pts: 26.6, reb: 2.9, ast: 5.7, fgPct: 43.6 } }] }, ratings: { players: [{ id: "3934672", name: "Jalen Brunson", ovr: 95, seeded: true, delta: 0 }] },
  scoreboard: { games: [] }, standings: { conferences: [] }, injuries: [], transactions: [], prospects: { 2027: [{ rank: 1, name: "Tyran Stokes", position: "SF", school: "Kansas" }] } };
const idx = buildIndex(data);

test("history archive: champions, awards, leaders, franchises are complete and consistent", () => {
  assert.equal(H.champions.length, 2026 - 1947 + 1);
  for (let y = 1947; y <= 2026; y++) assert.ok(H.champions.find((c) => c.year === y), `champion ${y}`);
  assert.equal(H.franchises.BOS.titles.length, 18); assert.equal(H.franchises.LAL.titles.length, 17);
  assert.equal(H.champions.find((c) => c.year === 2016).champion, "Cleveland Cavaliers");
  for (const [k, l] of H.careerCategories) { assert.equal(H.careerLeaders[k].length, 25, l); const v = H.careerLeaders[k].map((r) => r.total); assert.deepEqual(v, [...v].sort((a, b) => b - a)); }
  assert.equal(H.careerLeaders.pts[0].name, "LeBron James"); assert.equal(H.careerLeaders.reb[0].name, "Wilt Chamberlain");
  assert.equal(H.careerLeaders.ast[0].name, "John Stockton"); assert.equal(H.careerLeaders.stl[0].name, "John Stockton");
  assert.equal(H.careerLeaders.blk[0].name, "Hakeem Olajuwon"); assert.equal(H.careerLeaders.tpm[0].name, "Stephen Curry");
  const mvps = H.awards.mvp.map((a) => a.year); assert.equal(Math.min(...mvps), 1956); assert.ok(mvps.includes(2026));
  const playerAwards = Object.entries(H.awards).filter(([k]) => k !== "coy").flatMap(([, l]) => l);
  const verified = playerAwards.filter((a) => a.verified).length;
  assert.ok(verified / playerAwards.length > 0.95, `ESPN-verified awards: ${verified}/${playerAwards.length}`);
  assert.equal(Object.keys(H.franchises).length, 30);
  assert.ok(H.draft.no1.some((d) => d.year === 1985 && d.name === "Patrick Ewing"));
});

test("chat entities: players by full or unique last name, teams by name/city/abbr, years", () => {
  const e = findEntities("How did Brunson and the Celtics do in 2008?", idx);
  assert.deepEqual(e.players.map((p) => p.name), ["Jalen Brunson"]);
  assert.ok(e.teams.some((t) => t.abbr === "BOS"));
  assert.deepEqual(e.years, [2008]);
  assert.ok(findEntities("Larry Bird career", idx).players.some((p) => p.legend));
});

test("local engine answers NBA questions from data and refuses everything else", () => {
  assert.match(localAnswer("Who won the 2016 Finals?", data, idx).text, /Cleveland Cavaliers def\. Golden State Warriors 4-3.*LeBron James/);
  assert.match(localAnswer("1998 MVP", data, idx).text, /Michael Jordan/);
  assert.match(localAnswer("Jalen Brunson salary", data, idx).text, /\$37\.7M/);
  assert.match(localAnswer("Celtics titles", data, idx).text, /18 NBA titles/);
  assert.match(localAnswer("Lakers retired numbers", data, idx).text, /#24 Kobe Bryant/);
  assert.match(localAnswer("most career rebounds", data, idx).text, /Wilt Chamberlain — 23,924/);
  const off = localAnswer("What's the best pizza recipe?", data, idx);
  assert.equal(off.refused, true); assert.match(off.text, /only cover the NBA/);
});

test("grounding context targets the question; chips map names to ids", () => {
  const ctx = buildContext("What is Jalen Brunson's 2K27 rating?", data, idx);
  assert.match(ctx.text, /PLAYER Jalen Brunson .*2K27 OVR 95 \(official\)/);
  assert.match(ctx.text, /Finals MVP 2026/);
  const chips = chipsFor("Jalen Brunson led the New York Knicks.", idx, ctx.entities);
  assert.deepEqual(chips.map((c) => [c.type, c.id]), [["player", "3934672"], ["team", "NYK"]]);
});
