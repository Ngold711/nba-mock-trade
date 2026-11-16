// Five-position and starting-lineup resolver: the one place Hooptrax decides PG / SG / SF / PF / C.
//
// ESPN rosters and box scores only say G, F or C, so a five-slot position is resolved from, in order:
//   1. the official NBA 2K27 primary position, when the synced ratings feed supplies one (`position`);
//   2. ESPN's live team depth chart (the slot where the player is listed highest);
//   3. his ESPN G / F / C group plus live per-game stats (assists split guards, rebounds and height split forwards).
// Each team's starting five is the five players who started its most recent completed game (box score
// `starter: true`), so an injured starter's replacement holds the spot and the starter returns the night he
// starts again. Before a team has played (or if its box score can't be read), the depth chart's #1s are used.
// The five starters are placed in the five slots by the lowest-cost assignment (all 120 orders).
// Pure: the service (service/espn.js → loadLineups) feeds it ESPN payloads.
export const SLOTS = ["PG", "SG", "SF", "PF", "C"];
const GROUP = { PG: "G", SG: "G", SF: "F", PF: "F", C: "C" };
const inches = (ht) => { const m = /(\d+)'\s*(\d+)/.exec(ht || ""); return m ? +m[1] * 12 + +m[2] : null; };

/** Slot where a player is listed highest on his team's depth chart: { [playerId]: { slot, rank } }. */
export function depthSlots(depth) {
  const pos = depth?.depthchart?.[0]?.positions || {};
  const out = {};
  for (const s of SLOTS) (pos[s.toLowerCase()]?.athletes || []).forEach((a, rank) => {
    const id = String(a?.id || ""); if (!id) return;
    if (!out[id] || rank < out[id].rank) out[id] = { slot: s, rank };
  });
  return out;
}

/** A player's primary five-slot position and where it came from. */
export function primaryPosition({ group = "", official = null, depth = null, stats = null, height = null } = {}) {
  const off = String(official || "").toUpperCase().split(/[-/ ]/)[0];
  if (SLOTS.includes(off)) return { pos: off, source: "2k" };
  const g = String(group || "").toUpperCase();
  if (depth?.slot) {
    // cross-check: ESPN's roster group is coarse (wings are often "G", bigs "F"), so the depth chart wins, except
    // that a player ESPN lists as a pure forward is never placed at a guard slot (Michael Porter Jr.: depth SG → SF)
    if (/^F$|^F-C$|^PF$|^SF$/.test(g) && GROUP[depth.slot] === "G") return { pos: "SF", source: "depth+group" };
    return { pos: depth.slot, source: "depth" };
  }
  const s = stats || {}, h = inches(height) || 0;
  if (/^C/.test(g)) return { pos: "C", source: "group" };
  if (/^G/.test(g)) return { pos: (s.ast || 0) >= 4.5 || ((s.ast || 0) >= 3 && (s.ast || 0) * 2.2 >= (s.pts || 0)) ? "PG" : "SG", source: "group" };
  if (/^F/.test(g)) return { pos: (s.reb || 0) >= 6.5 || h >= 81 ? "PF" : "SF", source: "group" };
  return { pos: "SF", source: "group" };
}

/** Cost of playing someone at a slot: his primary slot is free, a neighbouring slot is cheap, his box-score group helps. */
export function slotCost(p, slot) {
  const d = Math.abs(SLOTS.indexOf(p.pos) - SLOTS.indexOf(slot));      // PG→SG is a step; PF→PG is three
  let c = [0, 1.5, 3.5, 6, 8][d] ?? 8;
  if (p.group && GROUP[slot] !== p.group.charAt(0)) c += p.group.charAt(0) === "C" && slot === "PF" ? 0.5 : 1;
  return c;
}
/** Lowest-cost placement of five starters into PG/SG/SF/PF/C (ties keep box-score order). */
export function assignSlots(five) {
  let best = null;
  const arr = [...five];
  const go = (k) => {
    if (k === arr.length) {
      const cost = arr.reduce((s, p, i) => s + slotCost(p, SLOTS[i]), 0);
      if (!best || cost < best.cost - 1e-9) best = { cost, order: [...arr] };
      return;
    }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; go(k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  go(0);
  return Object.fromEntries(SLOTS.map((s, i) => [s, best.order[i]]));
}

/** Starters of a team from an ESPN summary payload: [{ id, name, group }] in box-score order, or null. */
export function boxStarters(summary, teamAbbr) {
  const t = (summary?.boxscore?.players || []).find((x) => x.team?.abbreviation === teamAbbr);
  const st = (t?.statistics?.[0]?.athletes || []).filter((a) => a.starter && a.athlete?.id);
  return st.length === 5 ? st.map((a) => ({ id: String(a.athlete.id), name: a.athlete.displayName, group: a.athlete.position?.abbreviation || "" })) : null;
}
/** Most recent completed game in an ESPN team schedule payload: { id, date } or null. */
export function lastCompleted(schedule) {
  const done = (schedule?.events || []).filter((e) => e.competitions?.[0]?.status?.type?.completed);
  done.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const e = done.at(-1);
  return e ? { id: String(e.id), date: e.date, name: e.shortName || e.name || "" } : null;
}

/**
 * teams: [{ team: { id, abbr }, depth, lastGame: { id, date } | null, starters: [{ id, name, group }] | null }]
 * league: { players }, stats: { players: [{ id, stats }] }, official: Map(playerId → 2K27 position)
 * → { asOf, source, primary: { id: { pos, source } }, teams: { abbr: { PG: card, …, lastGame, from } }, positions: { PG: [30], … } }
 */
export function resolveLineups({ teams = [], league = null, stats = null, official = new Map() } = {}, now = new Date()) {
  const roster = new Map((league?.players || []).map((p) => [String(p.id), p]));
  const st = new Map((stats?.players || []).map((p) => [String(p.id), p.stats || null]));
  const slotsByTeam = new Map(teams.map((t) => [t.team.abbr, depthSlots(t.depth)]));
  const primary = {};
  for (const p of league?.players || []) {
    const id = String(p.id);
    primary[id] = primaryPosition({ group: p.position, official: official.get(id), depth: slotsByTeam.get(p.teamAbbr)?.[id], stats: st.get(id), height: p.height });
  }
  const card = (id, name, team, slot) => {
    const r = roster.get(id) || {};
    return { id, name: r.name || name, teamAbbr: team.abbr, slot, position: primary[id]?.pos || slot, group: r.position || "", headshot: r.headshot || `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`, mpg: st.get(id)?.min || 0 };
  };
  const out = {};
  let fromBox = 0;
  for (const { team, depth, lastGame, starters } of teams) {
    let five = null, from = "box";
    if (starters?.length === 5) five = starters.map((s) => ({ ...s, pos: primary[s.id]?.pos || primaryPosition({ group: s.group }).pos }));
    if (!five) {                                            // depth chart #1s, one player per slot
      from = "depth";
      const pos = depth?.depthchart?.[0]?.positions || {}, used = new Set();
      five = SLOTS.map((s) => { const a = (pos[s.toLowerCase()]?.athletes || []).find((x) => x?.id && !used.has(String(x.id))); if (!a) return null; used.add(String(a.id));
        return { id: String(a.id), name: a.displayName, group: roster.get(String(a.id))?.position || "", pos: s }; }).filter(Boolean);
    }
    if (five.length < 5) {                                  // fill from the roster by minutes (rare: missing data)
      from = from === "box" ? "box" : "minutes";
      const have = new Set(five.map((p) => p.id));
      const extra = (league?.players || []).filter((p) => p.teamAbbr === team.abbr && !have.has(String(p.id))).sort((a, b) => (st.get(String(b.id))?.min || 0) - (st.get(String(a.id))?.min || 0));
      for (const p of extra) { if (five.length >= 5) break; five.push({ id: String(p.id), name: p.name, group: p.position || "", pos: primary[String(p.id)]?.pos || "SF" }); }
    }
    if (five.length < 5) continue;
    if (from === "box") fromBox++;
    const placed = assignSlots(five);
    out[team.abbr] = { ...Object.fromEntries(SLOTS.map((s) => [s, card(placed[s].id, placed[s].name, team, s)])), lastGame: from === "box" ? lastGame : null, from };
  }
  const positions = Object.fromEntries(SLOTS.map((s) => {
    const seen = new Set();
    return [s, Object.values(out).map((t) => t[s]).filter((p) => p && !seen.has(p.id) && seen.add(p.id)).sort((a, b) => a.teamAbbr.localeCompare(b.teamAbbr))];
  }));
  return { asOf: now.toISOString(), source: `Starters from each team's latest box score (${fromBox}/${teams.length} teams; others from ESPN depth charts). Slots from official 2K27 positions where synced, then ESPN depth charts.`,
    primary, teams: out, positions };
}
