// Hooptrax 2K27-style ratings. Pure: used by the service (/api/2k-ratings) and the tests.
//
// Players named in SEEDS carry the OVR (and +/- delta) from the November 2026 NBA 2K27 roster update as
// supplied to Hooptrax. Every other active player is rated by the same model from live ESPN 2026–27 stats,
// so all ~500 players and all 30 teams stay current as the season goes. Attribute ratings for every player
// (seeded or not) come from the stat model; seeded OVRs are never overwritten.
// Not affiliated with 2K, the NBA or ESPN.

export const SEEDS = [
  ["Shai Gilgeous-Alexander", 97, 0], ["Victor Wembanyama", 97, 0], ["Luka Doncic", 97, 1], ["Nikola Jokic", 96, 0],
  ["Giannis Antetokounmpo", 96, 0], ["Jalen Brunson", 95, 0], ["Anthony Edwards", 95, 0], ["Stephen Curry", 95, 2],
  ["Cade Cunningham", 94, 0], ["Kevin Durant", 93, 0], ["Jayson Tatum", 93, 0], ["Tyrese Maxey", 93, 1],
  ["Jaylen Brown", 92, 1], ["Anthony Davis", 91, 1], ["Cooper Flagg", 90, 3], ["Alperen Sengun", 89, 2],
  ["Yaxel Lendeborg", 83, 10], ["Caleb Wilson", 82, 5],
];
export const SEED_NOTE = "Seeded from the Nov 2026 NBA 2K27 roster update for listed players; all others estimated by Hooptrax from live ESPN 2026–27 stats. Not official 2K ratings.";

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
export function buildRatings({ players = null, prevPlayers = null, league = null } = {}, now = new Date()) {
  const stats = new Map((players?.players || []).map((p) => [String(p.id), p]));
  const prev = new Map((prevPlayers?.players || []).map((p) => [String(p.id), p]));
  const roster = league?.players?.length ? league.players : (players?.players || []);
  const pctNow = percentiler([...stats.values()].map((p) => production(p.stats)));
  const pctPrev = percentiler([...prev.values()].map((p) => production(p.stats)));
  const out = [];
  const seen = new Set();
  for (const r of roster) {
    const id = String(r.id || ""); if (!id || seen.has(id)) continue; seen.add(id);
    const st = stats.get(id)?.stats || r.stats || null;
    const position = r.position || stats.get(id)?.position || "";
    const age = r.age ?? stats.get(id)?.age ?? null;
    const attrs = attributes(st, { position, age }) || { shooting: 55, threePt: 50, playmaking: 45, finishing: 55, defense: 50, rebounding: 50, athleticism: age && age < 23 ? 70 : 60 };
    const seed = SEED_BY.get(nameKey(r.name));
    const model = modelOvr(st, pctNow);
    let ovr = seed ? seed.ovr : model ?? (r.experience === 0 ? 66 : 64);
    let delta = seed ? seed.delta : 0;
    if (!seed && model != null) {
      const pm = modelOvr(prev.get(id)?.stats, pctPrev);
      if (pm != null) delta = clamp(Math.round((model - pm) / 3), -3, 3);
    }
    ovr = clamp(ovr, 55, 99);
    const badges = Object.values(attrs).filter((v) => v >= 80).length + (ovr >= 90 ? 3 : ovr >= 85 ? 2 : ovr >= 80 ? 1 : 0);
    // ESPN lists G / F / C only; split guards and forwards into 2K-style slots by role.
    const g = String(position).toUpperCase();
    const pos = g.startsWith("C") ? "C" : g.startsWith("G") ? (attrs.playmaking >= 72 ? "PG" : "SG") : g.startsWith("F") ? (attrs.rebounding >= 72 || attrs.finishing >= 85 && attrs.threePt < 60 ? "PF" : "SF") : "SF";
    out.push({
      id, name: r.name, pos, teamAbbr: r.teamAbbr || stats.get(id)?.teamAbbr || "", position, age,
      headshot: r.headshot || null, headshotSmall: r.headshotSmall || r.headshot || null, initials: r.initials || "",
      ovr, delta, tier: tierOf(ovr), seeded: !!seed, estimated: !seed, attrs, badges, gp: st?.gp || 0,
    });
  }
  out.sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return { asOf: now.toISOString(), note: SEED_NOTE, players: out, teams: teamRatings(out, league?.teams || {}) };
}

/** 30-team ratings from each roster's top 10 (weighted toward the top of the rotation). */
export function teamRatings(players, teamsInfo = {}) {
  const by = new Map();
  for (const p of players) { if (!p.teamAbbr) continue; (by.get(p.teamAbbr) || by.set(p.teamAbbr, []).get(p.teamAbbr)).push(p); }
  const W = [0.2, 0.16, 0.13, 0.11, 0.1, 0.08, 0.07, 0.06, 0.05, 0.04];
  const avg = (list, f) => list.reduce((s, p, i) => s + f(p) * W[i], 0) / W.slice(0, list.length).reduce((a, b) => a + b, 0);
  const rows = [...by.entries()].map(([abbr, list]) => {
    const top = list.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 10);
    const base = avg(top, (p) => p.ovr);
    const off = avg(top, (p) => (p.attrs.shooting + p.attrs.playmaking + p.attrs.finishing + p.ovr * 2) / 5);
    const def = avg(top, (p) => (p.attrs.defense * 2 + p.attrs.rebounding + p.attrs.athleticism + p.ovr * 2) / 6);
    const t = teamsInfo[abbr] || {};
    return { abbr, name: t.displayName || t.name || abbr, color: t.color || "#64748B", logo: t.logo || `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`,
      overall: r0(clamp(70 + (base - 74) * 2.1, 65, 99)), offense: r0(clamp(70 + (off - 72) * 2, 60, 99)), defense: r0(clamp(70 + (def - 72) * 2, 60, 99)), best: top[0]?.name || "" };
  });
  return rows.sort((a, b) => b.overall - a.overall || b.offense - a.offense);
}
