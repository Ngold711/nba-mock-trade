// Coaches, executives, owners and the 30 front offices (nba_people.json + service/people.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchPeople, personProfile, frontOffices, byPlayerId } from "../service/people.js";

const P = JSON.parse(readFileSync(new URL("../nba_people.json", import.meta.url), "utf8"));
const H = JSON.parse(readFileSync(new URL("../nba_history.json", import.meta.url), "utf8"));
const CODES = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];

test("front offices: all 30 teams; every verified entry names its source; person links resolve", () => {
  assert.deepEqual(Object.keys(P.teams).sort(), [...CODES].sort());
  const ids = new Set(P.people.map((p) => p.id));
  for (const [code, t] of Object.entries(P.teams)) for (const k of ["president", "gm", "owner"]) {
    const x = t[k]; if (!x) continue;
    assert.equal(typeof x.verified, "boolean", `${code}.${k}`);
    if (x.verified) assert.ok(x.source, `${code}.${k} verified without a source`);
    if (x.person) assert.ok(ids.has(x.person), `${code}.${k} → ${x.person}`);
  }
  // 2026 changes confirmed in reporting
  assert.equal(P.teams.DAL.president.name, "Masai Ujiri"); assert.equal(P.teams.PHI.president.name, "Mike Gansey");
  assert.equal(P.teams.ATL.president.name, "Onsi Saleh"); assert.equal(P.teams.POR.owner.name, "Tom Dundon");
});

test("people: roles, multi-role links to ESPN player ids, finished-career records add up", () => {
  for (const p of P.people) {
    assert.ok(p.roles.length && p.roles.every((r) => ["player", "coach", "exec", "owner"].includes(r)), p.id);
    for (const r of p.roles) if (r !== "player") assert.ok(p[r], `${p.id} missing ${r} block`);
    if (p.coach?.record) assert.ok(p.coach.record.w > 0 && p.coach.record.l > 0, p.id);
    if (p.coach?.current) assert.ok(p.coach.stints.some((s) => s.to == null && s.team === p.coach.current), `${p.id} current stint`);
  }
  const multi = ["michael-jordan", "larry-bird", "pat-riley", "jerry-west", "steve-kerr", "danny-ainge", "doc-rivers", "jj-redick", "bill-russell"];
  for (const id of multi) { const p = P.people.find((x) => x.id === id); assert.ok(p && p.roles.length >= 2 && p.roles.includes("player"), id); }
  assert.equal(byPlayerId(P.people).get("1035").id, "michael-jordan");
  const pop = P.people.find((x) => x.id === "gregg-popovich");
  assert.deepEqual(pop.coach.titles, [1999, 2003, 2005, 2007, 2014]);
});

test("search people by name and role", () => {
  assert.equal(searchPeople("riley", P.people)[0].id, "pat-riley");
  assert.deepEqual(searchPeople("sp", P.people, { role: "coach" }).map((p) => p.id), ["erik-spoelstra"]);
  assert.ok(searchPeople("jordan", P.people, { role: "owner" }).some((p) => p.id === "michael-jordan"));
  assert.equal(searchPeople("jordan", P.people, { role: "coach" }).length, 0);
  assert.equal(searchPeople("x", P.people).length, 0);
});

test("person profile: coach record and win %, live season for current coaches, owner and exec eras", () => {
  const standings = { conferences: [{ abbr: "East", teams: [{ team: { abbr: "BOS" }, wins: 10, losses: 2, seed: 1 }] }] };
  const riley = personProfile(P.people.find((p) => p.id === "pat-riley"), { history: H });
  assert.equal(riley.coach.record.pct, 0.636); assert.equal(riley.coach.record.playoffPct, 0.606);
  assert.deepEqual(riley.exec.titles, [2006, 2012, 2013]); assert.equal(riley.player.playerId, "5898");
  const maz = personProfile(P.people.find((p) => p.id === "joe-mazzulla"), { standings });
  assert.deepEqual(maz.coach.current, { team: "BOS", w: 10, l: 2, seed: 1, conf: "East" });
  assert.equal(maz.coach.record, null);
  const mj = personProfile(P.people.find((p) => p.id === "michael-jordan"), {});
  assert.equal(mj.owner.teams[0].code, "CHA"); assert.equal(mj.owner.teams[0].years, "2010–2023");
  const doc = personProfile(P.people.find((p) => p.id === "doc-rivers"), { history: H });
  assert.ok(doc.player.career && doc.player.career.gp > 800);           // career totals from the legends archive
  const bick = personProfile(P.people.find((p) => p.id === "jb-bickerstaff"), { history: H });
  assert.deepEqual(bick.coach.coy, [2026]);
});

test("front offices join the live ESPN head coach", () => {
  const league = { teams: { BOS: { displayName: "Boston Celtics", coach: "Joe Mazzulla", logo: "bos.png" }, GS: { displayName: "Golden State Warriors", coach: "Steve Kerr" } } };
  const fo = frontOffices(P, league);
  assert.equal(fo.length, 30);
  const bos = fo.find((t) => t.team === "BOS");
  assert.deepEqual([bos.coach.name, bos.coach.person, bos.coach.verified], ["Joe Mazzulla", "joe-mazzulla", true]);
  assert.equal(fo.find((t) => t.team === "GSW").coach.person, "steve-kerr");
  assert.equal(fo.find((t) => t.team === "ATL").coach, null);            // no ESPN coach → nothing invented
});

import { directory } from "../service/people.js";
test("directory: every current coach (live ESPN), president/GM and owner gets a searchable, linked profile", () => {
  const league = { teams: Object.fromEntries(CODES.map((c) => [({ GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" })[c] || c, { coach: c === "BOS" ? "Joe Mazzulla" : c === "IND" ? "Rick Carlisle" : `Coach ${c}` }])) };
  const d = directory(P, league);
  for (const c of CODES) {
    assert.ok(d.link[c].coach, `${c} coach linked`); assert.ok(d.link[c].owner, `${c} owner linked`);
    assert.ok(d.link[c].president || d.link[c].gm, `${c} front office linked`);
  }
  const ids = d.people.map((p) => p.id); assert.equal(new Set(ids).size, ids.length, "unique ids");
  assert.equal(d.people.find((p) => p.id === "rick-carlisle").coach.current, "IND");
  assert.equal(d.people.find((p) => p.id === "doc-rivers").coach.current, null, "current job re-derived from ESPN");
  assert.equal(searchPeople("coach atl", d.people, { role: "coach" })[0].team, "ATL");
  assert.equal(searchPeople("bobby webster", d.people, { role: "exec" })[0].team, "TOR");
  const austin = personProfile(d.people.find((p) => p.id === "austin-ainge"), { league });
  assert.deepEqual([austin.jobs[0].code, austin.jobs[0].title, austin.jobs[0].since], ["UTA", "President of Basketball Operations", 2025]);
  const maz = personProfile(d.people.find((p) => p.id === "joe-mazzulla"), { league });
  assert.equal(maz.jobs[0].since, 2022); assert.ok(maz.highlights.some((h) => /2024/.test(h)));
  const fo = frontOffices(P, league);
  assert.ok(fo.every((t) => t.coach.person && t.owner.person && (t.president || t.gm).person));
});
test("archive covers 75+ notable all-time coaches, executives and owners", () => {
  const notable = P.people.filter((p) => p.roles.some((r) => r !== "player"));
  assert.ok(notable.length >= 100, `${notable.length}`);
  for (const id of ["phil-jackson", "red-auerbach", "gregg-popovich", "pat-riley", "jerry-west", "bob-myers", "sam-presti", "masai-ujiri", "daryl-morey", "rc-buford", "danny-ainge", "don-nelson", "lenny-wilkens", "george-karl", "jerry-sloan", "rick-carlisle", "doc-rivers", "mike-dantoni", "rudy-tomjanovich", "chuck-daly", "hubie-brown", "jerry-buss", "mark-cuban", "steve-ballmer", "joe-lacob", "micky-arison", "peter-holt", "wyc-grousbeck"])
    assert.ok(P.people.some((p) => p.id === id), id);
});

test("every front-office and ownership entry is verified, sourced and has a start year where known", () => {
  for (const [code, t] of Object.entries(P.teams)) for (const r of ["president", "gm", "owner"]) {
    const x = t[r]; if (!x) continue;
    assert.equal(x.verified, true, `${code} ${r}`); assert.ok(x.source, `${code} ${r} source`);
  }
  for (const c of CODES) { assert.ok(P.teams[c].owner?.since, `${c} owner since`); assert.ok((P.teams[c].president || P.teams[c].gm)?.since, `${c} exec since`); }
});
