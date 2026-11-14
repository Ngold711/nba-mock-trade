// All-Star voting: player pool (never empty) + ballot slot logic. Pure, shared by the page and tests.
//
// Pool sources, best first, merged by ESPN athlete id:
//   1. league-wide season stats (statistics/byathlete)  → averages
//   2. all 30 live ESPN rosters (/api/league)            → every active player, headshots, positions
//   3. the bundled roster snapshot (data.js)             → offline last resort, so the list is never blank
// Conference comes from the fixed NBA division map, not standings, so a standings outage can't empty it.

export const STARTER_SLOTS = ["G", "G", "FC", "FC", "FC"];   // NBA ballot: 2 backcourt + 3 frontcourt
export const RESERVES = 7, MENTIONS = 3;
export const CONF_OF = {
  ATL: "East", BOS: "East", BKN: "East", CHA: "East", CHI: "East", CLE: "East", DET: "East", IND: "East",
  MIA: "East", MIL: "East", NY: "East", ORL: "East", PHI: "East", TOR: "East", WSH: "East",
  DAL: "West", DEN: "West", GS: "West", HOU: "West", LAC: "West", LAL: "West", MEM: "West", MIN: "West",
  NO: "West", OKC: "West", PHX: "West", POR: "West", SAC: "West", SA: "West", UTAH: "West",
};
const CODE_TO_ESPN = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" };
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const initials = (n) => { const p = String(n).replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/); return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?"; };

/** G → backcourt; F / C (and hybrids) → frontcourt. */
export const groupOf = (pos) => (/^\s*(PG|SG|G)/i.test(String(pos || "")) ? "G" : "FC");   // PG, SG, G, G/F → backcourt

/**
 * @param {{ players?, league?, snapshot?, scores?: Record<string, number> }} src
 * @returns {{ pool: PoolPlayer[], source: "stats"|"rosters"|"snapshot", counts: object }}
 */
export function buildPool({ players = null, league = null, snapshot = null, scores = {} } = {}) {
  const byId = new Map();
  const statsById = new Map((players?.players || []).map((p) => [String(p.id), p]));
  const teamLook = (abbr) => {
    const t = league?.teams?.[abbr];
    return { abbr, name: t?.name || abbr, displayName: t?.displayName || abbr, color: t?.color || "#64748B", logo: t?.logo || `https://a.espncdn.com/i/teamlogos/nba/500/${String(abbr).toLowerCase()}.png` };
  };
  const add = (p, origin) => {
    const abbr = p.teamAbbr;
    const conf = CONF_OF[abbr];
    if (!conf || !p.id) return;
    const s = statsById.get(String(p.id))?.stats || p.stats || null;
    byId.set(String(p.id), {
      id: String(p.id), name: p.name, initials: p.initials || initials(p.name),
      headshot: p.headshot || null, headshotSmall: p.headshotSmall || p.headshot || null,
      teamAbbr: abbr, team: teamLook(abbr), conf, position: p.position || "",
      group: groupOf(p.position), jersey: p.jersey || "",
      stats: s && (s.gp || s.pts) ? { gp: s.gp ?? null, pts: s.pts ?? null, reb: s.reb ?? null, ast: s.ast ?? null, min: s.min ?? null } : null,
      score: scores[String(p.id)] ?? (s?.pts != null ? s.pts + 0.5 * (s.reb || 0) + 0.7 * (s.ast || 0) : p.v ?? 0),
      injury: p.injury || null, origin,
    });
  };
  for (const p of league?.players || []) add(p, "roster");
  for (const p of players?.players || []) if (!byId.has(String(p.id))) add(p, "stats");
  let source = statsById.size ? "stats" : byId.size ? "rosters" : "snapshot";
  if (!byId.size && snapshot) {
    for (const [code, t] of Object.entries(snapshot)) {
      const abbr = CODE_TO_ESPN[code] || code;
      for (const [name, pos, , v] of t.players) {
        add({ id: `snap-${slug(name)}`, name, teamAbbr: abbr, position: String(pos).charAt(0), v }, "snapshot");
      }
    }
    source = "snapshot";
  }
  const pool = [...byId.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { pool, source, counts: { total: pool.length, withStats: pool.filter((p) => p.stats).length, east: pool.filter((p) => p.conf === "East").length, west: pool.filter((p) => p.conf === "West").length } };
}

/* ---------------- ballot ---------------- */
export const emptyConf = () => ({ starters: Array(5).fill(null), reserves: Array(RESERVES).fill(null), hm: Array(MENTIONS).fill(null), captain: null });
export const emptyBallot = () => ({ East: emptyConf(), West: emptyConf() });

/** Upgrade the v1 ballot ({ starters:[], reserves:[], captain }) to fixed slots. */
export function migrateBallot(old) {
  const b = emptyBallot();
  if (!old) return b;
  for (const c of ["East", "West"]) {
    const o = old[c]; if (!o) continue;
    const n = b[c];
    if (Array.isArray(o.starters) && o.starters.length === 5 && "hm" in o) return old;     // already v2
    (o.starters || []).slice(0, 5).forEach((id, i) => { n.starters[i] = id || null; });
    (o.reserves || []).slice(0, RESERVES).forEach((id, i) => { n.reserves[i] = id || null; });
    (o.hm || []).slice(0, MENTIONS).forEach((id, i) => { n.hm[i] = id || null; });
    n.captain = o.captain || null;
  }
  return b;
}

export const filled = (conf) => [...conf.starters, ...conf.reserves].filter(Boolean).length;      // out of 12
export const allIds = (conf) => [...conf.starters, ...conf.reserves, ...conf.hm].filter(Boolean);
export const slotOf = (conf, id) => {
  for (const kind of ["starters", "reserves", "hm"]) { const i = conf[kind].indexOf(id); if (i >= 0) return { kind, i }; }
  return null;
};

/**
 * Put a player on the ballot. With `target` ({kind, i}) it fills that slot (starter slots keep their
 * position); otherwise the next open matching starter → reserve → honorable mention.
 * @returns {{ ok: boolean, where?: {kind, i}, reason?: string, replaced?: string|null }}
 */
export function addToBallot(conf, player, target = null) {
  if (slotOf(conf, player.id)) return { ok: false, reason: `${player.name} is already on your ballot.` };
  if (target) {
    if (target.kind === "starters" && STARTER_SLOTS[target.i] !== player.group) {
      return { ok: false, reason: `That starter slot is for a ${STARTER_SLOTS[target.i] === "G" ? "guard" : "frontcourt player"}.` };
    }
    const replaced = conf[target.kind][target.i];
    conf[target.kind][target.i] = player.id;
    if (replaced && conf.captain === replaced) conf.captain = null;
    return { ok: true, where: target, replaced };
  }
  const si = conf.starters.findIndex((id, i) => !id && STARTER_SLOTS[i] === player.group);
  if (si >= 0) { conf.starters[si] = player.id; return { ok: true, where: { kind: "starters", i: si } }; }
  const ri = conf.reserves.indexOf(null);
  if (ri >= 0) { conf.reserves[ri] = player.id; return { ok: true, where: { kind: "reserves", i: ri } }; }
  const hi = conf.hm.indexOf(null);
  if (hi >= 0) { conf.hm[hi] = player.id; return { ok: true, where: { kind: "hm", i: hi } }; }
  return { ok: false, reason: "This conference's ballot is full. Remove someone first." };
}
export function removeFromBallot(conf, id) {
  const s = slotOf(conf, id); if (!s) return false;
  conf[s.kind][s.i] = null;
  if (conf.captain === id) conf.captain = null;
  return true;
}

/**
 * The live model's ballot for a conference: computeAllStar() picks when available, otherwise the pool's
 * best players by production with the same 2G/3FC starter rule.
 */
export function modelConf(conf, pool, allStar = null) {
  const out = emptyConf();
  const m = allStar?.[conf];
  if (m && m.starters.length) {
    const gs = m.starters.filter((p) => groupOf(p.position) === "G"), fcs = m.starters.filter((p) => groupOf(p.position) !== "G");
    [...gs, ...fcs].slice(0, 5).forEach((p, i) => { out.starters[i] = p.id; });
    m.reserves.slice(0, RESERVES).forEach((p, i) => { out.reserves[i] = p.id; });
    m.mentions.slice(0, MENTIONS).forEach((p, i) => { out.hm[i] = p.id; });
  } else {
    for (const p of pool.filter((x) => x.conf === conf && x.stats)) addToBallot(out, p);
    if (!allIds(out).length) for (const p of pool.filter((x) => x.conf === conf)) addToBallot(out, p);
  }
  out.captain = out.starters.find(Boolean) || null;
  return out;
}
