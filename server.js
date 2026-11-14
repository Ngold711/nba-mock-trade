#!/usr/bin/env node
// NBA data service: caches ESPN's public feeds and serves normalized JSON + the static UI.
// Zero dependencies. Node 18+.   PORT=8787 node server.js
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize as normPath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./service/store.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const QUIET = process.env.QUIET === "1";
const log = (...a) => { if (!QUIET) console.log(new Date().toISOString(), ...a); };

export const store = createStore({ log: (m) => log("[store]", m) });

// Common abbreviations → ESPN's own (ESPN uses GS, NO, NY, SA, UTAH, WSH).
const ALIASES = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
async function resolveTeam(input) {
  const raw = String(input || "").trim();
  if (/^\d{1,3}$/.test(raw)) return raw;
  const abbr = (ALIASES[raw.toUpperCase()] || raw.toUpperCase());
  const { data } = await store.get("teams");
  const t = data.find((x) => x.abbr.toUpperCase() === abbr);
  return t ? t.id : null;
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

async function serve(res, resource, params) {
  try {
    json(res, 200, await store.get(resource, params));
  } catch (err) {
    json(res, 502, { error: `Couldn't reach ESPN: ${err.message}`, resource });
  }
}

const routes = [
  [/^\/api\/health$/, (req, res) => json(res, 200, { ok: true, uptime: process.uptime(), cache: store.status() })],
  [/^\/api\/scoreboard$/, (req, res, m, q) => {
    const date = q.get("date");
    if (date && !/^\d{8}$/.test(date)) return json(res, 400, { error: "date must be YYYYMMDD" });
    return serve(res, "scoreboard", date ? { date } : {});
  }],
  [/^\/api\/games\/(\d{6,12})$/, (req, res, m) => serve(res, "summary", { id: m[1] })],
  [/^\/api\/teams$/, (req, res) => serve(res, "teams", {})],
  [/^\/api\/rosters\/([A-Za-z0-9]{1,5})$/, async (req, res, m) => {
    let id;
    try { id = await resolveTeam(m[1]); } catch (err) { return json(res, 502, { error: `Couldn't load teams: ${err.message}` }); }
    if (!id) return json(res, 404, { error: `Unknown team: ${m[1]}` });
    return serve(res, "roster", { team: id });
  }],
  [/^\/api\/injuries$/, async (req, res, m, q) => {
    const teamId = q.get("team");
    if (!teamId) return serve(res, "injuries", {});
    try {
      const out = await store.get("injuries");
      const id = await resolveTeam(teamId);
      json(res, 200, { ...out, data: out.data.filter((i) => i.team.id === id) });
    } catch (err) { json(res, 502, { error: `Couldn't reach ESPN: ${err.message}` }); }
  }],
  [/^\/api\/standings$/, (req, res) => serve(res, "standings", {})],
  [/^\/api\/college\/(\d{3,12})$/, (req, res, m, q) => {
    const team = q.get("team");
    if (team && !/^\d{1,6}$/.test(team)) return json(res, 400, { error: "team must be an ESPN college team id" });
    return serve(res, "college", team ? { id: m[1], team } : { id: m[1] });
  }],
  [/^\/api\/transactions$/, (req, res) => serve(res, "transactions", {})],
];

const DENY = new Set(["package.json", "package-lock.json", "server.js"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = normPath(join(ROOT, decodeURIComponent(rel)));
  if (!file.startsWith(ROOT) || file.slice(ROOT.length).split(sep).some((p) => p.startsWith(".") || p === "node_modules" || p === "test") || !TYPES[extname(file)] || DENY.has(file.slice(ROOT.length).replace(/^[\\/]/, ""))) {
    res.writeHead(404); return res.end("Not found");
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": TYPES[extname(file)], "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("Not found"); }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  for (const [re, handler] of routes) {
    const m = re.exec(url.pathname);
    if (m) return handler(req, res, m, url.searchParams);
  }
  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown endpoint" });
  return serveStatic(req, res, url.pathname);
});

// Keep the league-wide feeds warm in the background on their own cadence.
// Rosters and game summaries are fetched lazily and cached by TTL.
export function startPolling() {
  const stops = ["scoreboard", "injuries", "standings", "transactions", "teams"].map((r) => store.watch(r, {}, () => {}));
  const sweeper = setInterval(() => store.sweep(), 10 * 60 * 1000);
  sweeper.unref?.();
  return () => { stops.forEach((s) => s()); clearInterval(sweeper); };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startPolling();
  server.listen(PORT, HOST, () => log(`NBA data service on http://${HOST}:${PORT}  (UI: /  live: /live.html  api: /api/health)`));
}
