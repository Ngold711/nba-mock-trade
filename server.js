#!/usr/bin/env node
// NBA data service: caches ESPN's public feeds and serves normalized JSON + the static UI.
// Zero dependencies. Node 18+.   PORT=8787 node server.js
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize as normPath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./service/store.js";
import { setResolver } from "./service/espn.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
// .env (local only, git-ignored): KEY=VALUE lines; real environment variables win.
try {
  for (const line of (await readFile(join(ROOT, ".env"), "utf8")).split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const QUIET = process.env.QUIET === "1";
const log = (...a) => { if (!QUIET) console.log(new Date().toISOString(), ...a); };

export const store = createStore({ log: (m) => log("[store]", m) });
setResolver((resource, params) => store.get(resource, params).then((r) => r.data));

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

/* Image proxy for canvas exports (receipt / ballot cards). Same-origin bytes can never taint a canvas,
   even on browsers that drop ESPN's CORS headers. Locked to ESPN's image CDN so it isn't an open proxy. */
const IMG_HOSTS = new Set(["a.espncdn.com"]);
const imgCache = new Map();          // url -> { type, body, at }
async function proxyImage(req, res, m, q) {
  let target;
  try { target = new URL(q.get("url") || ""); } catch { return json(res, 400, { error: "url must be an absolute https URL" }); }
  if (target.protocol !== "https:" || !IMG_HOSTS.has(target.hostname)) return json(res, 400, { error: "Only ESPN image CDN URLs can be proxied" });
  const key = target.href;
  const send = (hit) => { res.writeHead(200, { "content-type": hit.type, "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" }); res.end(hit.body); };
  const cached = imgCache.get(key);
  if (cached && Date.now() - cached.at < 24 * 3600e3) return send(cached);
  try {
    const r = await fetch(key, { signal: AbortSignal.timeout(8000) });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !type.startsWith("image/")) { res.writeHead(r.status === 404 ? 404 : 502); return res.end(); }
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > 3 * 1024 * 1024) { res.writeHead(413); return res.end(); }
    const hit = { type, body, at: Date.now() };
    imgCache.set(key, hit);
    if (imgCache.size > 400) imgCache.delete(imgCache.keys().next().value);
    send(hit);
  } catch { res.writeHead(502); res.end(); }
}

/* Hooptrax Live Polls: tap-to-vote community polls (MVP, ROY, DPOY, Player of the Week).
   Counts live in memory and are flushed to data/polls.json; a redeploy on hosts with ephemeral disks resets them.
   One vote per poll per browser (client id) and per IP. */
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const POLL_FILE = join(ROOT, "data", "polls.json");
const polls = new Map();           // pollId -> { counts: {optionId: n}, voters: Set<hash> }
try { const saved = JSON.parse(await readFile(POLL_FILE, "utf8")); for (const [id, v] of Object.entries(saved)) polls.set(id, { counts: v.counts || {}, voters: new Set(v.voters || []) }); } catch {}
let pollFlush = null;
const flushPolls = () => {
  if (pollFlush) return;
  pollFlush = setTimeout(async () => {
    pollFlush = null;
    const out = Object.fromEntries([...polls].map(([id, v]) => [id, { counts: v.counts, voters: [...v.voters] }]));
    try { await mkdir(join(ROOT, "data"), { recursive: true }); await writeFile(POLL_FILE, JSON.stringify(out)); } catch {}
  }, 2000);
  pollFlush.unref?.();
};
const POLL_ID = /^[a-z0-9-]{3,48}$/, OPT_ID = /^[0-9]{1,12}$/;
const pollView = (id) => { const p = polls.get(id); const counts = p ? p.counts : {}; return { id, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }; };
function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
  });
}
async function pollsRoute(req, res, m, q) {
  if (req.method === "GET") {
    const ids = (q.get("ids") || "").split(",").filter((x) => POLL_ID.test(x)).slice(0, 20);
    return json(res, 200, { data: Object.fromEntries(ids.map((id) => [id, pollView(id)])) });
  }
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Send JSON: { poll, option, voter }" }); }
  const { poll, option, voter } = body || {};
  if (!POLL_ID.test(String(poll)) || !OPT_ID.test(String(option)) || !/^[a-z0-9]{8,40}$/i.test(String(voter))) return json(res, 400, { error: "Invalid poll, option or voter id" });
  if (!polls.has(poll) && polls.size >= 300) return json(res, 429, { error: "Too many polls" });
  const p = polls.get(poll) || polls.set(poll, { counts: {}, voters: new Set() }).get(poll);
  if (!(option in p.counts) && Object.keys(p.counts).length >= 30) return json(res, 400, { error: "Too many options" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const keys = [createHash("sha256").update(`${poll}|v|${voter}`).digest("hex").slice(0, 20), createHash("sha256").update(`${poll}|ip|${ip}`).digest("hex").slice(0, 20)];
  if (keys.some((k) => p.voters.has(k))) return json(res, 409, { error: "Already voted", data: pollView(poll) });
  keys.forEach((k) => p.voters.add(k));
  p.counts[option] = (p.counts[option] || 0) + 1;
  flushPolls();
  return json(res, 200, { data: pollView(poll) });
}

/* Ask Hooptrax: Gemini (free tier) grounded in the live cache, with a zero-key local engine fallback. */
import { SYSTEM_PROMPT, buildIndex, buildContext, localAnswer, chipsFor } from "./service/chat.js";
import { projectLottery, lotteryTable, DEFAULT_FORMAT } from "./service/draft.js";
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-flash-latest,gemini-2.5-flash,gemini-3-flash-preview,gemini-3.5-flash").split(",").map((x) => x.trim()).filter(Boolean);
const AI_PER_HOUR = 15;
const aiHits = new Map();                    // ip -> timestamps (ms) of AI calls in the last hour
let staticData = null;
async function chatData() {
  staticData ||= Promise.all([readFile(join(ROOT, "nba_history.json"), "utf8"), readFile(join(ROOT, "prospects.json"), "utf8"), readFile(join(ROOT, "salaries_2026_27.json"), "utf8")])
    .then(([h, p, b]) => ({ history: JSON.parse(h), prospects: JSON.parse(p), book: JSON.parse(b) })).catch(() => ({}));
  const names = ["scoreboard", "standings", "injuries", "transactions", "ratings", "league", "players"];
  const got = await Promise.allSettled(names.map((n) => store.get(n)));
  const d = { ...(await staticData) };
  names.forEach((n, i) => { d[n === "players" ? "stats" : n] = got[i].status === "fulfilled" ? got[i].value.data : null; });
  if (d.standings) {
    try {
      const proj = projectLottery(d.standings, DEFAULT_FORMAT, () => 0.5);
      const table = lotteryTable(DEFAULT_FORMAT, { balls: proj.balls, order: proj.order, ties: proj.lottery.map((t) => t.tie) });
      d.lottery = table.map((r) => ({ ...r, team: proj.lottery[r.seed - 1]?.team }));
    } catch {}
  }
  d.index = buildIndex(d);
  return d;
}
async function askGemini(question, history, contextText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "no-key" };
  const contents = [...history.slice(-6).map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.text || "").slice(0, 1500) }] })),
    { role: "user", parts: [{ text: `DATA (live, ${new Date().toISOString()}):\n${contextText}\n\nQUESTION: ${question}` }] }];
  let last = "unavailable";
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 4096 } }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { last = `${r.status} ${j?.error?.status || ""}`; if (r.status === 400 && /API key/i.test(j?.error?.message || "")) return { error: "bad-key" }; continue; }
      const cand = j.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
      if (text && cand?.finishReason !== "MAX_TOKENS") return { text, model };
      if (text) return { text: text + " …", model };
      last = "empty";
    } catch (e) { last = e.name === "TimeoutError" ? "timeout" : "network"; }
  }
  return { error: last };
}
async function chatRoute(req, res) {
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  let body;
  try { body = JSON.parse(await readBody(req, 16 * 1024)); } catch { return json(res, 400, { error: "Send JSON: { message, history }" }); }
  const question = String(body?.message || "").trim().slice(0, 500);
  if (!question) return json(res, 400, { error: "Empty message" });
  const history = Array.isArray(body?.history) ? body.history.filter((m) => m && typeof m.text === "string").slice(-6) : [];
  const d = await chatData();
  const ctx = buildContext(question, d, d.index);
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now(), hits = (aiHits.get(ip) || []).filter((t) => now - t < 3600e3);
  let answer = null, source = "local", note = "";
  if (hits.length >= AI_PER_HOUR) note = "AI limit reached for this hour; answering from live Hooptrax data.";
  else if (process.env.GEMINI_API_KEY) {
    hits.push(now); aiHits.set(ip, hits);
    if (aiHits.size > 5000) aiHits.delete(aiHits.keys().next().value);
    const g = await askGemini(question, history, ctx.text);
    if (g.text) { answer = g.text; source = `gemini:${g.model}`; }
    else note = g.error === "bad-key" ? "AI key rejected; answering from live Hooptrax data." : "AI is busy right now; answering from live Hooptrax data.";
  }
  if (!answer) { const l = localAnswer(question, d, d.index); answer = l.text; }
  json(res, 200, { data: { answer, source, note, chips: chipsFor(answer, d.index, ctx.entities), aiRemaining: Math.max(0, AI_PER_HOUR - hits.length) } });
}

const routes = [
  [/^\/api\/nba-chat$/, chatRoute],
  [/^\/api\/polls$/, pollsRoute],
  [/^\/api\/proxy-image$/, proxyImage],
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
  [/^\/api\/standings$/, (req, res, m, q) => {
    const season = q.get("season");
    if (season && !/^\d{4}$/.test(season)) return json(res, 400, { error: "season must be a year like 2026" });
    return serve(res, "standings", season ? { season } : {});
  }],
  [/^\/api\/news$/, (req, res) => serve(res, "news", {})],
  [/^\/api\/players$/, (req, res, m, q) => {
    const season = q.get("season");
    if (season && !/^\d{4}$/.test(season)) return json(res, 400, { error: "season must be a year like 2026" });
    return serve(res, "players", season ? { season } : {});
  }],
  [/^\/api\/starts$/, (req, res) => serve(res, "starts", {})],
  [/^\/api\/coaches$/, (req, res) => serve(res, "coaches", {})],
  [/^\/api\/league$/, (req, res) => serve(res, "league", {})],
  [/^\/api\/2k-ratings$/, (req, res) => serve(res, "ratings", {})],
  [/^\/api\/team-stats$/, (req, res) => serve(res, "teamstats", {})],
  [/^\/api\/sos$/, (req, res) => serve(res, "sos", {})],
  [/^\/api\/bio\/(\d{1,12})$/, (req, res, m) => serve(res, "bio", { id: m[1] })],
  [/^\/api\/career\/(\d{1,12})$/, (req, res, m) => serve(res, "career", { id: m[1] })],
  [/^\/api\/search$/, (req, res, m, q) => {
    const term = String(q.get("q") || "").trim().slice(0, 40);
    if (term.length < 2 || !/^[\p{L}\p{N} .'-]+$/u.test(term)) return json(res, 400, { error: "q must be 2–40 letters" });
    return serve(res, "search", { q: term.toLowerCase() });
  }],
  [/^\/api\/schedule\/([A-Za-z0-9]{1,5})$/, async (req, res, m) => {
    let id;
    try { id = await resolveTeam(m[1]); } catch (err) { return json(res, 502, { error: `Couldn't load teams: ${err.message}` }); }
    if (!id) return json(res, 404, { error: `Unknown team: ${m[1]}` });
    return serve(res, "schedule", { team: id });
  }],
  [/^\/api\/honors\/(\d{1,12})$/, (req, res, m) => serve(res, "honors", { id: m[1] })],
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
  if (!file.startsWith(ROOT) || file.slice(ROOT.length).split(sep).some((p) => p.startsWith(".") || p === "node_modules" || p === "test" || p === "data") || !TYPES[extname(file)] || DENY.has(file.slice(ROOT.length).replace(/^[\\/]/, ""))) {
    res.writeHead(404); return res.end("Not found");
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": file.endsWith("manifest.json") ? "application/manifest+json" : TYPES[extname(file)], "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("Not found"); }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD" && !(req.method === "POST" && (url.pathname === "/api/polls" || url.pathname === "/api/nba-chat"))) { res.writeHead(405); return res.end(); }
  for (const [re, handler] of routes) {
    const m = re.exec(url.pathname);
    if (m) return handler(req, res, m, url.searchParams);
  }
  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown endpoint" });
  return serveStatic(req, res, url.pathname);
});

// Warm everything the pages need on startup, in parallel, then keep it fresh in the background
// (league rosters and standings every 30 min), so requests are answered from memory instead of
// waiting on ESPN. This matters most right after a Render cold start.
export function startPolling() {
  const stops = ["scoreboard", "injuries", "standings", "transactions", "teams", "players", "ratings", "teamstats", "sos"].map((r) => store.watch(r, {}, () => {}));
  stops.push(store.watch("league", {}, (data) => {
    if (!data?.rosters) return;
    for (const [teamId, roster] of Object.entries(data.rosters)) store.prime("roster", { team: teamId }, roster);
  }));
  const sweeper = setInterval(() => store.sweep(), 10 * 60 * 1000);
  sweeper.unref?.();
  return () => { stops.forEach((s) => s()); clearInterval(sweeper); };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startPolling();
  server.listen(PORT, HOST, () => log(`NBA data service on http://${HOST}:${PORT}  (UI: /  live: /live.html  api: /api/health)`));
}
