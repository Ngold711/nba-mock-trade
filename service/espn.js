// ESPN public NBA endpoints (no API key). Isomorphic: uses global fetch (Node 18+ / browsers).
import {
  normalizeScoreboard, normalizeSummary, normalizeRoster, normalizeInjuries,
  normalizeStandings, normalizeTransactions, normalizeTeams,
  normalizeCollegeOverview, collegeBioFromRoster, collegeHeadshot,
  normalizeNews, normalizePlayerStats, normalizeHonors,
} from "./normalize.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
const NBA_STATS = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete";
const NCAA_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const NCAA_ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes";

export const ENDPOINTS = {
  scoreboard: ({ date } = {}) => `${SITE}/scoreboard${date ? `?dates=${encodeURIComponent(date)}` : ""}`,
  summary: ({ id }) => `${SITE}/summary?event=${encodeURIComponent(id)}`,
  roster: ({ team }) => `${SITE}/teams/${encodeURIComponent(team)}/roster`,
  injuries: () => `${SITE}/injuries`,
  standings: ({ season } = {}) => `${STANDINGS}${season ? `?season=${encodeURIComponent(season)}` : ""}`,
  news: () => `${SITE}/news?limit=50`,
  honors: ({ id }) => `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${encodeURIComponent(id)}/overview`,
  players: ({ season } = {}) => `${NBA_STATS}?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=1000&sort=offensive.avgPoints%3Adesc${season ? `&season=${encodeURIComponent(season)}&seasontype=2` : ""}`,
  transactions: () => `${SITE}/transactions`,
  teams: () => `${SITE}/teams`,
  collegeOverview: ({ id }) => `${NCAA_ATHLETE}/${encodeURIComponent(id)}/overview`,
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
  const [overview, roster] = await Promise.all([
    fetchJson(ENDPOINTS.collegeOverview({ id }), opts),
    team ? fetchJson(ENDPOINTS.collegeRoster({ team }), opts).catch(() => null) : null,   // bio is optional
  ]);
  const hs = collegeHeadshot(id);
  return { id: String(id), headshot: hs.url, headshotSmall: hs.small, ...normalizeCollegeOverview(overview, { season }), bio: roster ? collegeBioFromRoster(roster, id) : null };
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
const CUSTOM = { college: loadCollege, starts: loadStarts, coaches: loadCoaches, league: loadLeague };

/** Fetch + normalize one resource. */
export async function load(resource, params = {}, opts = {}) {
  if (CUSTOM[resource]) return CUSTOM[resource](params, opts);
  const url = ENDPOINTS[resource](params);
  const raw = await fetchJson(url, opts);
  return NORMALIZERS[resource](raw);
}
