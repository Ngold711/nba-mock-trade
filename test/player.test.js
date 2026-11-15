// Player Encyclopedia: ESPN season + game-log parsing, stat modes, search ranking, trophy shelf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSeasons, normalizeGameLog, inMode, advanced, searchLocal, mergeSearch, trophies } from "../service/player.js";
import { normalizeHonors } from "../service/normalize.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const H = JSON.parse(readFileSync(new URL("../nba_history.json", import.meta.url), "utf8"));
const mj = normalizeSeasons(fx("athlete_stats_1035"));

test("season-by-season stats from ESPN: every season, team, per-game and totals; career rows", () => {
  assert.equal(mj.seasons.length, 15);
  const first = mj.seasons[0];
  assert.equal(first.season, "1984–85"); assert.equal(first.team.code, "CHI");
  assert.deepEqual([first.gp, first.pts, first.totals.pts], [82, 28.2, 2313]);
  assert.equal(mj.seasons.at(-1).team.code, "WAS");
  assert.deepEqual([mj.career.gp, mj.career.pts, mj.career.totals.pts], [1072, 30.1, 32292]);
});

test("stat modes: per 36, totals, advanced (TS%, eFG%, AST/TO, Game Score)", () => {
  const s = mj.seasons.find((x) => x.season === "1987–88");
  const p36 = inMode(s, "p36");
  assert.equal(p36.min, 36); assert.equal(p36.pts, Math.round(s.pts * 36 / s.min * 10) / 10);
  const tot = inMode(s, "tot"); assert.equal(tot.pts, 2868); assert.equal(tot.fg, "1069-1998");
  const adv = advanced(mj.career);
  assert.deepEqual(adv, { tsPct: 56.8, efgPct: 50.9, astTo: 1.96, gmsc: 23.4 });
  assert.equal(inMode({ gp: 0, min: 0, pts: null }, "p36").pts, null);
});

test("game log: newest first, opponent, result, box line (ESPN has no +/-)", () => {
  const g = normalizeGameLog(fx("athlete_gamelog_3945274"));
  assert.equal(g.season, "2026-27");
  assert.ok(g.games.length >= 1 && g.games.length <= 15);
  const x = g.games[0];
  assert.ok(x.opp && /^[WL]$/.test(x.result) && /^\d+-\d+$/.test(x.score) && x.pts != null && /^\d+-\d+$/.test(x.fg));
  for (let i = 1; i < g.games.length; i++) assert.ok(g.games[i - 1].date >= g.games[i].date);
  assert.ok(!("plusMinus" in x));
});

test("search ranks legends and active players sensibly", () => {
  const active = [{ id: "1", name: "Jordan Clarkson", teamAbbr: "NY", ppg: 16 }, { id: "2", name: "Jordan Poole", teamAbbr: "NO", ppg: 14 }, { id: "1966", name: "LeBron James", teamAbbr: "PHI", ppg: 20 }];
  const r = searchLocal("jordan", { active, legends: H.legends });
  assert.equal(r[0].name, "Michael Jordan"); assert.equal(r[0].active, false);
  assert.ok(r.some((p) => p.name === "Jordan Clarkson" && p.active));
  assert.equal(searchLocal("kobe", { active, legends: H.legends })[0].name, "Kobe Bryant");
  assert.equal(searchLocal("lebron", { active, legends: H.legends })[0].id, "1966");
  assert.deepEqual(searchLocal("z", { active, legends: H.legends }), []);
  const merged = mergeSearch(searchLocal("jordan", { active, legends: [] }), [{ id: "1", name: "Jordan Clarkson" }, { id: "99", name: "Jordan Smith", team: "" }]);
  assert.equal(merged.filter((p) => p.id === "1").length, 1); assert.ok(merged.some((p) => p.id === "99"));
});

test("trophy shelf: championships from season teams, MVPs/Finals MVPs from history, All-NBA from ESPN", () => {
  const t = trophies({ name: "Michael Jordan", history: H, honors: normalizeHonors(fx("athlete_overview_1035")), seasons: mj.seasons });
  const by = Object.fromEntries(t.map((x) => [x.key, x]));
  assert.deepEqual(by.titles.years, [1991, 1992, 1993, 1996, 1997, 1998]);
  assert.equal(by.fmvp.count, 6); assert.equal(by.mvp.count, 5); assert.equal(by.allNba1.count, 10); assert.equal(by.roy.years[0], 1985);
  assert.equal(t[0].key, "titles");
});
