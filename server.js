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

/* Hooptrax AI: Gemini (free tier, streamed) grounded in a question-sliced view of the live cache,
   with a zero-key local engine fallback that answers in milliseconds. */
import { SYSTEM_PROMPT, buildIndex, buildContext, localAnswer, chipsFor, cardsFor, scheduleDates } from "./service/chat.js";
import { projectLottery, lotteryTable, DEFAULT_FORMAT } from "./service/draft.js";
// gemini-2.5-flash is closed to new API keys (404) and the free-tier flash models are often over quota (429),
// so the fast flash-lite models lead. Override with GEMINI_MODELS.
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-flash-latest").split(",").map((x) => x.trim()).filter(Boolean);
const FIRST_TOKEN_MS = 6000, STREAM_MAX_MS = 25000;
const modelDownUntil = new Map();            // model -> ms timestamp; skip models that just failed (404/429/timeout)
const AI_PER_HOUR = 15;
const aiHits = new Map();                    // ip -> timestamps (ms) of AI calls in the last hour

/* 14-day schedule cache: yesterday, today and the next 14 days (US Eastern), refreshed every 15 minutes. */
let schedule = [];
export async function refreshSchedule() {
  const dates = scheduleDates();
  const got = await Promise.allSettled(dates.map((date) => store.get("scoreboard", { date })));
  const fresh = dates.map((date, i) => (got[i].status === "fulfilled" ? { date, games: got[i].value.data?.games || [] } : schedule.find((x) => x.date === date))).filter(Boolean);
  if (fresh.length) schedule = fresh;
  return schedule;
}

let staticData = null, indexMemo = { league: null, history: null, index: null };
async function chatData() {
  staticData ||= Promise.all([readFile(join(ROOT, "nba_history.json"), "utf8"), readFile(join(ROOT, "prospects.json"), "utf8"), readFile(join(ROOT, "salaries_2026_27.json"), "utf8")])
    .then(([h, p, b]) => ({ history: JSON.parse(h), prospects: JSON.parse(p), book: JSON.parse(b) })).catch(() => ({}));
  const names = ["scoreboard", "standings", "injuries", "transactions", "ratings", "league", "players"];
  const got = await Promise.allSettled(names.map((n) => store.get(n)));
  const d = { ...(await staticData) };
  names.forEach((n, i) => { d[n === "players" ? "stats" : n] = got[i].status === "fulfilled" ? got[i].value.data : null; });
  if (!schedule.length) await refreshSchedule().catch(() => {});
  // keep today's entry in step with the live scoreboard
  d.schedule = schedule.map((x) => (d.scoreboard?.games?.length && x.games.some((g) => d.scoreboard.games[0].id === g.id) ? { ...x, games: d.scoreboard.games } : x));
  if (d.standings) {
    try {
      const proj = projectLottery(d.standings, DEFAULT_FORMAT, () => 0.5);
      const table = lotteryTable(DEFAULT_FORMAT, { balls: proj.balls, order: proj.order, ties: proj.lottery.map((t) => t.tie) });
      d.lottery = table.map((r) => ({ ...r, team: proj.lottery[r.seed - 1]?.team }));
    } catch {}
  }
  if (indexMemo.league !== d.league || indexMemo.history !== d.history) indexMemo = { league: d.league, history: d.history, index: buildIndex(d) };
  d.index = indexMemo.index;
  return d;
}

/** Stream a Gemini answer. Calls onDelta(text) per chunk; resolves { text, model } or { error }.
 *  Gives up (so the caller can answer locally) if no text arrives within FIRST_TOKEN_MS of `t0`. */
async function askGemini(question, history, contextText, onDelta = () => {}, t0 = Date.now()) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "no-key" };
  const contents = [...history.slice(-6).map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.text || "").slice(0, 1500) }] })),
    { role: "user", parts: [{ text: `DATA (live):\n${contextText}\n\nQUESTION: ${question}` }] }];
  let last = "unavailable";
  const order = [...GEMINI_MODELS.filter((m) => !(modelDownUntil.get(m) > Date.now())), ...GEMINI_MODELS.filter((m) => modelDownUntil.get(m) > Date.now())];
  for (const model of order) {
    const left = FIRST_TOKEN_MS - (Date.now() - t0);
    if (left < 400) { last = "timeout"; break; }
    const ac = new AbortController();
    let firstTimer = setTimeout(() => ac.abort(new Error("first-token")), left);
    const hardTimer = setTimeout(() => ac.abort(new Error("max")), STREAM_MAX_MS);
    let text = "", finish = "";
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
        signal: ac.signal,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        last = `${r.status} ${j?.error?.status || ""}`.trim();
        if (r.status === 400 && /API key/i.test(j?.error?.message || "")) return { error: "bad-key" };
        modelDownUntil.set(model, Date.now() + (r.status === 404 ? 6 * 3600e3 : r.status === 429 ? 90e3 : 30e3));
        continue;
      }
      const dec = new TextDecoder(); let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
          const cand = j.candidates?.[0];
          const piece = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
          if (cand?.finishReason) finish = cand.finishReason;
          if (piece) { if (!text) clearTimeout(firstTimer); text += piece; onDelta(piece); }
        }
      }
      clearTimeout(firstTimer); clearTimeout(hardTimer);
      if (text.trim()) { modelDownUntil.delete(model); return { text: text.trim() + (finish === "MAX_TOKENS" ? " …" : ""), model }; }
      last = "empty";
    } catch (e) {
      clearTimeout(firstTimer); clearTimeout(hardTimer);
      if (text.trim()) return { text: text.trim() + " …", model };           // cut off mid-stream: keep what we have
      last = ac.signal.reason?.message === "first-token" ? "timeout" : "network";
      if (last === "timeout") modelDownUntil.set(model, Date.now() + 60e3);
    }
  }
  return { error: last };
}

async function chatRoute(req, res) {
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  const t0 = Date.now();
  let body;
  try { body = JSON.parse(await readBody(req, 24 * 1024)); } catch { return json(res, 400, { error: "Send JSON: { message, history }" }); }
  const question = String(body?.message || "").trim().slice(0, 500);
  if (!question) return json(res, 400, { error: "Empty message" });
  const history = Array.isArray(body?.history) ? body.history.filter((m) => m && typeof m.text === "string").slice(-6) : [];
  const d = await chatData();
  const ctx = buildContext(question, d, d.index);
  const cards = cardsFor(question, d, d.index, ctx.entities);
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now(), hits = (aiHits.get(ip) || []).filter((t) => now - t < 3600e3);
  const local = localAnswer(question, d, d.index);
  const useAi = Boolean(process.env.GEMINI_API_KEY) && hits.length < AI_PER_HOUR;
  if (useAi) { hits.push(now); aiHits.set(ip, hits); if (aiHits.size > 5000) aiHits.delete(aiHits.keys().next().value); }
  const limitNote = !process.env.GEMINI_API_KEY ? "" : !useAi ? "AI limit reached for this hour; answered from live Hooptrax data." : "";

  if (body?.stream) {
    // NDJSON stream: {t:"meta"} → {t:"delta"}* → {t:"done"}
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
    const send = (o) => res.write(JSON.stringify(o) + "\n");
    send({ t: "meta", cards });
    let answer, source = "local", note = limitNote;
    if (useAi) {
      const g = await askGemini(question, history, ctx.text, (piece) => send({ t: "delta", text: piece }), t0);
      if (g.text) { answer = g.text; source = `gemini:${g.model}`; }
    }
    if (!answer) { answer = local.text; send({ t: "delta", text: answer, replace: true }); }
    send({ t: "done", answer, source, note, chips: chipsFor(answer, d.index, ctx.entities), ms: Date.now() - t0, aiRemaining: Math.max(0, AI_PER_HOUR - hits.length) });
    return res.end();
  }
  let answer = null, source = "local";
  if (useAi) { const g = await askGemini(question, history, ctx.text, undefined, t0); if (g.text) { answer = g.text; source = `gemini:${g.model}`; } }
  if (!answer) answer = local.text;
  json(res, 200, { data: { answer, source, note: limitNote, cards, chips: chipsFor(answer, d.index, ctx.entities), aiRemaining: Math.max(0, AI_PER_HOUR - hits.length) } });
}


/* Most Traded & Rumored: HoopsHype + ESPN news trade mentions (refreshed every 30 min), blended with what
   Hooptrax users put into mock trades (rolling 7 days, flushed to data/trade-adds.json). */
import { parseFeed, parseEspnNews, playerMatcher, countMentions, rankTrending, createTradeCounter } from "./service/trending.js";
const HOOPSHYPE_FEEDS = (process.env.HOOPSHYPE_FEEDS || "https://hoopshype.com/rumors/feed/,https://hoopshype.com/feed/").split(",").map((x) => x.trim()).filter(Boolean);
const ESPN_NEWS = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=100";
const FEED_UA = "Hooptrax/1.0 (+https://hooptrax.com)";
const ADDS_FILE = join(ROOT, "data", "trade-adds.json");
const tradeAdds = createTradeCounter();
try { tradeAdds.load(JSON.parse(await readFile(ADDS_FILE, "utf8"))); } catch {}
let addsFlush = null;
const flushAdds = () => {
  if (addsFlush) return;
  addsFlush = setTimeout(async () => { addsFlush = null; try { await mkdir(join(ROOT, "data"), { recursive: true }); await writeFile(ADDS_FILE, JSON.stringify(tradeAdds)); } catch {} }, 5000);
  addsFlush.unref?.();
};
let rumorCache = { at: 0, rumor: new Map(), news: new Map(), buzz: new Map(), sources: {} }, rumorLoading = null;
async function fetchText(url, { ua = true, ms = 12000 } = {}) {
  const r = await fetch(url, { headers: ua ? { "user-agent": FEED_UA, accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" } : {}, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
export async function refreshRumors() {
  if (rumorLoading) return rumorLoading;
  rumorLoading = (async () => {
    const league = (await store.get("league").catch(() => null))?.data;
    if (!league?.players?.length) return rumorCache;
    const match = playerMatcher(league.players);
    const sources = {};
    let hh = [];
    for (const url of HOOPSHYPE_FEEDS) {
      try { const items = parseFeed(await fetchText(url)); sources.hoopshype = { ok: true, url, items: items.length }; if (items.length) { hh = items; break; } }
      catch (e) { sources.hoopshype = { ok: false, url, error: String(e.message || e).slice(0, 80) }; }
    }
    let espn = [];
    try { espn = parseEspnNews(JSON.parse(await fetchText(ESPN_NEWS, { ua: false }))); /* ESPN 403s custom user agents; same default client as the other ESPN feeds */ sources.espn = { ok: true, items: espn.length }; }
    catch (e) { sources.espn = { ok: false, error: String(e.message || e).slice(0, 80) }; }
    rumorCache = { at: Date.now(), rumor: countMentions(hh, match), news: countMentions(espn, match), buzz: countMentions(espn, match, { tradeOnly: false }), sources };
    return rumorCache;
  })().finally(() => { rumorLoading = null; });
  return rumorLoading;
}
let trendMemo = { at: 0, body: null };
async function trendingRoute(req, res) {
  if (!rumorCache.at) await refreshRumors().catch(() => {});
  if (!trendMemo.body || Date.now() - trendMemo.at > 60e3 || trendMemo.rumorAt !== rumorCache.at) {
    const [league, stats] = await Promise.all([store.get("league").catch(() => null), store.get("players").catch(() => null)]);
    const book = await chatData().then((d) => d.book).catch(() => null);
    const players = rankTrending({ league: league?.data, book, stats: stats?.data, rumor: rumorCache.rumor, news: rumorCache.news, buzz: rumorCache.buzz, userAdds: tradeAdds.counts() });
    trendMemo = { at: Date.now(), rumorAt: rumorCache.at, body: { asOf: new Date(rumorCache.at || Date.now()).toISOString(), sources: rumorCache.sources, players } };
  }
  res.setHeader("cache-control", "public, max-age=60");
  return json(res, 200, { data: trendMemo.body });
}
async function tradeAddsRoute(req, res) {
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  let body; try { body = JSON.parse(await readBody(req, 4096)); } catch { return json(res, 400, { error: "Send JSON: { ids }" }); }
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const visitor = createHash("sha256").update(`${ip}|${String(body?.visitor || "").slice(0, 40)}`).digest("hex").slice(0, 16);
  const n = tradeAdds.add(visitor, ids);
  if (n) { flushAdds(); trendMemo.at = 0; }
  return json(res, 200, { data: { counted: n } });
}

const routes = [
  [/^\/api\/nba-chat$/, chatRoute],
  [/^\/api\/trending-trades$/, trendingRoute],
  [/^\/api\/trade-adds$/, tradeAddsRoute],
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
  if (req.method !== "GET" && req.method !== "HEAD" && !(req.method === "POST" && (url.pathname === "/api/polls" || url.pathname === "/api/nba-chat" || url.pathname === "/api/trade-adds"))) { res.writeHead(405); return res.end(); }
  for (const [re, handler] of routes) {
    const m = re.exec(url.pathname);
    if (m) return handler(req, res, m, url.searchParams);
  }
  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown endpoint" });
  // Live is the home hub. "/" → /live.html, unless the URL carries a deep link for the Trade Machine
  // (?trade=…). The fragment (#t=…, #draft) survives the redirect and live.html forwards it.
  if (url.pathname === "/" && ![...url.searchParams.keys()].some((k) => k !== "source")) {
    res.writeHead(302, { location: "/live.html", "cache-control": "no-cache" }); return res.end();
  }
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
  // Hooptrax AI: yesterday + today + next 14 days of games (US Eastern), every 15 minutes
  refreshSchedule().catch(() => {});
  const sched = setInterval(() => refreshSchedule().catch(() => {}), 15 * 60 * 1000);
  sched.unref?.();
  // Most Traded & Rumored: HoopsHype + ESPN news, every 30 minutes (first pass once rosters are warm)
  setTimeout(() => refreshRumors().catch(() => {}), 8000).unref?.();
  const rumors = setInterval(() => refreshRumors().catch(() => {}), 30 * 60 * 1000);
  rumors.unref?.();
  return () => { stops.forEach((s) => s()); clearInterval(sweeper); clearInterval(sched); clearInterval(rumors); };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startPolling();
  server.listen(PORT, HOST, () => log(`NBA data service on http://${HOST}:${PORT}  (UI: /  live: /live.html  api: /api/health)`));
}
