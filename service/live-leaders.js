// All-time career leaderboards that stay current: nba_history.json's careerLeaders is a snapshot, so every active
// player on a board gets his live career total from ESPN's career endpoint, and the board is re-sorted. Retired
// players' totals are final. Pure apart from the injected fetchCareer(id) → { gp, totals } | null.
const CATS = ["pts", "reb", "ast", "stl", "blk", "tpm"];

export async function liveCareerLeaders(careerLeaders, fetchCareer) {
  if (!careerLeaders) return careerLeaders;
  const ids = new Set();
  for (const c of CATS) for (const r of careerLeaders[c] || []) if (r.active && /^\d+$/.test(String(r.id))) ids.add(String(r.id));
  const careers = new Map();
  await Promise.all([...ids].map(async (id) => { try { const c = await fetchCareer(id); if (c?.totals) careers.set(id, c); } catch { /* keep the snapshot value */ } }));
  const out = {};
  for (const c of CATS) {
    const rows = (careerLeaders[c] || []).map((r) => {
      const live = careers.get(String(r.id));
      const t = live?.totals?.[c];
      if (!r.active || !Number.isFinite(t) || t < r.total) return r;       // never move a total backwards
      const gp = Number.isFinite(live.gp) && live.gp >= (r.gp || 0) ? live.gp : r.gp;
      return { ...r, total: t, gp, perGame: gp ? Math.round((t / gp) * 10) / 10 : r.perGame, live: true };
    });
    out[c] = rows.sort((a, b) => b.total - a.total);
  }
  for (const k of Object.keys(careerLeaders)) if (!(k in out)) out[k] = careerLeaders[k];
  return out;
}

/**
 * ESPN's career totals lag its game log by a game or two (a game that finished tonight is in the log before it's
 * in the season and career totals). Add the newest logged games the season line doesn't count yet.
 * career: { gp, totals }, seasonGp: games in the current season line, games: game log (newest first).
 */
export function withUnfoldedGames(career, seasonGp, games) {
  if (!career?.totals || !Array.isArray(games) || !Number.isFinite(seasonGp)) return career;
  const extra = games.length - seasonGp;
  if (extra <= 0 || extra > 5) return career;                          // nothing to add, or the inputs don't line up
  const add = games.slice(0, extra);
  const made = (x) => { const n = Number(String(x || "").split("-")[0]); return Number.isFinite(n) ? n : 0; };
  const sum = (f) => add.reduce((a, g) => a + (Number(f(g)) || 0), 0);
  const t = career.totals;
  const plus = (v, d) => (Number.isFinite(v) ? v + d : v);
  return { ...career, gp: plus(career.gp, extra), unfolded: extra, totals: { ...t, pts: plus(t.pts, sum((g) => g.pts)), reb: plus(t.reb, sum((g) => g.reb)),
    ast: plus(t.ast, sum((g) => g.ast)), stl: plus(t.stl, sum((g) => g.stl)), blk: plus(t.blk, sum((g) => g.blk)), tpm: plus(t.tpm, sum((g) => made(g.tp))) } };
}
