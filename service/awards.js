// All-Star predictor + season awards model. Pure: feed it normalized ESPN data, get ladders back.
//
//   computeAwards({ players, prevPlayers, standings, prevStandings, starts, coaches, injuries })
//
// Everything is a transparent heuristic over box-score averages, not an official or proprietary
// metric. Constants live at the top so the model is easy to tune.

export const RULE_GAMES = 65;                 // CBA games requirement for major awards
export const SEASON_GAMES = 82;
export const RULE_AWARDS = ["mvp", "dpoy", "mip", "smoy", "allNba"];   // 65-game rule applies (ROY exempt here)
export const MAX_MISSED = SEASON_GAMES - RULE_GAMES;   // 17: missing an 18th game makes 65 impossible

/** Per-game production: a Game Score–style blend (Hollinger) without the offensive-rebound split. */
export function production(s) {
  return s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.5 * s.reb + 0.7 * s.ast + s.stl + 0.7 * s.blk - s.tov;
}
/** True shooting % (0–1). */
export const tsPct = (s) => { const d = 2 * ((s.fga || 0) + 0.44 * (s.fta || 0)); return d > 0 ? (s.pts || 0) / d : 0; };
/**
 * AwardScore: live per-game production (Game Score blend of PTS, REB, AST, STL, BLK, TOV and shooting), an
 * efficiency adjustment (TS% vs. league average), team win % and conference seed. Missed games are NOT docked:
 * availability only matters through the 65-game rule below.
 */
export function awardScore(s, team = {}, leagueTs = 0.575) {
  const prod = production(s);
  const eff = Math.max(-3, Math.min(3, (tsPct(s) - leagueTs) * 25)) * Math.min(1, (s.fga || 0) / 15);   // only volume scorers move much
  const win = 0.75 + 0.5 * (Number.isFinite(team.winPct) ? team.winPct : 0.5);
  const seed = team.seed ? Math.max(0, 7 - team.seed) * 0.3 : 0;                                            // seeds 1–6: +1.8 … +0.3
  return (prod + eff) * win + seed;
}
export function projectedGames(gp, teamGP) {
  if (!teamGP) return 0;
  return Math.min(SEASON_GAMES, Math.round((gp / teamGP) * SEASON_GAMES));
}
/** Team games until an injured player's return date (≈3.4 games a week), for the long-term-absence check. */
export function gamesUntil(returnDate, now = Date.now()) {
  const t = Date.parse(returnDate || ""); if (!Number.isFinite(t) || t <= now) return 0;
  return Math.round(((t - now) / 864e5) * (3.4 / 7));
}
/**
 * 65-game rule status. Ineligible only when 65 is out of reach: 18+ games already missed, or a confirmed long-term
 * absence (season-ending, or a listed return date that pushes the misses past 17). A borderline pace before that is
 * an informational flag only — it never moves a player down a ladder.
 */
export function ruleStatus(gp, teamGP, injury = null, now = Date.now()) {
  const missed = Math.max(0, (teamGP || 0) - (gp || 0));
  const projected = projectedGames(gp, teamGP);
  if (missed > MAX_MISSED) return { out: true, missed, projected, reason: `Missed ${missed} games: 65 is out of reach` };
  const comment = `${injury?.comment || ""} ${injury?.injury || ""}`;
  if (injury && /out/i.test(injury.status || "") && /(rest of the|remainder of the|for the) season|season-ending|out indefinitely/i.test(comment))
    return { out: true, missed, projected, reason: "Ruled out long-term" };
  const ahead = injury && /out/i.test(injury.status || "") ? gamesUntil(injury.returnDate, now) : 0;
  if (missed + ahead > MAX_MISSED) return { out: true, missed, projected, reason: `Out until ${injury.returnDate}: ${missed + ahead}+ missed games` };
  return { out: false, missed, projected, pace: projected < RULE_GAMES && teamGP >= 5 };
}

const isGuard = (p) => p.position === "G";
const round1 = (x) => Math.round(x * 10) / 10;

function teamTable(standings) {
  const byAbbr = {};
  for (const conf of standings?.conferences || []) {
    const confKey = /east/i.test(conf.name || conf.abbr) ? "East" : "West";
    for (const t of conf.teams) {
      byAbbr[t.team.abbr] = {
        ...t.team, conference: confKey, wins: t.wins, losses: t.losses,
        gp: t.wins + t.losses, winPct: t.wins + t.losses ? t.wins / (t.wins + t.losses) : 0.5, oppPpg: t.oppPpg, seed: t.seed,
      };
    }
  }
  return byAbbr;
}

/** Enrich every player with team context, AwardScore and 65-game projection. */
export function enrichPlayers({ players, prevPlayers, standings, starts, injuries = null, now = Date.now() }) {
  const teams = teamTable(standings);
  const injById = new Map((Array.isArray(injuries) ? injuries : injuries?.injuries || []).map((i) => [String(i.athlete?.id || ""), i]));
  // league-average TS% from this season's rotation players (fallback 57.5%)
  const rot = (players?.players || []).filter((p) => p.stats?.gp >= 3 && p.stats?.min >= 15);
  const lgPts = rot.reduce((a, p) => a + p.stats.pts * p.stats.gp, 0), lgDen = rot.reduce((a, p) => a + 2 * (p.stats.fga + 0.44 * p.stats.fta) * p.stats.gp, 0);
  const leagueTs = lgDen > 0 ? lgPts / lgDen : 0.575;
  const prevById = Object.fromEntries((prevPlayers?.players || []).map((p) => [p.id, p]));
  const startsById = starts?.players || {};
  const out = [];
  for (const p of players?.players || []) {
    const team = teams[p.teamAbbr];
    if (!team || !p.stats.gp) continue;
    const s = p.stats;
    const rule = ruleStatus(s.gp, team.gp, injById.get(String(p.id)), now);
    const prev = prevById[p.id] || null;
    const st = startsById[p.id];
    const gs = st ? st.gs : null;
    const startRate = st && st.gp ? st.gs / st.gp : null;
    out.push({
      ...p, team, conference: team.conference,
      prod: round1(production(s)),
      score: round1(awardScore(s, team, leagueTs)),
      ts: Math.round(tsPct(s) * 1000) / 10,
      projectedGames: rule.projected, missed: rule.missed,
      ruleRisk: rule.out,                     // ineligible: off the award ladders (65 games no longer possible)
      ruleReason: rule.reason || "",
      paceRisk: !!rule.pace,                  // informational only
      injury: injById.get(String(p.id))?.status || "",
      gs, startRate,
      prev: prev ? { gp: prev.stats.gp, pts: prev.stats.pts, reb: prev.stats.reb, ast: prev.stats.ast, prod: round1(production(prev.stats)) } : null,
      // ESPN's season feed leaves debutYear blank for most players, so rookies are inferred:
      // no 2025–26 NBA stats and 24 or younger.
      rookie: !prev && (p.age == null || p.age <= 24) && (p.debutYear == null || p.debutYear >= (players.season || 2027) - 1),
    });
  }
  return { players: out, teams, leagueTs };
}

/** Ladder: top N that pass `eligible`, then M honorable mentions (any status, badged). */
function ladder(cands, scoreOf, { top = 5, mentions = 3, rule = false, note } = {}) {
  const sorted = cands.map((p) => ({ player: p, value: round1(scoreOf(p)) })).sort((a, b) => b.value - a.value);
  const ok = (e) => !rule || !e.player.ruleRisk;
  const leaders = sorted.filter(ok).slice(0, top);
  const taken = new Set(leaders.map((e) => e.player.id));
  const hm = sorted.filter((e) => !taken.has(e.player.id)).slice(0, mentions);
  return { leaders, mentions: hm, pool: sorted.slice(0, 30), ruleApplies: rule, note: note || "" };
}

export function computeAllStar(players) {
  const out = {};
  for (const conf of ["East", "West"]) {
    const pool = players.filter((p) => p.conference === conf && p.stats.min >= 15).sort((a, b) => b.score - a.score);
    const used = new Set();
    const take = (pred, n) => { const r = pool.filter((p) => !used.has(p.id) && pred(p)).slice(0, n); r.forEach((p) => used.add(p.id)); return r; };
    const starters = [...take(isGuard, 2), ...take((p) => !isGuard(p), 3)];
    const reserves = [...take(isGuard, 2), ...take((p) => !isGuard(p), 3), ...take(() => true, 2)];   // 2 wildcards
    const mentions = take(() => true, 6);                                                              // ranks 13–18
    out[conf] = { starters, reserves, mentions };
  }
  return out;
}

export function computeAwards({ players, prevPlayers, standings, prevStandings, starts, coaches, injuries = null, now = Date.now() }) {
  const { players: all, teams, leagueTs } = enrichPlayers({ players, prevPlayers, standings, starts, injuries, now });
  const regulars = all.filter((p) => p.stats.min >= 15 && p.stats.gp >= Math.max(1, Math.ceil((p.team.gp || 1) * 0.4)));
  const leagueOpp = Object.values(teams).reduce((s, t) => s + (t.oppPpg || 0), 0) / Math.max(1, Object.keys(teams).length);

  const mvp = ladder(regulars, (p) => p.score, { rule: true });
  const roy = ladder(all.filter((p) => p.rookie && p.stats.min >= 10 && p.stats.gp >= Math.max(1, Math.ceil((p.team.gp || 1) * 0.3))),
    (p) => p.prod + Math.max(-2, Math.min(2, (tsPct(p.stats) - leagueTs) * 20)),
    { note: "Rookies inferred: no 2025–26 NBA stats, age 24 or under." });
  const dpoy = ladder(regulars, (p) => (2.2 * p.stats.stl + 2.4 * p.stats.blk + 0.35 * p.stats.reb + 0.25 * (leagueOpp - (p.team.oppPpg || leagueOpp)))
    * Math.min(1, p.stats.min / 32), { rule: true, note: "Steals, blocks, rebounding and team points allowed." });
  const smoy = ladder(regulars.filter((p) => p.startRate != null && p.startRate < 0.5), (p) => p.score,
    { rule: true, note: "Players who started under half their games (from box scores)." });
  const mip = ladder(regulars.filter((p) => p.prev && p.prev.gp >= 20), (p) => p.prod - p.prev.prod,
    { rule: true, note: "Change in production vs. 2025–26 (min. 20 games last season)." });

  const prevTeams = teamTable(prevStandings);
  const coy = Object.values(teams).map((t) => {
    const prev = prevTeams[t.abbr];
    const baseline = prev ? prev.winPct : 0.5;
    const w = Math.min(1, (t.gp || 0) / 20);         // early season: shrink the change toward 0 until ~20 games
    return { team: t, coach: coaches?.[t.id]?.coach || "", winPct: t.winPct, baseline, delta: (t.winPct - baseline) * w, rawDelta: t.winPct - baseline };
  }).sort((a, b) => b.delta - a.delta);

  const allNbaPool = regulars.filter((p) => !p.ruleRisk).sort((a, b) => b.score - a.score).slice(0, 15);
  const allNba = { first: allNbaPool.slice(0, 5), second: allNbaPool.slice(5, 10), third: allNbaPool.slice(10, 15) };

  return {
    asOf: new Date(now).toISOString(), leagueTs: Math.round(leagueTs * 1000) / 10,
    teamGamesMax: Math.max(0, ...Object.values(teams).map((t) => t.gp)),
    players: all,
    allStar: computeAllStar(all),
    awards: {
      mvp, roy, dpoy, smoy, mip,
      coy: { leaders: coy.slice(0, 5), mentions: coy.slice(5, 8), pool: coy, note: "Win % vs. 2025–26 win % (shrunk toward 0 until 20 games)." },
      allNba: { ...allNba, pool: regulars.filter((p) => !p.ruleRisk).sort((a, b) => b.score - a.score).slice(0, 40) },
    },
  };
}
