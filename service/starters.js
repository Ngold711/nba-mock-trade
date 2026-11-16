// Starting lineups for all 30 teams: the #1 player at PG, SG, SF, PF and C on ESPN's live depth charts.
// Each team contributes exactly one player per slot and nobody fills two slots. If a team's depth chart is
// missing, its five highest-minute players are assigned to the five slots by listed position.
// Pure: the service feeds it the depth charts, the league rosters and season stats.
export const SLOTS = ["PG", "SG", "SF", "PF", "C"];

/** How well an ESPN listed position ("G", "F", "C", "PG", "G-F"…) fits a slot (lower = better). */
export function fitCost(position, slot) {
  const p = String(position || "").toUpperCase();
  if (p === slot) return 0;
  const g = /G/.test(p), f = /F/.test(p), c = /C/.test(p);
  const want = { PG: g, SG: g, SF: f, PF: f, C: c }[slot];
  const near = { PG: false, SG: f, SF: g, PF: c, C: f }[slot];
  return want ? 1 : near ? 2 : 4;
}
/** Best assignment of up to five players to the five slots (all 120 orders; minutes break ties). */
export function assignSlots(players) {
  const five = players.slice(0, 5);
  let best = null;
  const perm = (arr, k = 0) => {
    if (k === arr.length) {
      const cost = arr.reduce((s, p, i) => s + (p ? fitCost(p.position, SLOTS[i]) : 9), 0);
      if (!best || cost < best.cost) best = { cost, order: [...arr] };
      return;
    }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  perm([...five, ...Array(Math.max(0, 5 - five.length)).fill(null)]);
  return Object.fromEntries(SLOTS.map((s, i) => [s, best.order[i] || null]));
}

/**
 * list: [{ team: { id, abbr, ... }, depth: ESPN depthcharts payload | null }]
 * → { asOf, source, teams: { abbr: { PG: player, … } }, positions: { PG: [30 players], … } }
 */
export function startersFrom(list, league = null, players = null, now = new Date()) {
  const roster = new Map((league?.players || []).map((p) => [String(p.id), p]));
  const mpg = new Map((players?.players || []).map((p) => [String(p.id), p.stats?.min || 0]));
  const card = (id, name, team) => {
    const r = roster.get(String(id)) || {};
    return { id: String(id), name: r.name || name, teamAbbr: team.abbr, position: r.position || "", headshot: r.headshot || `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`, mpg: mpg.get(String(id)) || 0 };
  };
  const teams = {};
  let fromDepth = 0;
  for (const { team, depth } of list) {
    const pos = depth?.depthchart?.[0]?.positions || {};
    const used = new Set(), out = {};
    for (const s of SLOTS) {
      const a = (pos[s.toLowerCase()]?.athletes || []).find((x) => x?.id && !used.has(String(x.id)));
      if (a) { used.add(String(a.id)); out[s] = card(a.id, a.displayName, team); }
    }
    if (SLOTS.every((s) => out[s])) { fromDepth++; teams[team.abbr] = out; continue; }
    // fallback: highest-minute rostered players, best positional fit
    const pool = (league?.players || []).filter((p) => p.teamAbbr === team.abbr && !used.has(String(p.id)))
      .sort((a, b) => (mpg.get(String(b.id)) || 0) - (mpg.get(String(a.id)) || 0)).slice(0, 5 - SLOTS.filter((s) => out[s]).length);
    const open = SLOTS.filter((s) => !out[s]);
    const fill = assignSlots(pool);
    const picks = SLOTS.map((s) => fill[s]).filter(Boolean);
    open.forEach((s, i) => { const p = picks[i]; if (p) out[s] = card(p.id, p.name, team); });
    teams[team.abbr] = out;
  }
  const positions = Object.fromEntries(SLOTS.map((s) => {
    const seen = new Set();
    return [s, Object.values(teams).map((t) => t[s]).filter((p) => p && !seen.has(p.id) && seen.add(p.id)).sort((a, b) => a.teamAbbr.localeCompare(b.teamAbbr))];
  }));
  return { asOf: now.toISOString(), source: `ESPN depth charts (${fromDepth}/${list.length} teams${fromDepth < list.length ? "; others by minutes played" : ""})`, teams, positions };
}
