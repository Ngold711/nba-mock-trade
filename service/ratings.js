// Hooptrax 2K27-style ratings. Pure: used by the service (/api/2k-ratings) and the tests.
//
// Official NBA 2K27 ratings only (synced by service/ratings2k.js). SEEDS mirror the bundled official snapshot and
// are used only if no feed is available at all. Nothing here estimates a 2K rating from box scores.
// Not affiliated with 2K, the NBA or ESPN.

export const SEEDS = [
  ["Shai Gilgeous-Alexander", 97, 0], ["Victor Wembanyama", 97, 0], ["Luka Doncic", 97, 1], ["Nikola Jokic", 96, 0],
  ["Giannis Antetokounmpo", 96, 0], ["Jalen Brunson", 95, 0], ["Anthony Edwards", 95, 0], ["Stephen Curry", 95, 2],
  ["Cade Cunningham", 94, 0], ["Kevin Durant", 93, 0], ["Jayson Tatum", 93, 0], ["Tyrese Maxey", 93, 1],
  ["Jaylen Brown", 92, 1], ["Anthony Davis", 91, 1], ["Cooper Flagg", 90, 3], ["Alperen Sengun", 89, 2],
  ["Yaxel Lendeborg", 83, 10], ["Caleb Wilson", 82, 5],
];
export const SEED_NOTE = "Official NBA 2K27 OVR from the bundled roster update.";

const nameKey = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ş/gi, "s").toLowerCase()
  .replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const SEED_BY = new Map(SEEDS.map(([n, ovr, d]) => [nameKey(n), { ovr, delta: d }]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r0 = (v) => Math.round(v);

export const ATTRS = [["shooting", "Shooting"], ["threePt", "3PT"], ["playmaking", "Playmaking"], ["finishing", "Finishing"], ["defense", "Defense"], ["rebounding", "Rebounding"], ["athleticism", "Athleticism"]];
export function tierOf(ovr) { return ovr >= 95 ? "gal" : ovr >= 90 ? "dia" : ovr >= 85 ? "ame" : ovr >= 80 ? "rub" : "base"; }

/** Map a raw stat onto a 2K-style 25–99 attribute scale. */
const scale = (x, lo, hi, min = 40, max = 99) => clamp(min + ((x - lo) / (hi - lo)) * (max - min), 25, 99);

/** Attribute ratings from per-game stats (+ position and age for athleticism). */
export function attributes(s, { position = "", age = null } = {}) {
  if (!s || !s.gp) return null;
  const big = /C/.test(position), guard = /G/.test(position) && !/F/.test(position);
  const fga = s.fga || 0, tpm = s.tpm || 0, fta = s.fta || 0;
  const ts = fga + 0.44 * fta > 0 ? s.pts / (2 * (fga + 0.44 * fta)) : 0;
  const shooting = scale((s.ftPct || 70) * 0.35 + (s.threePct || 30) * 0.35 + ts * 100 * 0.3, 40, 68);
  const threePt = tpm < 0.3 ? scale(s.threePct || 20, 10, 60, 30, 70) : scale((s.threePct || 30) + tpm * 3, 30, 52);
  const playmaking = scale(s.ast - 0.4 * (s.tov || 0) + (guard ? 1 : 0), 0, 8.5);
  const finishing = scale(s.pts * 0.55 + (s.fgPct || 45) * 0.25 + fta * 0.9, 10, 36);
  const defense = scale((s.stl || 0) * 9 + (s.blk || 0) * 7 + (s.reb || 0) * 0.6 + (s.min || 0) * 0.15, 4, 24);
  const rebounding = scale((s.reb || 0) / Math.max(1, (s.min || 24) / 36) + (big ? 1 : 0), 2, 14);
  const ageAdj = age ? clamp((28 - age) * 0.8, -8, 4) : 0;
  const athleticism = clamp(scale((s.stl || 0) * 6 + (s.blk || 0) * 5 + fta * 2 + (s.min || 0) * 0.3, 6, 30) + ageAdj, 30, 99);
  return { shooting: r0(shooting), threePt: r0(threePt), playmaking: r0(playmaking), finishing: r0(finishing), defense: r0(defense), rebounding: r0(rebounding), athleticism: r0(athleticism) };
}

/** Per-game production with a minutes trust factor (Game Score-like). */
export function production(s) {
  if (!s || !s.gp) return null;
  const prod = s.pts + 0.4 * (s.fgm || 0) - 0.7 * (s.fga || 0) - 0.4 * ((s.fta || 0) - (s.ftm || 0)) + 0.7 * s.reb + 0.7 * s.ast + s.stl + 0.7 * s.blk - (s.tov || 0);
  const trust = Math.min(1, Math.max(0.3, (s.min || 0) / 28)) * Math.min(1, Math.max(0.55, s.gp / 6));
  return prod * trust;
}
// Percentile of production → OVR, anchored to a 2K-like spread. Non-seeded players top out at 93,
// so the seeded superstar tier (94–97) stays with the official update.
const CURVE = [[0, 62], [0.25, 69], [0.5, 74], [0.75, 79], [0.9, 84], [0.97, 88], [0.995, 91], [1, 93]];
export function ovrFromPct(pc) {
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i], [x0, y0] = CURVE[i - 1];
    if (pc <= x1) return y0 + ((pc - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 93;
}
function percentiler(values) {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return (v) => {
    if (v == null || !sorted.length) return null;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
    return (lo - 0.5) / sorted.length;
  };
}
export function modelOvr(s, pct) { const p = production(s); return p == null ? null : r0(ovrFromPct(Math.max(0, pct(p)))); }

/**
 * @param {{ players: {players: any[]}, prevPlayers?: {players:any[]}, league?: {players:any[], teams:object} }} src
 * @returns {{ asOf, note, players: Rating[], teams: TeamRating[] }}
 */
const ATTR_ALIAS = { shooting: ["shooting", "outsideScoring"], threePt: ["threePt", "threePoint", "threePointShot"], playmaking: ["playmaking"], finishing: ["finishing", "insideScoring"],
  defense: ["defense", "defending"], rebounding: ["rebounding"], athleticism: ["athleticism"] };
/** Official attribute values from a feed row override the stat model's (only the 7 Hooptrax attributes, 25–99). */
function feedAttrs(base, a) {
  if (!a) return base;
  const out = { ...base };
  for (const [k, keys] of Object.entries(ATTR_ALIAS)) { const v = keys.map((x) => Number(a[x])).find((x) => Number.isFinite(x) && x >= 25 && x <= 99); if (v != null) out[k] = Math.round(v); }
  return out;
}
/**
 * Official NBA 2K27 ratings only. feed: the synced official dataset ({ source, asOf, syncedAt, official, players,
 * teams }) from service/ratings2k.js. Only players with an official OVR are returned; nothing is estimated from
 * box scores. Attributes, badges and team ratings appear only when the official feed supplies them.
 * (`pos` is a PG/SG/SF/PF/C label for filtering, read from ESPN's listed position and role; it is not a rating.)
 */
export function buildRatings({ players = null, league = null, feed = null } = {}, now = new Date()) {
  const official = feed?.players?.length ? feed : { source: "NBA 2K27 roster update (bundled)", asOf: null, official: true, players: SEEDS.map(([name, ovr, delta]) => ({ name, ovr, delta })) };
  const seedBy = new Map(official.players.map((p) => [nameKey(p.name), p]));
  const stats = new Map((players?.players || []).map((p) => [String(p.id), p]));
  const roster = league?.players?.length ? league.players : (players?.players || []);
  const out = [];
  const seen = new Set(), seenName = new Set();
  for (const r of roster) {
    const id = String(r.id || ""), nk = nameKey(r.name);
    if (!id || seen.has(id) || seenName.has(nk)) continue;
    const seed = seedBy.get(nk);
    if (!seed) continue;                                         // no official rating → not shown
    seen.add(id); seenName.add(nk);
    const st = stats.get(id)?.stats || r.stats || null;
    const position = r.position || stats.get(id)?.position || "";
    const age = r.age ?? stats.get(id)?.age ?? null;
    const attrs = seed.attributes ? feedAttrs(null, seed.attributes) : null;
    const role = attrs || attributes(st, { position, age }) || {};
    const g = String(position).toUpperCase();
    const pos = g.startsWith("C") ? "C" : g.startsWith("G") ? ((role.playmaking ?? 0) >= 72 ? "PG" : "SG") : g.startsWith("F") ? ((role.rebounding ?? 0) >= 72 || (role.finishing ?? 0) >= 85 && (role.threePt ?? 99) < 60 ? "PF" : "SF") : "SF";
    const ovr = clamp(seed.ovr, 40, 99);
    out.push({
      id, name: r.name, pos, teamAbbr: r.teamAbbr || stats.get(id)?.teamAbbr || "", position, age,
      headshot: r.headshot || null, headshotSmall: r.headshotSmall || r.headshot || null, initials: r.initials || "",
      ovr, delta: seed.delta || 0, tier: tierOf(ovr), official: true, seeded: true, estimated: false, attrs, badges: seed.badges ?? null, gp: st?.gp || 0,
    });
  }
  out.sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  const rosterSize = new Set(roster.map((r) => String(r.id))).size;
  const syncedAt = feed?.syncedAt || (official.asOf ? new Date(`${official.asOf}T12:00:00Z`).toISOString() : null);
  const note = `Official NBA 2K27 OVR for ${out.length}${rosterSize ? ` of ${rosterSize}` : ""} active players from ${official.source || "the official ratings feed"}. Players without an official rating aren't shown; Hooptrax never estimates 2K ratings.`;
  return { asOf: now.toISOString(), syncedAt, note, coverage: { official: out.length, roster: rosterSize, unmatched: official.players.length - out.length },
    source: { name: official.source || "", asOf: official.asOf || null, live: !!feed?.live, players: official.players.length },
    players: out, teams: teamRatings(official.teams || [], league?.teams || {}) };
}

/** Official 30-team ratings from the feed (by abbreviation or full name); [] when the feed has none. */
export function teamRatings(rows, teamsInfo = {}) {
  const ALIAS = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
  const find = (t) => { const u = String(t).toUpperCase(); const ab = ALIAS[u] || u; if (teamsInfo[ab]) return [ab, teamsInfo[ab]];
    const hit = Object.entries(teamsInfo).find(([, x]) => [x.displayName, x.name, x.location].some((n) => n && n.toLowerCase() === String(t).toLowerCase()));
    return hit || [ab, null]; };
  return rows.map((r) => { const [abbr, t] = find(r.team); return { abbr, name: t?.displayName || r.team, color: t?.color || "#64748B", logo: t?.logo || `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`,
      overall: r0(r.ovr), offense: r.offense != null ? r0(r.offense) : null, defense: r.defense != null ? r0(r.defense) : null, best: "" }; })
    .sort((a, b) => b.overall - a.overall);
}
