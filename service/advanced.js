// Basketball Reference-style metrics, team efficiency and schedule strength. Pure (service + browser + tests).
//
//   advanced(s)              TS%, eFG%, AST/TO, Game Score, Per-36 line, from ESPN per-game averages
//   inMode(s, mode)          a stat line as "pergame" | "per36" | "per40" | "totals"
//   teamEfficiency(...)      ORtg / DRtg / NetRtg / Pace (+ league ranks) for all 30 teams
//   scheduleStrength(...)    remaining strength of schedule, last-10 record and streak

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** @param {{pts, fgm, fga, tpm, ftm, fta, reb, oreb?, dreb?, ast, stl, blk, tov, pf?, min}} s per-game averages */
export function advanced(s) {
  if (!s) return null;
  const fga = s.fga || 0, fta = s.fta || 0, tov = s.tov || 0;
  const tsa = fga + 0.44 * fta;
  // Hollinger Game Score. ESPN's league feed has no offensive/defensive rebound split, so total
  // rebounds carry the blended 0.4 weight (0.7 OREB + 0.3 DREB at a typical 25/75 split).
  const reb = s.oreb != null && s.dreb != null ? 0.7 * s.oreb + 0.3 * s.dreb : 0.4 * (s.reb || 0);
  const gmsc = (s.pts || 0) + 0.4 * (s.fgm || 0) - 0.7 * fga - 0.4 * (fta - (s.ftm || 0)) + reb + (s.stl || 0) + 0.7 * (s.ast || 0) + 0.7 * (s.blk || 0) - 0.4 * (s.pf || 0) - tov;
  return {
    ts: tsa > 0 ? r3((s.pts || 0) / (2 * tsa)) : null,
    efg: fga > 0 ? r3(((s.fgm || 0) + 0.5 * (s.tpm || 0)) / fga) : null,
    astTo: tov > 0 ? Math.round(((s.ast || 0) / tov) * 100) / 100 : s.ast ? null : null,
    gmsc: r1(gmsc),
    per36: inMode(s, "per36"),
  };
}

const COUNTING = ["pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "pf"];
/** Scale counting stats: per game (as is), per 36 / per 40 minutes, or season totals. Percentages are unchanged. */
export function inMode(s, mode = "pergame") {
  if (!s) return null;
  if (mode === "pergame") return { ...s };
  const out = { ...s };
  const k = mode === "totals" ? (s.gp || 0) : mode === "per36" || mode === "per40" ? (s.min > 0 ? (mode === "per36" ? 36 : 40) / s.min : 0) : 1;
  for (const key of COUNTING) if (s[key] != null) out[key] = r1(s[key] * k);
  if (mode === "totals" && s.min != null) out.min = Math.round(s.min * (s.gp || 0));
  return out;
}
export const MODES = [["pergame", "Per Game"], ["per36", "Per 36"], ["totals", "Totals"]];

/**
 * Team efficiency from season team averages.
 * Possessions per game ≈ FGA − OREB + TOV + 0.44 × FTA. ORtg = 100 × PPG / poss, DRtg = 100 × opp PPG / poss
 * (each team's own possession estimate stands in for the opponent's, as they're within ~1 per game),
 * Pace = possessions per 48 minutes.
 * @param {Record<string, {gp, pts, fga, oreb, tov, fta}>} stats keyed by team abbr
 * @param {Record<string, {oppPpg, ppg, gp}>} opp keyed by team abbr (from standings)
 */
export function teamEfficiency(stats, opp = {}) {
  const rows = [];
  for (const [abbr, s] of Object.entries(stats || {})) {
    if (!s || !s.fga) continue;
    const poss = s.fga - (s.oreb || 0) + (s.tov || 0) + 0.44 * (s.fta || 0);
    const ppg = s.pts ?? opp[abbr]?.ppg ?? null;
    const oppPpg = opp[abbr]?.oppPpg ?? null;
    const ortg = poss > 0 && ppg != null ? (100 * ppg) / poss : null;
    const drtg = poss > 0 && oppPpg != null ? (100 * oppPpg) / poss : null;
    rows.push({ abbr, poss: r1(poss), pace: r1(poss), ortg: r1(ortg), drtg: r1(drtg), net: ortg != null && drtg != null ? r1(ortg - drtg) : null });
  }
  const rank = (key, desc = true) => {
    const sorted = rows.filter((r) => r[key] != null).sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key]));
    sorted.forEach((r, i) => { r.ranks = { ...(r.ranks || {}), [key]: i + 1 }; });
  };
  rank("ortg"); rank("drtg", false); rank("net"); rank("pace");
  return Object.fromEntries(rows.map((r) => [r.abbr, r]));
}

/**
 * Remaining strength of schedule: average win % of each team's remaining opponents (current standings),
 * plus last-10 record and current streak from completed games.
 * @param {Record<string, {games: {opponent:{abbr}, state, result, date}[]}>} schedules keyed by team abbr
 * @param {Record<string, number>} winPct keyed by team abbr
 */
export function scheduleStrength(schedules, winPct) {
  const out = {};
  for (const [abbr, sch] of Object.entries(schedules || {})) {
    const games = (sch?.games || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const done = games.filter((g) => g.state === "post" && g.result);
    const left = games.filter((g) => g.state !== "post");
    const opp = left.map((g) => winPct[g.opponent.abbr]).filter((x) => x != null);
    const last10 = done.slice(-10);
    let streak = "";
    if (done.length) {
      const last = done.at(-1).result; let n = 0;
      for (let i = done.length - 1; i >= 0 && done[i].result === last; i--) n++;
      streak = `${last}${n}`;
    }
    out[abbr] = {
      remSos: opp.length ? r3(opp.reduce((a, b) => a + b, 0) / opp.length) : null,
      remaining: left.length,
      l10: `${last10.filter((g) => g.result === "W").length}-${last10.filter((g) => g.result === "L").length}`,
      streak,
    };
  }
  const ranked = Object.entries(out).filter(([, v]) => v.remSos != null).sort((a, b) => a[1].remSos - b[1].remSos);
  ranked.forEach(([abbr], i) => { out[abbr].sosRank = i + 1; });      // 1 = easiest remaining schedule
  return out;
}
