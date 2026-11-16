import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNbaMovement, mergeTransactions, transactionKind, newest } from "../service/transactions.js";

const espn = [
  { date: "2026-11-13T08:00Z", description: "Signed C Johni Broome to a two-way contract.", kind: "signing", team: { abbr: "MIN" } },
  { date: "2026-11-11T08:00Z", description: "Waived C Lawson Lovering.", kind: "release", team: { abbr: "MIN" } },
];
const nbaJson = { NBA_Player_Movement: { rows: [
  { Transaction_Type: "Signing", TRANSACTION_DATE: "2026-11-15T00:00:00", TRANSACTION_DESCRIPTION: "Cleveland Cavaliers guaranteed the contract of Mario Hezonja.", TEAM_ID: 1610612739 },
  { Transaction_Type: "Signing", TRANSACTION_DATE: "2026-11-13T00:00:00", TRANSACTION_DESCRIPTION: "Minnesota Timberwolves signed Johni Broome to a two-way contract.", TEAM_ID: 1610612750 },
] } };

test("NBA.com movement fills days ESPN hasn't posted; duplicates are merged; newest first", () => {
  const nba = normalizeNbaMovement(nbaJson);
  assert.equal(nba[0].team.abbr, "CLE"); assert.equal(nba[0].kind, "contract");
  const list = mergeTransactions(espn, nba);
  assert.equal(list[0].description, "Cleveland Cavaliers guaranteed the contract of Mario Hezonja.");
  assert.equal(list.filter((t) => /Broome/.test(t.description)).length, 1, "same move from both sources appears once");
  assert.equal(newest(list).slice(0, 10), "2026-11-15");
});
test("transaction kinds", () => {
  assert.equal(transactionKind("Guaranteed the contract of F Mario Hezonja."), "contract");
  assert.equal(transactionKind("Assigned G X to the G League."), "assignment");
  assert.equal(transactionKind("Suspended F Y two games."), "suspension");
});
