import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftOf, draftTeamAt } from "../service/player.js";
import { draftLine } from "../ui/encyclopedia.js";

const H = JSON.parse(readFileSync(new URL("../nba_history.json", import.meta.url), "utf8"));
const leg = (n) => H.legends.find((l) => l.name === n);
const line = (n, bio = null) => draftLine(draftOf(bio, leg(n)));

test("historical legends get full, era-correct draft lines", () => {
  assert.equal(line("Kareem Abdul-Jabbar"), "1969 • Rd 1 • Pick #1 (MIL)");
  assert.equal(line("Larry Bird"), "1978 • Rd 1 • Pick #6 (BOS)");
  assert.equal(line("Bill Russell"), "1956 • Rd 1 • Pick #2 (STL)");
  assert.equal(line("Wilt Chamberlain"), "1959 • Territorial Pick • PHW");
  assert.equal(line("Oscar Robertson"), "1960 • Territorial Pick • CIN");
  assert.equal(line("Moses Malone"), "1974 • ABA Draft • Rd 3 • Utah Stars");
  assert.equal(line("Dolph Schayes"), "1948 BAA • Rd 1 • Pick #4 (NYK)");
  assert.equal(line("Willis Reed"), "1964 • Rd 2 • Pick #8 (NYK)");
  assert.equal(line("Ben Wallace"), "Undrafted");
  assert.equal(line("Kobe Bryant"), "1996 • Rd 1 • Pick #13 (CHH)");
  assert.equal(line("Chris Paul"), "2005 • Rd 1 • Pick #4 (NOH)");
  assert.equal(line("Tim Duncan"), "1997 • Rd 1 • Pick #1 (SAS)");
  for (const l of H.legends) { const s = draftLine(draftOf(null, l)); assert.doesNotMatch(s, /null|undefined|NaN/, l.name); }
});
test("ESPN bio draft wins and gets the drafting franchise of that year", () => {
  assert.equal(draftLine(draftOf({ draft: { year: 1993, round: 1, pick: 6, team: "WSH" } }, null)), "1993 • Rd 1 • Pick #6 (WSB)");
  assert.equal(draftTeamAt("WSH", 2010), "WAS");
  assert.equal(draftOf({ draft: { text: "Undrafted" } }, { from: 1961 }), null, "no record for an early-era player is not 'Undrafted'");
});
