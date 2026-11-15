// Player Encyclopedia: season-by-season stats and game logs from ESPN, stat modes (per game, per 36, totals,
// advanced), player search across active rosters + all-time legends + ESPN, and the full profile payload.
// Pure functions (isomorphic): the server fetches, the UI reuses the stat-mode math.

const arr = (x) => (Array.isArray(x) ? x : []);
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const pair = (v) => { const x = String(v ?? "").split("-").map(Number); return x.length === 2 && x.every(Number.isFinite) ? x : [null, null]; };
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const CODE_OF = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };

/* ------------------------------------------------------------------ ESPN: seasons */
/** ESPN athlete /stats → every regular season (one row per team stint) + career per-game and totals. */
export function normalizeSeasons(json) {
  const cats = arr(json?.categories);
  const avg = cats.find((c) => c.name === "averages"), tot = cats.find((c) => c.name === "totals"), misc = cats.find((c) => c.name === "miscellaneous");
  if (!avg) return null;
  const teams = new Map(Object.values(json?.teams || {}).map((t) => [String(t.id), { abbr: t.abbreviation, code: CODE_OF[t.abbreviation] || t.abbreviation, name: t.displayName, logo: t.logos?.[0]?.href || null, color: t.color ? `#${t.color}` : null }]));
  const idx = (cat, k) => arr(cat?.names).indexOf(k);
  const per = (vals) => {
    const at = (k) => vals[idx(avg, k)];
    const [fgm, fga] = pair(at("avgFieldGoalsMade-avgFieldGoalsAttempted")), [tpm, tpa] = pair(at("avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted")), [ftm, fta] = pair(at("avgFreeThrowsMade-avgFreeThrowsAttempted"));
    return {
      gp: n(at("gamesPlayed")), gs: n(at("gamesStarted")), min: n(at("avgMinutes")), pts: n(at("avgPoints")), reb: n(at("avgRebounds")), oreb: n(at("avgOffensiveRebounds")), dreb: n(at("avgDefensiveRebounds")),
      ast: n(at("avgAssists")), stl: n(at("avgSteals")), blk: n(at("avgBlocks")), tov: n(at("avgTurnovers")), pf: n(at("avgFouls")),
      fgm, fga, fgPct: n(at("fieldGoalPct")), tpm, tpa, tpPct: n(at("threePointFieldGoalPct")), ftm, fta, ftPct: n(at("freeThrowPct")),
    };
  };
  const totalsOf = (vals) => {
    if (!vals) return null;
    const at = (k) => vals[idx(tot, k)];
    const [fgm, fga] = pair(at("fieldGoalsMade-fieldGoalsAttempted")), [tpm, tpa] = pair(at("threePointFieldGoalsMade-threePointFieldGoalsAttempted")), [ftm, fta] = pair(at("freeThrowsMade-freeThrowsAttempted"));
    return { pts: n(at("points")), reb: n(at("totalRebounds")), oreb: n(at("offensiveRebounds")), dreb: n(at("defensiveRebounds")), ast: n(at("assists")), stl: n(at("steals")), blk: n(at("blocks")), tov: n(at("turnovers")), pf: n(at("fouls")), fgm, fga, tpm, tpa, ftm, fta };
  };
  const seasons = arr(avg.statistics).map((r, i) => {
    const pg = per(arr(r.stats));
    const t = teams.get(String(r.teamId)) || null;
    const totRow = arr(tot?.statistics)[i];
    const totals = totalsOf(totRow && totRow.season?.year === r.season?.year && String(totRow.teamId) === String(r.teamId) ? arr(totRow.stats) : null);
    const miscRow = arr(misc?.statistics)[i];
    const astTo = miscRow ? n(arr(miscRow.stats)[idx(misc, "assistTurnoverRatio")]) : null;
    const y = n(r.season?.year);
    return { season: y ? `${y - 1}–${String(y).slice(-2)}` : r.season?.displayName || "", year: y, team: t, position: r.position || "", ...pg, totals: totals ? { ...totals, min: pg.min != null && pg.gp != null ? Math.round(pg.min * pg.gp) : null, gp: pg.gp } : null, astTo };
  });
  const career = per(arr(avg.totals));
  const careerTotals = totalsOf(tot ? arr(tot.totals) : null);
  return { seasons, career: { ...career, totals: careerTotals ? { ...careerTotals, gp: career.gp, min: career.min != null && career.gp != null ? Math.round(career.min * career.gp) : null } : null } };
}

/* ------------------------------------------------------------------ ESPN: game log */
/** ESPN athlete /gamelog → newest-first regular-season games (current season). ESPN's game log has no +/-. */
export function normalizeGameLog(json, { limit = 15 } = {}) {
  const labels = arr(json?.labels);
  const meta = json?.events || {};
  const reg = arr(json?.seasonTypes).find((s) => /regular season/i.test(s.displayName || "")) || null;
  if (!reg) return { season: null, games: [] };
  const games = arr(reg.categories).flatMap((c) => arr(c.events)).map((e) => {
    const m = meta[e.eventId] || {};
    const v = arr(e.stats), at = (l) => v[labels.indexOf(l)];
    return {
      id: String(e.eventId), date: m.gameDate || null, home: m.atVs !== "@", opp: m.opponent?.abbreviation || "", oppLogo: m.opponent?.logo || null,
      result: m.gameResult || "", score: m.score || "",
      min: n(at("MIN")), pts: n(at("PTS")), reb: n(at("REB")), ast: n(at("AST")), stl: n(at("STL")), blk: n(at("BLK")), tov: n(at("TO")), pf: n(at("PF")),
      fg: at("FG") || "", tp: at("3PT") || "", ft: at("FT") || "", fgPct: n(at("FG%")), tpPct: n(at("3P%")),
    };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { season: reg.displayName.replace(/\s*Regular Season/i, ""), games: games.slice(0, limit) };
}

/* ------------------------------------------------------------------ stat modes */
export const MODES = [["pg", "Per Game"], ["p36", "Per 36 Min"], ["tot", "Totals"], ["adv", "Advanced"]];
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
/** True shooting %, effective FG %, AST/TO and Hollinger Game Score (per game). */
export function advanced(s) {
  const fga = s.fga, fta = s.fta;
  const ts = s.pts != null && fga != null && fta != null && fga + 0.44 * fta > 0 ? s.pts / (2 * (fga + 0.44 * fta)) : null;
  const efg = s.fgm != null && fga ? (s.fgm + 0.5 * (s.tpm || 0)) / fga : null;
  const astTo = s.astTo ?? (s.ast != null && s.tov ? s.ast / s.tov : null);
  const gmsc = s.pts == null || s.fgm == null ? null
    : s.pts + 0.4 * s.fgm - 0.7 * (fga || 0) - 0.4 * ((fta || 0) - (s.ftm || 0)) + 0.7 * (s.oreb || 0) + 0.3 * (s.dreb || 0) + (s.stl || 0) + 0.7 * s.ast + 0.7 * (s.blk || 0) - 0.4 * (s.pf || 0) - (s.tov || 0);
  return { tsPct: ts == null ? null : r1(ts * 100), efgPct: efg == null ? null : r1(efg * 100), astTo: astTo == null ? null : Math.round(astTo * 100) / 100, gmsc: r1(gmsc) };
}
/** A row's numbers in a display mode. `s` is a per-game season row (or the career row). */
export function inMode(s, mode) {
  if (mode === "tot") {
    const t = s.totals || {};
    return { gp: s.gp, min: t.min, pts: t.pts, reb: t.reb, ast: t.ast, stl: t.stl, blk: t.blk, tov: t.tov, fg: t.fgm != null ? `${t.fgm}-${t.fga}` : "—", tp: t.tpm != null ? `${t.tpm}-${t.tpa}` : "—", ft: t.ftm != null ? `${t.ftm}-${t.fta}` : "—", fgPct: s.fgPct, tpPct: s.tpPct, ftPct: s.ftPct };
  }
  if (mode === "adv") return { gp: s.gp, min: s.min, ...advanced(s), fgPct: s.fgPct, tpPct: s.tpPct, ftPct: s.ftPct };
  const k = mode === "p36" && s.min ? 36 / s.min : 1;
  const f = (x) => (x == null ? null : r1(x * k));
  return { gp: s.gp, min: mode === "p36" ? (s.min ? 36 : null) : s.min, pts: f(s.pts), reb: f(s.reb), ast: f(s.ast), stl: f(s.stl), blk: f(s.blk), tov: f(s.tov),
    fg: s.fgm != null ? `${f(s.fgm)}-${f(s.fga)}` : "—", tp: s.tpm != null ? `${f(s.tpm)}-${f(s.tpa)}` : "—", ft: s.ftm != null ? `${f(s.ftm)}-${f(s.fta)}` : "—", fgPct: s.fgPct, tpPct: s.tpPct, ftPct: s.ftPct };
}
export { r3 };

/* ------------------------------------------------------------------ search */
/** Rank local candidates (active players + legends) for a query: exact > prefix of name > prefix of last name > contains. */
export function searchLocal(q, { active = [], legends = [] } = {}, limit = 12) {
  const k = norm(q); if (k.length < 2) return [];
  const seen = new Set(), out = [];
  const add = (p, score) => { if (seen.has(p.id)) return; seen.add(p.id); out.push({ ...p, score }); };
  const scoreOf = (name) => {
    const nm = norm(name); const last = nm.split(" ").slice(-1)[0];
    if (nm === k) return 100;
    if (nm.startsWith(k)) return 80;
    if (last.startsWith(k)) return 78;                       // "jordan" → Michael Jordan as well as Jordan Clarkson
    if (nm.split(" ").some((w) => w.startsWith(k))) return 60;
    if (nm.includes(k)) return 40;
    return 0;
  };
  // fame breaks ties: current scoring for active players, career points and MVPs for legends
  const ppg = (p) => p.ppg ?? p.stats?.pts ?? 0;
  const careerFame = (l) => (l ? Math.min(10, (l.totals?.pts || 0) / 3500) + (l.honors?.mvp ? 3 : 0) : 0);
  const legendById = new Map(legends.map((l) => [String(l.id), l]));
  for (const p of active) { const s = scoreOf(p.name); if (s) add({ id: String(p.id), name: p.name, active: true, team: p.teamAbbr || "", position: p.position || "", headshot: p.headshotSmall || p.headshot || null, years: "2026–27" }, s + Math.max(Math.min(8, ppg(p) / 4), careerFame(legendById.get(String(p.id))))); }
  for (const l of legends) { const s = scoreOf(l.name); if (s) add({ id: String(l.id), name: l.name, active: false, team: "", position: l.position || "", headshot: l.headshot || null, years: l.from ? `${l.from}–${l.to}` : "" }, s + careerFame(l)); }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
/** Merge local hits with ESPN's search (ids dedupe; ESPN-only hits rank after strong local matches). */
export function mergeSearch(local, remote, limit = 12) {
  const seen = new Set(local.map((p) => p.id));
  const extra = arr(remote).filter((r) => r.id && !seen.has(String(r.id))).map((r) => ({ id: String(r.id), name: r.name, active: null, team: r.team || "", position: "", headshot: r.headshot || null, years: "", score: 30 }));
  return [...local, ...extra].sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...p }) => p);
}

/* ------------------------------------------------------------------ trophy shelf */
const ESPN_AWARD = { "MVP": "mvp", "Finals MVP": "fmvp", "Defensive Player of the Year": "dpoy", "Rookie of the Year": "roy", "Sixth Man of the Year": "smoy", "Most Improved Player": "mip", "All-Star MVP": "asmvp",
  "All-NBA 1st Team": "allNba1", "All-NBA 2nd Team": "allNba2", "All-NBA 3rd Team": "allNba3", "All-Defensive 1st Team": "allDef1", "All-Defensive 2nd Team": "allDef2" };
const LABEL = { titles: "NBA Champion", fmvp: "Finals MVP", mvp: "MVP", dpoy: "Defensive Player of the Year", roy: "Rookie of the Year", smoy: "Sixth Man", mip: "Most Improved",
  allNba1: "All-NBA 1st Team", allNba2: "All-NBA 2nd Team", allNba3: "All-NBA 3rd Team", allDef1: "All-Defensive 1st", allDef2: "All-Defensive 2nd", asmvp: "All-Star Game MVP" };
const ORDER = ["titles", "fmvp", "mvp", "dpoy", "roy", "smoy", "mip", "allNba1", "allNba2", "allNba3", "allDef1", "allDef2", "asmvp"];
const teamFull = { ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets", CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers", DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers", LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves", NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns", POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards" };

/**
 * Trophies from nba_history.json (MVP/ROY/DPOY/6MOY/MIP by name, Finals MVP from champions) merged with ESPN's
 * honors (All-NBA, All-Defensive, All-Star MVP), plus championships: a season counts when the team the player
 * finished that season with won the title (franchise lineage via nba_history franchise titles).
 */
export function trophies({ name, history, honors = [], seasons = [] }) {
  const k = norm(name), map = {};
  const add = (key, year) => { (map[key] ||= new Set()).add(String(year)); };
  for (const [key, list] of Object.entries(history?.awards || {})) if (key !== "coy") for (const a of list) if (norm(a.name) === k) add(key, a.year);
  for (const c of history?.champions || []) if (c.fmvp && norm(c.fmvp) === k) add("fmvp", c.year);
  for (const h of honors) { const key = ESPN_AWARD[h.name]; if (key) for (const y of h.seasons || []) add(key, y); }
  // championships from the season-by-season teams
  const lastByYear = new Map(); for (const s of seasons) if (s.year && s.team?.code) lastByYear.set(s.year, s.team.code);
  for (const [year, code] of lastByYear) { const f = history?.franchises?.[code]; if (f?.titles?.some((t) => t.year === year)) add("titles", year); }
  return ORDER.filter((key) => map[key]?.size).map((key) => ({ key, label: LABEL[key], count: map[key].size, years: [...map[key]].map(Number).sort((a, b) => a - b) }));
}
export { teamFull };

/* ------------------------------------------------------------------ draft pedigree */
/** ESPN reuses today's codes for old picks ("CHA" for the 1996 Hornets): show the drafting franchise of that year. */
export function draftTeamAt(code, year) {
  if (!code || !year) return code || "";
  const y = +year;
  switch (code) {
    case "CHA": return y <= 2002 ? "CHH" : "CHA";
    case "NO": return y <= 2012 ? "NOH" : "NOP";
    case "WSH": return y < 1997 ? "WSB" : "WAS";
    case "SA": return "SAS"; case "GS": return "GSW"; case "NY": return "NYK"; case "UTAH": return "UTA"; case "NJ": return "NJN";
    default: return code;
  }
}
/**
 * Draft line for a profile: ESPN's bio first, then our legends' draft pedigree (territorial, ABA, BAA and undrafted
 * entries included), then the legends' ESPN-format string. "No record" is never shown as "Undrafted".
 */
export function draftOf(bio, leg) {
  if (bio?.draft?.year) return { ...bio.draft, type: "nba", team: draftTeamAt(bio.draft.team, bio.draft.year) };
  if (leg?.draftInfo) return { ...leg.draftInfo, overall: leg.draftInfo.pick };
  const m = /^(\d{4}): Rd (\d+), Pk (\d+)(?: \(([A-Z]+)\))?/.exec(leg?.draft || "");
  if (m) return { year: +m[1], round: +m[2], pick: +m[3], overall: +m[3], team: draftTeamAt(m[4] || "", +m[1]), type: "nba", text: leg.draft };
  const debut = leg?.from ?? bio?.debutYear ?? null;
  if (debut != null && debut < 1985) return null;
  return bio?.draft || null;
}
