// ESPN public NBA endpoints (no API key). Isomorphic: uses global fetch (Node 18+ / browsers).
import {
  normalizeScoreboard, normalizeSummary, normalizeRoster, normalizeInjuries,
  normalizeStandings, normalizeTransactions, normalizeTeams,
  normalizeCollegeOverview, collegeBioFromRoster, collegeHeadshot,
} from "./normalize.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
const NCAA_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const NCAA_ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes";

export const ENDPOINTS = {
  scoreboard: ({ date } = {}) => `${SITE}/scoreboard${date ? `?dates=${encodeURIComponent(date)}` : ""}`,
  summary: ({ id }) => `${SITE}/summary?event=${encodeURIComponent(id)}`,
  roster: ({ team }) => `${SITE}/teams/${encodeURIComponent(team)}/roster`,
  injuries: () => `${SITE}/injuries`,
  standings: () => STANDINGS,
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
const CUSTOM = { college: loadCollege };

/** Fetch + normalize one resource. */
export async function load(resource, params = {}, opts = {}) {
  if (CUSTOM[resource]) return CUSTOM[resource](params, opts);
  const url = ENDPOINTS[resource](params);
  const raw = await fetchJson(url, opts);
  return NORMALIZERS[resource](raw);
}
