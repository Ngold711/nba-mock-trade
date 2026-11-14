// Cache + polling scheduler. Isomorphic (Node service and browser fallback).
//
// - Every resource has a freshness policy. Live scores refresh every ~20s while games are
//   in progress; slow data (rosters, standings, injuries, transactions) is cached 15–60 min.
// - Concurrent requests for the same resource share one in-flight fetch.
// - On failure we keep serving the last good data (marked stale) and back off exponentially,
//   so an ESPN outage never blanks the UI or turns into a request storm.
import { load as defaultLoad } from "./espn.js";

const SEC = 1000, MIN = 60 * SEC;

export const TTL = {
  live: 20 * SEC,          // games in progress (spec: 15–30s)
  pregame: 30 * SEC,       // a game tips within 15 min, or should have started
  summaryPre: 2 * MIN,
  final: 60 * MIN,
  idle: 15 * MIN,          // nothing live, nothing soon
  injuries: 15 * MIN,
  standings: 30 * MIN,
  transactions: 30 * MIN,
  roster: 60 * MIN,
  teams: 24 * 60 * MIN,
  historical: 10 * MIN,
  college: 30 * MIN,       // NCAA prospect stats
  news: 1 * MIN,
  players: 30 * MIN,
  playersPrev: 24 * 60 * MIN,
  starts: 6 * 60 * MIN,
  coaches: 12 * 60 * MIN,
  honors: 24 * 60 * MIN,
  league: 30 * MIN,        // all 30 rosters, warmed at startup
};
const MAX_BACKOFF = 5 * MIN;

function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** How long a scoreboard snapshot stays fresh, based on what is happening right now. */
export function scoreboardTtl(data, now, params = {}) {
  const games = (data && data.games) || [];
  if (params.date && params.date !== ymd(now) && !games.some((g) => g.status.state === "in")) {
    return games.length && games.every((g) => g.status.state === "post") ? TTL.final : TTL.historical;
  }
  if (games.some((g) => g.status.state === "in")) return TTL.live;
  const starts = games.filter((g) => g.status.state === "pre").map((g) => Date.parse(g.date)).filter(Number.isFinite);
  if (!starts.length) return TTL.idle;
  const until = Math.min(...starts) - now;
  if (until <= 15 * MIN) return TTL.pregame;                       // includes "past tip time but still pre"
  return Math.min(Math.max(until - 10 * MIN, MIN), TTL.idle);     // wake up ~10 min before tip
}

export function summaryTtl(data) {
  const state = data && data.game && data.game.status.state;
  if (state === "in") return TTL.live;
  if (state === "post") return TTL.final;
  return TTL.summaryPre;
}

export const POLICIES = {
  scoreboard: scoreboardTtl,
  summary: summaryTtl,
  roster: () => TTL.roster,
  injuries: () => TTL.injuries,
  standings: (d, t, p = {}) => (p.season ? TTL.playersPrev : TTL.standings),
  transactions: () => TTL.transactions,
  teams: () => TTL.teams,
  college: () => TTL.college,
  news: () => TTL.news,
  players: (d, t, p = {}) => (p.season ? TTL.playersPrev : TTL.players),
  starts: () => TTL.starts,
  coaches: () => TTL.coaches,
  honors: () => TTL.honors,
  league: () => TTL.league,
};

const keyOf = (resource, params = {}) =>
  resource + "?" + Object.keys(params).filter((k) => params[k] != null && params[k] !== "").sort().map((k) => `${k}=${params[k]}`).join("&");

export function createStore({
  load = defaultLoad,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  jitter = () => 0.9 + Math.random() * 0.2,    // ±10% so clients don't sync up
  log = () => {},
} = {}) {
  const entries = new Map();

  function entry(resource, params) {
    const key = keyOf(resource, params);
    let e = entries.get(key);
    if (!e) {
      e = { key, resource, params, data: undefined, fetchedAt: 0, expiresAt: 0, error: null, failures: 0, inflight: null, subs: new Set(), timer: null, lastAccess: 0 };
      entries.set(key, e);
    }
    e.lastAccess = now();
    return e;
  }

  function meta(e) {
    const t = now();
    return {
      key: e.key,
      fetchedAt: e.fetchedAt ? new Date(e.fetchedAt).toISOString() : null,
      stale: Boolean(e.error) || t >= e.expiresAt,
      error: e.error ? e.error.message : null,
      refreshInMs: Math.max(0, e.expiresAt - t),
    };
  }

  async function refresh(e) {
    if (e.inflight) return e.inflight;
    e.inflight = (async () => {
      try {
        const data = await load(e.resource, e.params);
        const t = now();
        e.data = data; e.fetchedAt = t; e.error = null; e.failures = 0;
        e.expiresAt = t + Math.round(POLICIES[e.resource](data, t, e.params) * jitter());
        log(`refreshed ${e.key} (next in ${Math.round((e.expiresAt - t) / 1000)}s)`);
      } catch (err) {
        e.failures += 1; e.error = err;
        const base = e.data !== undefined ? Math.min(POLICIES[e.resource](e.data, now(), e.params), 30 * SEC) : 5 * SEC;
        e.expiresAt = now() + Math.min(base * 2 ** (e.failures - 1), MAX_BACKOFF);
        log(`failed ${e.key}: ${err.message} (retry in ${Math.round((e.expiresAt - now()) / 1000)}s)`);
      } finally {
        e.inflight = null;
      }
      e.subs.forEach((cb) => { try { cb(e.data, meta(e)); } catch {} });
    })();
    return e.inflight;
  }

  /** Cached read. Fetches only when the cached copy has expired. Throws only if we have never had data. */
  async function get(resource, params = {}, { force = false } = {}) {
    if (!POLICIES[resource]) throw new Error(`Unknown resource: ${resource}`);
    const e = entry(resource, params);
    if (force || e.data === undefined || now() >= e.expiresAt) await refresh(e);
    if (e.data === undefined) throw e.error || new Error("No data");
    return { data: e.data, meta: meta(e) };
  }

  function schedule(e) {
    if (e.timer) clearTimer(e.timer);
    e.timer = null;
    if (!e.subs.size) return;
    e.timer = setTimer(async () => {
      e.timer = null;
      if (!e.subs.size) return;
      await refresh(e);
      schedule(e);
    }, Math.max(1000, e.expiresAt - now()));
  }

  /** Keep a resource fresh on its policy's cadence while anyone is subscribed. */
  function watch(resource, params, cb) {
    const e = entry(resource, params || {});
    e.subs.add(cb);
    if (e.data !== undefined) cb(e.data, meta(e));
    (e.data === undefined || now() >= e.expiresAt ? refresh(e) : Promise.resolve()).then(() => schedule(e));
    return () => {
      e.subs.delete(cb);
      if (!e.subs.size && e.timer) { clearTimer(e.timer); e.timer = null; }
    };
  }

  /** Seed a cache entry with data fetched elsewhere (e.g. one team's roster out of the league-wide load). */
  function prime(resource, params, data) {
    if (!POLICIES[resource] || data === undefined) return;
    const e = entry(resource, params || {});
    if (e.inflight) return;
    const t = now();
    e.data = data; e.fetchedAt = t; e.error = null; e.failures = 0;
    e.expiresAt = t + POLICIES[resource](data, t, e.params);
  }

  /** Drop idle cache entries (e.g. old game summaries). */
  function sweep(maxIdleMs = 2 * 60 * MIN) {
    const t = now();
    for (const [k, e] of entries) if (!e.subs.size && !e.inflight && t - e.lastAccess > maxIdleMs) entries.delete(k);
  }

  function status() {
    return [...entries.values()].map((e) => ({ ...meta(e), watchers: e.subs.size, failures: e.failures }));
  }

  return { get, watch, prime, sweep, status, _entries: entries };
}
