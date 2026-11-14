import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTrade, matchingLimit, teamTier, resolveSalary, estimateSalary, firstRoundHoldings, stepienCheck, encodeTrade, decodeTrade, money } from "../service/trade.js";

const book = JSON.parse(readFileSync(new URL("../salaries_2026_27.json", import.meta.url)));
const picks = JSON.parse(readFileSync(new URL("../draft_picks_2027_2029.json", import.meta.url)));
const cba = book.cba;
const P = (name, salary) => ({ kind: "player", name, salary });
const pick = (year, round = 1, origin) => ({ kind: "pick", name: `${year} pick`, salary: 0, year, round, origin });

test("cap tiers and matching bands", () => {
  assert.equal(teamTier(150, cba), "under");
  assert.equal(teamTier(180, cba), "over");
  assert.equal(teamTier(cba.firstApron + 1, cba), "apron1");
  assert.equal(teamTier(cba.secondApron + 1, cba), "apron2");
  assert.equal(matchingLimit(5, cba), 10.25);                      // 200% + $250K
  assert.equal(matchingLimit(20, cba), 20 + cba.matching.midAdd);   // flat band
  assert.equal(matchingLimit(40, cba), 50.25);                      // 125% + $250K
});

test("over-cap matching passes and fails with the exact shortfall", () => {
  const ok = validateTrade([{ abbr: "A", payroll: 180, sends: [P("x", 40)], receives: [P("y", 50)] }, { abbr: "B", payroll: 180, sends: [P("y", 50)], receives: [P("x", 40)] }], { cba });
  assert.equal(ok.legal, true);
  const bad = validateTrade([{ abbr: "A", payroll: 180, sends: [P("x", 40)], receives: [P("y", 55)] }, { abbr: "B", payroll: 180, sends: [P("y", 55)], receives: [P("x", 40)] }], { cba });
  assert.equal(bad.legal, false);
  assert.equal(bad.status, "failed");
  assert.ok(Math.abs(bad.teams[0].need - 4.75) < 1e-9);
  assert.match(bad.reasons[0], /^A: .*\$4\.8M over/);
});

test("apron teams are held to 100%; 2nd apron can't aggregate", () => {
  const ap1 = validateTrade([{ abbr: "A", payroll: cba.firstApron + 2, sends: [P("x", 20)], receives: [P("y", 20.5)] }, { abbr: "B", payroll: 150, sends: [P("y", 20.5)], receives: [P("x", 20)] }], { cba });
  assert.equal(ap1.teams[0].ok, false);
  assert.match(ap1.teams[0].errors[0], /First Apron/);
  // a team that would cross the first apron by taking back more is also limited
  const cross = validateTrade([{ abbr: "A", payroll: cba.firstApron - 1, sends: [P("x", 20)], receives: [P("y", 25)] }, { abbr: "B", payroll: 150, sends: [P("y", 25)], receives: [P("x", 20)] }], { cba });
  assert.equal(cross.teams[0].ok, false);
  const agg = validateTrade([{ abbr: "A", payroll: cba.secondApron + 5, sends: [P("x", 15), P("z", 15)], receives: [P("y", 28)] }, { abbr: "B", payroll: 150, sends: [P("y", 28)], receives: [P("x", 15), P("z", 15)] }], { cba });
  assert.equal(agg.teams[0].ok, false);
  assert.ok(agg.teams[0].errors.some((e) => /aggregate/.test(e)));
});

test("under-cap teams absorb into room", () => {
  const v = validateTrade([{ abbr: "A", payroll: 140, sends: [], receives: [P("y", 20)] }, { abbr: "B", payroll: 190, sends: [P("y", 20)], receives: [pick(2028, 2)] }], { cba });
  assert.equal(v.legal, true);
  assert.match(v.teams[0].rule, /cap space/);
});

test("Stepien rule on 2027–2029 firsts, and owed picks can't be traded", () => {
  const h = { 2027: { own: false, owedTo: "X", acquired: [] }, 2028: { own: true, acquired: [] }, 2029: { own: true, acquired: [] } };
  const bad = stepienCheck({ abbr: "A", holdings: h, sends: [pick(2028)], receives: [] });
  assert.match(bad.errors.join(" "), /Stepien.*2027 & 2028/);
  const fine = stepienCheck({ abbr: "A", holdings: h, sends: [pick(2029)], receives: [] });
  assert.equal(fine.errors.length, 0);
  const owed = stepienCheck({ abbr: "A", holdings: h, sends: [pick(2027)], receives: [] });
  assert.match(owed.errors[0], /already owed to X/);
  // config-driven holdings: Dallas owes its 2027 first (top-2 protected) to Charlotte
  const dal = firstRoundHoldings("DAL", picks);
  assert.equal(dal[2027].own, false);
  assert.ok(firstRoundHoldings("CHA", picks)[2027].acquired.includes("DAL"));
});

test("sandbox mode keeps the math but accepts the deal", () => {
  const teams = [{ abbr: "A", payroll: 180, sends: [P("x", 10)], receives: [P("y", 60)] }, { abbr: "B", payroll: 180, sends: [P("y", 60)], receives: [P("x", 10)] }];
  const s = validateTrade(teams, { cba, strict: false });
  assert.equal(s.legal, false); assert.equal(s.accepted, true); assert.equal(s.status, "sandbox");
  assert.equal(validateTrade(teams, { cba, strict: true }).accepted, false);
  assert.equal(validateTrade([{ abbr: "A", payroll: 1, sends: [], receives: [] }], { cba }).status, "incomplete");
});

test("roster size warnings", () => {
  const v = validateTrade([{ abbr: "A", payroll: 180, rosterCount: 15, sends: [P("x", 20)], receives: [P("y", 10), P("z", 10)] }, { abbr: "B", payroll: 180, rosterCount: 12, sends: [P("y", 10), P("z", 10)], receives: [P("x", 20)] }], { cba });
  assert.ok(v.warnings.some((w) => /A: Roster goes to 16 standard/.test(w)));
  assert.ok(v.warnings.some((w) => /B: Roster drops to 11/.test(w)));
});

test("salaries: live contract → book → estimate, never $0", () => {
  assert.deepEqual(resolveSalary({ salary: 62587158 }), { salary: 62.59, source: "espn" });
  const [id, entry] = Object.entries(book.players)[0];
  assert.equal(resolveSalary({ id }, { book }).source, "book");
  assert.equal(resolveSalary({ id }, { book }).salary, entry.salary);
  const vetMin = estimateSalary({ experience: 12, stats: { gp: 10, pts: 2, min: 8 } }, cba);
  assert.ok(vetMin >= 2.3 && vetMin <= 3.6);
  const rookie = estimateSalary({ experience: 0, stats: { gp: 10, pts: 15, min: 28 } }, cba);
  assert.ok(rookie >= 3 && rookie <= 12);
  const rotation = estimateSalary({ experience: 6, stats: { gp: 10, pts: 14, min: 28 } }, cba);
  assert.ok(rotation >= 14 && rotation <= 22);
  assert.ok(estimateSalary({}, cba) > 0);
  assert.equal(money(-4.1, { sign: true }), "−$4.1M");
  assert.equal(money(3.2, { sign: true }), "+$3.2M");
});

test("?trade= links round-trip teams, ESPN player ids and picks", () => {
  const state = { teams: ["LAL", "BKN", null], assets: [{ id: "LAL:p3945274", to: "BKN" }, { id: "BKN:2027-1@NYK", to: "LAL" }, { id: "BKN:2029-2", to: "LAL" }, { id: "LAL:old-name", to: "BKN" }] };
  const enc = encodeTrade(state);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  const dec = decodeTrade(enc, () => true);
  assert.deepEqual(dec.teams, ["LAL", "BKN", null]);
  assert.deepEqual(dec.assets, state.assets);
  assert.equal(decodeTrade("garbage!!"), null);
});
