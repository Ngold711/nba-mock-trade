// ESPN public NBA endpoints (no API key). Isomorphic: uses global fetch (Node 18+ / browsers).
import {
  normalizeScoreboard, normalizeSummary, normalizeRoster, normalizeInjuries,
  normalizeStandings, normalizeTransactions, normalizeTeams,
  normalizeCollegeOverview, collegeBioFromRoster, collegeHeadshot,
  normalizeNews, normalizePlayerStats, normalizeHonors, normalizeSchedule, normalizeBio, collegeSplits, normalizeSearch, normalizeCareer,
} from "./normalize.js";
import { normalizeSeasons, normalizeGameLog } from "./player.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
const NBA_STATS = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete";
const NCAA_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const NCAA_ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes";

export const ENDPOINTS = {
  scoreboard: ({ date } = {}) => `${SITE}/scoreboard${date ? `?dates=${encodeURIComponent(date)}` : ""}`,
  summary: ({ id }) => `${SITE}/summary?event=${encodeURIComponent(id)}`,
  roster: ({ team }) => `${SITE}/teams/${encodeURIComponent(team)}/roster`,
  schedule: ({ team }) => `${SITE}/teams/${encodeURIComponent(team)}/schedule`,
  injuries: () => `${SITE}/injuries`,
  standings: ({ season } = {}) => `${STANDINGS}${season ? `?season=${encodeURIComponent(season)}` : ""}`,
  news: () => `${SITE}/news?limit=50`,
  honors: ({ id }) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(id)}/overview`,
  players: ({ season } = {}) => `${NBA_STATS}?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=1000&sort=offensive.avgPoints%3Adesc${season ? `&season=${encodeURIComponent(season)}&seasontype=2` : ""}`,
  transactions: () => `${SITE}/transactions?limit=60`,
  teams: () => `${SITE}/teams`,
  collegeOverview: ({ id }) => `${NCAA_ATHLETE}/${encodeURIComponent(id)}/overview`,
  collegeStats: ({ id }) => `${NCAA_ATHLETE}/${encodeURIComponent(id)}/stats`,
  bio: ({ id }) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(id)}`,
  teamStats: ({ team }) => `${SITE}/teams/${encodeURIComponent(team)}/statistics`,
  search: ({ q }) => `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&type=player&sport=basketball&league=nba&limit=25`,
  career: ({ id }) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(id)}/stats`,
  seasons: ({ id }) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(id)}/stats`,
  gamelog: ({ id }) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(id)}/gamelog`,
  collegeRoster: ({ team }) => `${NCAA_SITE}/teams/${encodeURIComponent(team)}/roster`,
};

export const NORMALIZERS = {
  scoreboard: normalizeScoreboard,
  summary: normalizeSummary,
  roster: normalizeRoster,
  injuries: normalizeInjuries,
  standings: normalizeStandings,
  transactions: normalizeTransactions,
  teams: normalizeTeams,
  news: normalizeNews,
  honors: normalizeHonors,
  players: normalizePlayerStats,
  schedule: normalizeSchedule,
  bio: normalizeBio,
  search: normalizeSearch,
  career: normalizeCareer,
  seasons: normalizeSeasons,
  gamelog: (j) => normalizeGameLog(j),
};

export class FetchError extends Error {
  constructor(message, { status = 0, url = "", retryable = true } = {}) {
    super(message); this.name = "FetchError"; this.status = status; this.url = url; this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with a timeout and one retry on network errors / 5xx / 429. */
export async function fetchJson(url, { timeoutMs = 10000, retries = 1, fetchImpl = globalThis.fetch } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        throw new FetchError(`ESPN responded ${res.status}`, { status: res.status, url, retryable });
      }
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new FetchError("ESPN returned invalid JSON", { url, retryable: true }); }
    } catch (err) {
      lastErr = err instanceof FetchError ? err : new FetchError(err && err.name === "TimeoutError" ? "ESPN request timed out" : `Network error: ${err && err.message}`, { url });
      if (!lastErr.retryable || attempt === retries) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** College prospect: live season averages + game log (+ roster bio when a team id is given). */
async function loadCollege({ id, team, season = "2026-27" }, opts) {
  const [overview, roster, stats] = await Promise.all([
    fetchJson(ENDPOINTS.collegeOverview({ id }), opts),
    team ? fetchJson(ENDPOINTS.collegeRoster({ team }), opts).catch(() => null) : null,   // bio is optional
    fetchJson(ENDPOINTS.collegeStats({ id }), opts).catch(() => null),                     // shooting splits are optional
  ]);
  const hs = collegeHeadshot(id);
  const out = { id: String(id), headshot: hs.url, headshotSmall: hs.small, ...normalizeCollegeOverview(overview, { season }), bio: roster ? collegeBioFromRoster(roster, id) : null };
  const sp = stats ? collegeSplits(stats, season) : null;
  if (out.averages && sp && (!sp.season || sp.season === out.averages.season)) Object.assign(out.averages, sp, { season: out.averages.season });
  return out;
}
/** Run fn over items with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(() => null); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
const ymdUTC = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

/* Games started per player, aggregated from regular-season box scores (ESPN's season stats omit GS).
   Finished games never change, so their starter lists and fully-final dates are cached for the
   life of the process; each refresh only fetches what's new. */
const startsCache = { games: new Map(), doneDates: new Set() };
async function loadStarts(_params, opts) {
  const today = ymdUTC(new Date());
  const sb = await fetchJson(ENDPOINTS.scoreboard({}), opts);
  const dates = arr(sb?.leagues?.[0]?.calendar).map((d) => String(d).slice(0, 10).replace(/-/g, ""))
    .filter((d) => d <= today && !startsCache.doneDates.has(d));
  const boards = await mapLimit(dates, 4, (d) => fetchJson(ENDPOINTS.scoreboard({ date: d }), opts));
  const toFetch = [];
  boards.forEach((b, i) => {
    if (!b) return;
    const events = arr(b.events).filter((e) => e?.season?.slug === "regular-season" || e?.season?.type === 2);
    const finals = events.filter((e) => e?.status?.type?.completed);
    finals.forEach((e) => { if (!startsCache.games.has(e.id)) toFetch.push(e.id); });
    if (finals.length === events.length && dates[i] < today) startsCache.doneDates.add(dates[i]);
  });
  await mapLimit(toFetch, 4, async (id) => {
    const s = await fetchJson(ENDPOINTS.summary({ id }), opts);
    const rows = [];
    for (const side of arr(s?.boxscore?.players)) {
      for (const a of arr(side?.statistics?.[0]?.athletes)) {
        if (a?.athlete?.id && !a.didNotPlay && arr(a.stats).length) rows.push([String(a.athlete.id), Boolean(a.starter)]);
      }
    }
    if (rows.length) startsCache.games.set(id, rows);
  });
  const players = {};
  for (const rows of startsCache.games.values()) {
    for (const [pid, started] of rows) { const p = (players[pid] ||= { gp: 0, gs: 0 }); p.gp++; if (started) p.gs++; }
  }
  return { asOf: new Date().toISOString(), games: startsCache.games.size, players };
}

/* Head coach per team, from the 30 team rosters. */
async function loadCoaches(_params, opts) {
  const teams = normalizeTeams(await fetchJson(ENDPOINTS.teams(), opts));
  const rosters = await mapLimit(teams, 5, (t) => fetchJson(ENDPOINTS.roster({ team: t.id }), opts));
  const out = {};
  teams.forEach((t, i) => { const r = rosters[i] ? normalizeRoster(rosters[i]) : null; out[t.id] = { team: t, coach: r?.coach || "" }; });
  return out;
}
const arr = (v) => (Array.isArray(v) ? v : []);
/* Every active player on all 30 rosters, with team, conference and division (for McConnell + Team Hub). */
export const DIVISIONS = {
  Atlantic: ["BOS", "BKN", "NY", "PHI", "TOR"], Central: ["CHI", "CLE", "DET", "IND", "MIL"], Southeast: ["ATL", "CHA", "MIA", "ORL", "WSH"],
  Northwest: ["DEN", "MIN", "OKC", "POR", "UTAH"], Pacific: ["GS", "LAC", "LAL", "PHX", "SAC"], Southwest: ["DAL", "HOU", "MEM", "NO", "SA"],
};
const DIV_OF = Object.fromEntries(Object.entries(DIVISIONS).flatMap(([d, ts]) => ts.map((t) => [t, d])));
const EAST_DIVS = new Set(["Atlantic", "Central", "Southeast"]);
async function loadLeague(_params, opts) {
  const teams = normalizeTeams(await fetchJson(ENDPOINTS.teams(), opts));
  // All 30 rosters at once; one slow or failed team never holds up (or sinks) the rest.
  const settled = await Promise.allSettled(teams.map((t) => fetchJson(ENDPOINTS.roster({ team: t.id }), opts)));
  if (!settled.some((r) => r.status === "fulfilled")) throw new Error("No team rosters could be loaded");
  const players = [];
  const teamInfo = {};
  const rosters = {};
  const failed = [];
  teams.forEach((t, i) => {
    const div = DIV_OF[t.abbr] || "";
    const conf = div ? (EAST_DIVS.has(div) ? "East" : "West") : "";
    const r = settled[i].status === "fulfilled" ? normalizeRoster(settled[i].value) : null;
    if (r) rosters[t.id] = r; else failed.push(t.abbr);
    teamInfo[t.abbr] = { ...t, division: div, conference: conf, coach: r?.coach || "", record: r?.team?.record || "", standing: r?.team?.standing || "" };
    for (const a of r?.athletes || []) players.push({ ...a, teamAbbr: t.abbr, teamId: t.id, division: div, conference: conf });
  });
  const out = { asOf: new Date().toISOString(), teams: teamInfo, players, failed };
  // Per-team rosters ride along (non-enumerable, so /api/league stays small); the server primes
  // its roster cache from them, so /api/rosters/:team answers without another ESPN call.
  Object.defineProperty(out, "rosters", { value: rosters, enumerable: false });
  return out;
}
/* 2K27-style ratings (service/ratings.js). Inside the service the inputs come from its warm cache
   (setResolver); in the browser fallback they're loaded directly. */
let resolver = null;
export function setResolver(fn) { resolver = fn; }
let ratingsFeed = null;               // () => Promise<parsed feed | null>; the server installs it (live URL / bundled snapshot)
export function setRatingsFeedProvider(fn) { ratingsFeed = fn; }
const dep = (r, p = {}) => (resolver ? resolver(r, p) : load(r, p));
async function loadRatings() {
  const { buildRatings } = await import("./ratings.js");
  const [players, league, prevPlayers, feed] = await Promise.all([dep("players"), dep("league").catch(() => null), dep("players", { season: "2026" }).catch(() => null),
    ratingsFeed ? ratingsFeed().catch(() => null) : null]);
  return buildRatings({ players, league, prevPlayers, feed });
}
/* Transactions: ESPN + NBA.com player movement (server only; NBA.com doesn't allow browser CORS). */
let txStatus = { syncedAt: null, sources: {} };
export const transactionsStatus = () => txStatus;
async function loadTransactions(_p, opts) {
  const { mergeTransactions, normalizeNbaMovement, newest, NBA_MOVEMENT_URL, REALGM_RSS_URL, parseRss, realgmTransactions } = await import("./transactions.js");
  const server = typeof window === "undefined";
  const env = (k) => (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const nbaOn = server && env("TRANSACTIONS_NBA") !== "0";
  const rgmOn = server && env("TRANSACTIONS_REALGM") !== "0";
  const [espnR, nbaR, teamsR, rgmR] = await Promise.allSettled([
    fetchJson(ENDPOINTS.transactions(), opts).then(normalizeTransactions),
    nbaOn ? fetch(NBA_MOVEMENT_URL, { headers: { accept: "application/json", referer: "https://www.nba.com/" }, signal: AbortSignal.timeout(9000) })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }) : Promise.reject(new Error("off")),
    dep("teams").catch(() => []),
    rgmOn ? fetch(env("TRANSACTIONS_REALGM_URL") || REALGM_RSS_URL, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "Hooptrax/1.0 (transactions sync)" }, signal: AbortSignal.timeout(9000) })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }) : Promise.reject(new Error("off")),
  ]);
  const byAbbr = Object.fromEntries((teamsR.value || []).map((t) => [t.abbr, t]));
  const espn = espnR.status === "fulfilled" ? espnR.value : [];
  const nba = nbaR.status === "fulfilled" ? normalizeNbaMovement(nbaR.value, byAbbr) : [];
  const rgm = rgmR.status === "fulfilled" ? realgmTransactions(parseRss(rgmR.value), byAbbr) : [];
  if (espnR.status !== "fulfilled" && !nba.length && !rgm.length) throw espnR.reason;
  const list = mergeTransactions(espn, nba, rgm);
  const official = list.filter((t) => t.category !== "rumor");
  txStatus = { syncedAt: new Date().toISOString(), newest: newest(official), newestRumor: newest(list.filter((t) => t.category === "rumor")),
    counts: { moves: official.length, rumors: list.length - official.length }, sources: {
    espn: espnR.status === "fulfilled" ? { ok: true, newest: newest(espn), count: espn.length } : { ok: false, error: String(espnR.reason?.message || espnR.reason) },
    nba: nbaOn ? (nbaR.status === "fulfilled" ? { ok: true, newest: newest(nba), count: nba.length } : { ok: false, error: String(nbaR.reason?.message || nbaR.reason) }) : { ok: false, error: "disabled" },
    realgm: rgmOn ? (rgmR.status === "fulfilled" ? { ok: true, newest: newest(rgm), newestMove: newest(rgm.filter((t) => t.category === "move")), count: rgm.length } : { ok: false, error: String(rgmR.reason?.message || rgmR.reason) }) : { ok: false, error: "disabled" },
  } };
  return list;
}

/* Team efficiency: season averages for all 30 teams (in parallel) + opponent scoring from standings. */
async function loadTeamStats(_p, opts) {
  const { teamEfficiency } = await import("./advanced.js");
  const teams = normalizeTeams(await fetchJson(ENDPOINTS.teams(), opts));
  const settled = await Promise.allSettled(teams.map((t) => fetchJson(ENDPOINTS.teamStats({ team: t.id }), opts)));
  const stats = {};
  teams.forEach((t, i) => {
    if (settled[i].status !== "fulfilled") return;
    const v = {};
    for (const c of arr(settled[i].value?.results?.stats?.categories)) for (const x of arr(c.stats)) v[x.name] = Number(x.value ?? x.displayValue);
    stats[t.abbr] = { gp: v.gamesPlayed, pts: v.avgPoints, fga: v.avgFieldGoalsAttempted, fgm: v.avgFieldGoalsMade, fta: v.avgFreeThrowsAttempted, ftm: v.avgFreeThrowsMade,
      tpm: v.avgThreePointFieldGoalsMade, tpa: v.avgThreePointFieldGoalsAttempted, oreb: v.avgOffensiveRebounds, dreb: v.avgDefensiveRebounds, reb: v.avgRebounds,
      ast: v.avgAssists, tov: v.avgTurnovers, stl: v.avgSteals, blk: v.avgBlocks, fgPct: v.fieldGoalPct, threePct: v.threePointPct ?? v.threePointFieldGoalPct, ftPct: v.freeThrowPct };
  });
  if (!Object.keys(stats).length) throw new Error("No team stats could be loaded");
  const st = await dep("standings").catch(() => null);
  const opp = {};
  for (const conf of st?.conferences || []) for (const t of conf.teams) opp[t.team.abbr] = { ppg: t.ppg, oppPpg: t.oppPpg };
  return { asOf: new Date().toISOString(), stats, efficiency: teamEfficiency(stats, opp) };
}
/* Remaining strength of schedule, L10 and streak from all 30 schedules + standings. */
async function loadSos(_p, opts) {
  const { scheduleStrength } = await import("./advanced.js");
  const teams = normalizeTeams(await fetchJson(ENDPOINTS.teams(), opts));
  const [settled, st] = await Promise.all([
    Promise.allSettled(teams.map((t) => fetchJson(ENDPOINTS.schedule({ team: t.id }), opts))),
    dep("standings"),
  ]);
  const schedules = {};
  teams.forEach((t, i) => { if (settled[i].status === "fulfilled") schedules[t.abbr] = normalizeSchedule(settled[i].value); });
  if (!Object.keys(schedules).length) throw new Error("No schedules could be loaded");
  const winPct = {};
  for (const conf of st?.conferences || []) for (const t of conf.teams) winPct[t.team.abbr] = t.pct;
  return { asOf: new Date().toISOString(), teams: scheduleStrength(schedules, winPct) };
}
const CUSTOM = { transactions: loadTransactions, teamstats: loadTeamStats, sos: loadSos, college: loadCollege, starts: loadStarts, coaches: loadCoaches, league: loadLeague, ratings: loadRatings };

/** Fetch + normalize one resource. */
export async function load(resource, params = {}, opts = {}) {
  if (CUSTOM[resource]) return CUSTOM[resource](params, opts);
  const url = ENDPOINTS[resource](params);
  const raw = await fetchJson(url, opts);
  return NORMALIZERS[resource](raw);
}
