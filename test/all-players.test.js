import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDirectory, filterDirectory } from "../service/directory.js";

const ALL = JSON.parse(readFileSync(new URL("../all_players.json", import.meta.url), "utf8"));
const H = JSON.parse(readFileSync(new URL("../nba_history.json", import.meta.url), "utf8"));
const league = { players: [{ id: "1966", name: "LeBron James", teamAbbr: "LAL", position: "F" }, { id: "999001", name: "Brand New Rookie", teamAbbr: "SAS", position: "G" }] };
const D = buildDirectory({ league, legends: H.legends, all: ALL });

test("all_players.json: every NBA/ABA/BAA player, deduplicated, with a G/F/C group", () => {
  assert.ok(ALL.count > 5000);
  const ids = ALL.players.map((r) => r[0]); assert.equal(new Set(ids).size, ids.length);
  assert.ok(ALL.players.every((r) => /^[GFC]+$/.test(r[3])));
});
test("directory: Top 75 = 76 honorees, 180 Hall of Famers (155 as players), positions everywhere", () => {
  assert.equal(filterDirectory(D, "top75").length, 76);
  const hof = filterDirectory(D, "hof"); assert.equal(hof.length, 180);
  assert.equal(hof.filter((p) => p.hofRole === "player").length, 155);
  assert.equal(D.find((p) => p.name === "Pat Riley").hofRole, "coach");
  const k = D.find((p) => p.name === "Kareem Abdul-Jabbar");
  assert.deepEqual([k.years, k.pos, k.g, k.id], ["1969–1989", "C", ["C"], "4145"]);
  assert.ok(filterDirectory(D, "C").some((p) => p.name === "Kareem Abdul-Jabbar"));
  assert.ok(D.every((p) => p.g.length));
});
test("live rosters merge in: active flag, team, ESPN id; unknown actives are added once", () => {
  const lb = D.filter((p) => p.name === "LeBron James"); assert.equal(lb.length, 1);
  assert.deepEqual([lb[0].active, lb[0].team, lb[0].id], [true, "LAL", "1966"]);
  assert.ok(D.some((p) => p.name === "Brand New Rookie" && p.active));
  assert.equal(filterDirectory(D, "all", "kukoc")[0].name, "Toni Kukoč");
});
