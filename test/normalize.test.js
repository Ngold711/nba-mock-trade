import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeScoreboard, normalizeSummary, normalizeRoster, normalizeInjuries, normalizeStandings,
  normalizeTransactions, normalizeTeams, athleteId, headshot, currentSalary, num, HEADSHOT_BASE,
} from "../service/normalize.js";

// Fixtures are trimmed copies of real ESPN responses captured 2026-11-14.
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));

test("scoreboard: games, teams, scores, status, leaders with headshots", () => {
  const sb = normalizeScoreboard(fx("scoreboard"));
  assert.equal(sb.games.length, 3);
  const g = sb.games[0];
  assert.equal(g.id, "401909296");
  assert.equal(g.status.state, "post");
  assert.equal(g.home.abbr, "IND");
  assert.equal(g.home.score, 106);
  assert.equal(g.away.abbr, "NY");
  assert.equal(g.away.score, 104);
  assert.equal(g.home.color, "#0c2340");
  assert.equal(g.home.linescores.length, 4);
  const pts = g.home.leaders.find((l) => l.category === "Pts");
  assert.equal(pts.athlete.id, "3149673");                         // scoreboard headshot is a plain string
  assert.equal(pts.athlete.headshot, `${HEADSHOT_BASE}/3149673.png`);
  assert.equal(sb.live, 0);
});

test("summary: box score keyed by label, DNP players, newest plays first", () => {
  const s = normalizeSummary(fx("summary"), { maxPlays: 10 });
  assert.equal(s.game.id, "401909296");
  assert.equal(s.teams.length, 2);
  const ny = s.teams[0];
  assert.equal(ny.team.abbr, "NY");
  assert.deepEqual(ny.labels.slice(0, 3), ["MIN", "PTS", "FG"]);
  const og = ny.players.find((p) => p.id === "3934719");
  assert.equal(og.name, "OG Anunoby");
  assert.equal(og.stats.PTS, "11");
  assert.equal(og.starter, true);
  assert.equal(og.headshot, `${HEADSHOT_BASE}/3934719.png`);
  assert.ok(ny.players.some((p) => p.didNotPlay));
  assert.equal(ny.totals.PTS, "104");
  assert.equal(s.plays.length, 10);
  assert.equal(s.plays[0].text, "End of Game");
});

test("roster: current-season salary from contracts[], headshots, injuries", () => {
  const r = normalizeRoster(fx("roster"));
  assert.equal(r.team.abbr, "LAL");
  assert.equal(r.season, 2027);
  const luka = r.athletes.find((a) => a.name === "Luka Doncic");
  assert.equal(luka.salary, 49500000);
  assert.equal(luka.headshot, `${HEADSHOT_BASE}/${luka.id}.png`);
  assert.match(luka.headshotSmall, /combiner\/i\?img=\/i\/headshots\/nba\/players\/full\/\d+\.png/);
  assert.equal(luka.injury.status, "Day-To-Day");
  const grimes = r.athletes.find((a) => a.name === "Quentin Grimes");
  assert.equal(grimes.salary, null);                                 // no 2026-27 contract row → null, not last year's
  const bronny = r.athletes.find((a) => a.name === "Bronny James");
  assert.equal(bronny.college, "");                                  // field removed in fixture → fallback
});

test("injuries: athlete id parsed from URLs because ESPN omits athlete.id", () => {
  const list = normalizeInjuries(fx("injuries"));
  assert.ok(list.length > 3);
  for (const i of list) {
    assert.match(i.athlete.id, /^\d+$/);
    assert.equal(i.athlete.headshot, `${HEADSHOT_BASE}/${i.athlete.id}.png`);
    assert.ok(i.team.abbr && i.team.abbr !== "—");
    assert.ok(["Day-To-Day", "Out", "Suspension"].includes(i.status) || i.status);
  }
  assert.ok(list[0].date >= list[list.length - 1].date);             // newest first
});

test("standings: two conferences, parsed numbers, sorted by seed", () => {
  const s = normalizeStandings(fx("standings"));
  assert.equal(s.conferences.length, 2);
  const east = s.conferences[0];
  assert.equal(east.abbr, "East");
  for (const t of east.teams) {
    assert.equal(typeof t.wins, "number");
    assert.match(t.home, /^\d+-\d+$/);
  }
  const seeds = east.teams.map((t) => t.seed);
  assert.deepEqual(seeds, [...seeds].sort((a, b) => a - b));
});

test("transactions and teams", () => {
  const tx = normalizeTransactions(fx("transactions"));
  assert.equal(tx.length, 8);
  assert.equal(tx[0].kind, "signing");
  assert.ok(tx.some((t) => t.kind === "trade" || t.kind === "release"));
  const teams = normalizeTeams(fx("teams"));
  assert.equal(teams.length, 30);
  assert.ok(teams.find((t) => t.abbr === "GS" && t.id === "9"));
});

test("fallbacks: empty or malformed payloads never throw", () => {
  for (const bad of [undefined, null, {}, [], "oops", { events: "nope" }, { injuries: [{ injuries: [{}] }] }]) {
    assert.doesNotThrow(() => normalizeScoreboard(bad));
    assert.doesNotThrow(() => normalizeSummary(bad));
    assert.doesNotThrow(() => normalizeRoster(bad));
    assert.doesNotThrow(() => normalizeInjuries(bad));
    assert.doesNotThrow(() => normalizeStandings(bad));
    assert.doesNotThrow(() => normalizeTransactions(bad));
    assert.doesNotThrow(() => normalizeTeams(bad));
  }
  const g = normalizeScoreboard({ events: [{ id: "1", competitions: [{ competitors: [{ homeAway: "home" }] }] }] }).games[0];
  assert.equal(g.status.state, "unknown");
  assert.equal(g.home.abbr, "—");
  assert.equal(g.home.score, null);
  assert.equal(g.away, null);
  const inj = normalizeInjuries({ injuries: [{ id: "5", displayName: "Boston Celtics", injuries: [{ athlete: { displayName: "New Guy" } }] }] })[0];
  assert.equal(inj.team.displayName, "Boston Celtics");                // team falls back to the group
  assert.equal(inj.athlete.id, null);
  assert.equal(inj.athlete.headshot, null);                           // no id, no href → UI shows initials
  assert.equal(inj.athlete.initials, "NG");
});

test("headshot helpers", () => {
  assert.equal(athleteId({ id: "123" }), "123");
  assert.equal(athleteId({ headshot: { href: `${HEADSHOT_BASE}/456.png` } }), "456");
  assert.equal(athleteId({ links: [{ href: "https://www.espn.com/nba/player/_/id/789/some-guy" }] }), "789");
  assert.equal(athleteId({}), null);
  assert.equal(headshot({ id: "1" }).url, `${HEADSHOT_BASE}/1.png`);
  assert.equal(headshot({ headshot: "https://example.com/x.png" }).url, "https://example.com/x.png");
  assert.equal(currentSalary({ contract: { salary: 5 } }, 2027), 5);
  assert.equal(num("1,234"), 1234);
  assert.equal(num("—"), null);
});
