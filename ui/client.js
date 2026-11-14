// Browser data client. Prefers the local service (/api, shared cache for every viewer);
// if the page is hosted statically with no service behind it, it runs the same cache +
// polling store in the browser and calls ESPN directly (ESPN sends CORS headers).
import { createStore } from "../service/store.js";

const ROUTES = {
  scoreboard: (p) => `/api/scoreboard${p.date ? `?date=${encodeURIComponent(p.date)}` : ""}`,
  summary: (p) => `/api/games/${encodeURIComponent(p.id)}`,
  roster: (p) => `/api/rosters/${encodeURIComponent(p.team)}`,
  injuries: () => "/api/injuries",
  standings: (p) => `/api/standings${p.season ? `?season=${encodeURIComponent(p.season)}` : ""}`,
  news: () => "/api/news",
  players: (p) => `/api/players${p.season ? `?season=${encodeURIComponent(p.season)}` : ""}`,
  starts: () => "/api/starts",
  coaches: () => "/api/coaches",
  honors: (p) => `/api/honors/${encodeURIComponent(p.id)}`,
  transactions: () => "/api/transactions",
  teams: () => "/api/teams",
  league: () => "/api/league",
  ratings: () => "/api/2k-ratings",
  schedule: (p) => `/api/schedule/${encodeURIComponent(p.team)}`,
  teamstats: () => "/api/team-stats",
  sos: () => "/api/sos",
  bio: (p) => `/api/bio/${encodeURIComponent(p.id)}`,
  college: (p) => `/api/college/${encodeURIComponent(p.id)}${p.team ? `?team=${encodeURIComponent(p.team)}` : ""}`,
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// AbortSignal.timeout() needs iOS 16; build the same thing by hand.
function timeoutSignal(ms) {
  if (typeof AbortController === "undefined") return undefined;
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
}

async function detectServer(base) {
  if (location.protocol === "file:") return false;
  try {
    const res = await fetch(`${base}/api/health`, { signal: timeoutSignal(1500) });
    return res.ok && (res.headers.get("content-type") || "").includes("json");
  } catch { return false; }
}

// One client per page: the app shell (ticker, Team Hub, quick-views) and the active tool share it.
let shared = null;
export function createClient(opts = {}) {
  if (!shared) shared = buildClient(opts);
  return shared;
}
async function buildClient({ base = "" } = {}) {
  const server = await detectServer(base);
  const store = server ? null : createStore();

  async function get(resource, params = {}) {
    if (store) return store.get(resource, params);
    const res = await fetch(base + ROUTES[resource](params), { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  /**
   * Keep a resource fresh. Cadence comes from the cache's own policy (meta.refreshInMs):
   * ~20s while games are live, 15–60 min for slow data. Pauses while the tab is hidden.
   */
  function watch(resource, params, onData, onError = () => {}) {
    let stopInner = null, stopped = false;

    const startServerPoll = () => {
      let timer = 0, alive = true;
      const tick = async () => {
        let delay = 15000;
        try {
          const { data, meta } = await get(resource, params);
          if (!alive) return;
          onData(data, meta);
          delay = clamp((meta?.refreshInMs ?? 15000) + 750, 5000, 15 * 60e3);
        } catch (err) { if (alive) onError(err); }
        if (alive) timer = setTimeout(tick, delay);
      };
      tick();
      return () => { alive = false; clearTimeout(timer); };
    };
    const startStoreWatch = () => store.watch(resource, params, (data, meta) => {
      if (data === undefined) onError(new Error(meta.error || "No data"));
      else onData(data, meta);
    });
    const start = () => { if (!stopInner && !stopped) stopInner = store ? startStoreWatch() : startServerPoll(); };
    const pause = () => { stopInner?.(); stopInner = null; };
    const vis = () => (document.hidden ? pause() : start());

    document.addEventListener("visibilitychange", vis);
    if (!document.hidden) start();
    return () => { stopped = true; pause(); document.removeEventListener("visibilitychange", vis); };
  }

  return { mode: server ? "service" : "direct", get, watch };
}
