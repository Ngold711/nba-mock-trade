import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, findEntities, localAnswer, buildContext, chipsFor, cardsFor, etDate, scheduleDates, datesAsked, intentsOf, retiredBy, retiredLine, isRetiredQ } from "../service/chat.js";

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

/* ---------- Hooptrax AI: US Eastern dates, 14-day schedule, sliced context, cards ---------- */
// 2026-11-15 04:30 UTC is still Saturday Nov 14, 11:30 PM in New York.
const NOW = Date.parse("2026-11-15T04:30:00Z");
const game = (id, ymdIso, away, home, state, sa = null, sh = null) => ({ id, date: ymdIso, status: { state, shortDetail: state === "post" ? "Final" : "" }, broadcast: "",
  away: { abbr: away, displayName: away, score: sa, logo: "", color: "#111111" }, home: { abbr: home, displayName: home, score: sh, logo: "", color: "#222222" } });
const sched = {
  ...data,
  schedule: [
    { date: "20261113", games: [game("1", "2026-11-14T00:30Z", "BOS", "NY", "post", 101, 112)] },
    { date: "20261114", games: [] },
    { date: "20261115", games: [game("2", "2026-11-15T23:00Z", "NY", "LAL", "pre")] },
    { date: "20261116", games: [game("3", "2026-11-17T00:00Z", "LAL", "BOS", "pre")] },
  ],
};

test("AI dates are US Eastern: today, tomorrow, weekdays, month-day, 16-day window", () => {
  assert.equal(etDate(0, NOW), "20261114");                              // not the UTC date
  assert.equal(etDate(1, NOW), "20261115");
  assert.equal(etDate(0, Date.parse("2026-03-08T07:30:00Z")), "20260308"); // DST change day (EDT)
  const w = scheduleDates(NOW);
  assert.equal(w.length, 16); assert.equal(w[0], "20261113"); assert.equal(w[15], "20261128");
  assert.deepEqual(datesAsked("Who plays tomorrow?", NOW), ["20261115"]);
  assert.deepEqual(datesAsked("any games friday", NOW), ["20261120"]);
  assert.deepEqual(datesAsked("Nov 20 slate", NOW), ["20261120"]);
  assert.equal(datesAsked("games this week", NOW).length, 7);
  assert.deepEqual(datesAsked("Who won MVP in 1996?", NOW), []);
});

test("AI intents: schedule vs scores vs history", () => {
  assert.deepEqual([...intentsOf("Who plays tomorrow?")], ["schedule"]);
  assert.ok(intentsOf("Lakers score").has("scores"));
  assert.ok(!intentsOf("Who won MVP in 1956?").has("scores"));
  assert.ok(intentsOf("Who won MVP in 1956?").has("history"));
  assert.ok(intentsOf("Is Jalen Brunson out tonight?").has("injuries"));
  assert.ok(intentsOf("Celtics payroll and apron").has("trade"));
});

test("AI context is sliced to the question and schedules come from the 14-day cache", () => {
  const t = buildContext("Who plays tomorrow?", sched, idx, NOW).text;
  assert.match(t, /TODAY \(US Eastern\): Sat, Nov 14/);
  assert.match(t, /GAMES Sun, Nov 15: NY @ LAL/);
  assert.doesNotMatch(t, /STANDINGS|INJURIES|TRANSACTIONS|2K27 TOP/);    // irrelevant slices left out
  const k = buildContext("When do the Knicks play next?", sched, idx, NOW).text;
  assert.match(k, /NY SCHEDULE: Fri, Nov 13 BOS @ NY 101-112 Final; Sun, Nov 15 NY @ LAL/);
  const h = buildContext("Who won MVP in 1956?", sched, idx, NOW).text;
  assert.doesNotMatch(h, /GAMES /);
  assert.match(buildContext("games on Dec 25", sched, idx, NOW).text, /outside the cached 14-day window/);
});

test("local engine answers schedules instantly; cards for players and games", () => {
  const t0 = performance.now();
  const a = localAnswer("Who plays tomorrow?", sched, idx, NOW);
  assert.ok(performance.now() - t0 < 100);
  assert.match(a.text, /Sun, Nov 15 — 1 game \(ET\)/); assert.match(a.text, /NY @ LAL/);
  assert.match(localAnswer("When do the Knicks play next?", sched, idx, NOW).text, /Last: Fri, Nov 13 — BOS @ NY 101-112 Final[\s\S]*Sun, Nov 15 — NY @ LAL/);
  assert.match(localAnswer("Any games next Tuesday?", sched, idx, NOW).text, /No games on Tue, Nov 17|outside/);
  const cards = cardsFor("How is Jalen Brunson doing?", sched, idx, null, NOW);
  assert.deepEqual(cards.map((c) => c.type), ["player"]);
  assert.equal(cards[0].ovr, 95); assert.equal(cards[0].line.ppg, 26.6);
  const g = cardsFor("Who plays tomorrow?", sched, idx, null, NOW);
  assert.deepEqual(g.map((c) => [c.type, c.away.abbr, c.home.abbr, c.day]), [["game", "NY", "LAL", "Sun, Nov 15"]]);
  assert.equal(cardsFor("Who won MVP in 1956?", sched, idx, null, NOW).length, 0);
  // long schedule answers don't link every team name (game cards cover them)
  const many = "Boston Celtics, New York Knicks, Los Angeles Lakers";
  assert.equal(chipsFor(many, idx, null).filter((c) => c.type === "team").length, 3);
});

/* ---------- retired numbers: audited data, one source for Vault + AI ---------- */
test("retired numbers audited through Nov 2026 (Rose, Cooper, Dell Curry; upcoming ceremonies)", () => {
  const nums = (c) => H.franchises[c].retired.map((r) => `${r.num} ${r.name}`);
  assert.deepEqual(nums("CHI"), ["1 Derrick Rose", "4 Jerry Sloan", "10 Bob Love", "23 Michael Jordan", "33 Scottie Pippen"]);
  assert.equal(H.franchises.CHI.retired[0].retiredOn, "2026-01-24");
  for (const n of ["8 Kobe Bryant", "13 Wilt Chamberlain", "16 Pau Gasol", "21 Michael Cooper", "22 Elgin Baylor", "24 Kobe Bryant", "25 Gail Goodrich", "32 Magic Johnson", "33 Kareem Abdul-Jabbar", "34 Shaquille O'Neal", "42 James Worthy", "44 Jerry West", "52 Jamaal Wilkes"]) assert.ok(nums("LAL").includes(n), n);
  assert.deepEqual(nums("MEM"), ["9 Tony Allen", "33 Marc Gasol", "50 Zach Randolph"]);
  assert.ok(nums("TOR").includes("15 Vince Carter") && nums("BKN").includes("15 Vince Carter"));
  for (const n of ["1 Chris Bosh", "3 Dwyane Wade", "10 Tim Hardaway", "23 Michael Jordan (honorary)", "32 Shaquille O'Neal", "33 Alonzo Mourning", "40 Udonis Haslem"]) assert.ok(nums("MIA").includes(n), n);
  assert.ok(nums("ORL").includes("32 Shaquille O'Neal"));
  assert.deepEqual(nums("GSW"), ["9 Andre Iguodala", "13 Wilt Chamberlain", "14 Tom Meschery", "16 Al Attles", "17 Chris Mullin", "24 Rick Barry", "42 Nate Thurmond"]);
  assert.ok(nums("CHA").includes("30 Dell Curry"));
  assert.equal(H.franchises.MIN.upcomingRetirements[0].name, "Kevin Garnett");
  assert.equal(Object.keys(H.franchises).length, 30);
});

test("Ask Hooptrax grounds retired-number answers in nba_history.json (team, player, whole league)", () => {
  assert.ok(isRetiredQ("Has Derrick Rose's #1 been retired?") && isRetiredQ("every retired jersey in the NBA") && !isRetiredQ("Who leads the league in assists?"));
  assert.deepEqual(retiredBy(H, "Vince Carter").map((h) => h.code).sort(), ["BKN", "TOR"]);
  assert.equal(retiredBy(H, "Kevin Garnett").find((h) => h.code === "MIN").upcoming, true);
  assert.match(retiredLine("CHI", H.franchises.CHI), /^CHI: #1 Derrick Rose \(2026-01\), #4 Jerry Sloan, #10 Bob Love, #23 Michael Jordan, #33 Scottie Pippen$/);
  // whole league: one compact row per team, nothing cut off
  const all = localAnswer("List every retired number for all 30 teams", data, idx).text;
  assert.equal(all.split("\n").filter((l) => /^[A-Z]{3}: /.test(l)).length, 30);
  assert.match(all, /CHI: #1 Derrick Rose/); assert.match(all, /CHA: #13 Bobby Phills, #30 Dell Curry/);
  assert.match(all, /MIN: #2 Malik Sealy \| UPCOMING: #21 Kevin Garnett \(NOT retired yet/);
  // a team question gets that team's rows with dates in the model context
  const ctx = buildContext("What numbers have the Lakers retired?", data, idx).text;
  assert.match(ctx, /LAL: .*#21 Michael Cooper \(2025-01-13\) HOF/);
  // the Bulls question can't come back "not retired"
  assert.match(buildContext("Has Derrick Rose's number been retired by the Bulls?", { ...data, league: { ...league, players: [...league.players, { id: "3456", name: "Derrick Rose", teamAbbr: null }] } }, buildIndex({ ...data, league: { ...league, players: [...league.players, { id: "3456", name: "Derrick Rose", teamAbbr: null }] } })).text, /RETIRED Derrick Rose: CHI #1 \(retired 2026-01-24\)/);
});
