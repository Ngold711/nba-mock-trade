// "Most Traded & Rumored": ranks the NBA's hottest trade targets by blending
//   1. live rumor / mock-trade mentions in HoopsHype's RSS feed and ESPN's NBA news feed,
//   2. how often Hooptrax users put each player into a mock trade (rolling 7 days),
//   3. a small weighted baseline of current rumor mainstays (so the strip is never empty),
// then resolves every name against the cached 2026–27 ESPN rosters + salary book.
// Pure functions; the server does the fetching and caching.
import { resolveSalary } from "./trade.js";

export const TRADE_WORDS = /\b(trade[sd]?|trading|mock|target(?:s|ed|ing)?|(?:trade|chopping) block|on the block|deal|swap|available|shopp(?:ed|ing)|rumou?rs?|interest(?:ed)?|pursu(?:e|ing)|acquir(?:e|ing))\b/i;

/** Rumor mainstays (November 2026), heaviest first. Only used as a light prior. */
export const BASELINE = ["Dejounte Murray", "Jalen Green", "Domantas Sabonis", "Norman Powell", "Tyler Herro", "Naz Reid", "Michael Porter Jr.", "Julius Randle", "Anthony Davis", "Zion Williamson"];

const CODE_OF = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

/** RSS 2.0 / Atom → [{ title, text, date }]. Tolerant regex parser (no dependencies). */
export function parseFeed(xml) {
  const out = [];
  const blocks = String(xml || "").match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  const tag = (b, t) => { const m = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, "i").exec(b); return m ? decode(m[1]) : ""; };
  for (const b of blocks.slice(0, 200)) {
    const title = tag(b, "title");
    const text = [tag(b, "description"), tag(b, "summary"), tag(b, "content:encoded"), tag(b, "content")].filter(Boolean).join(" ").slice(0, 4000);
    const date = Date.parse(tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date")) || null;
    if (title || text) out.push({ title, text, date });
  }
  return out;
}

/** ESPN news JSON → [{ title, text, date, athleteIds }]. */
export function parseEspnNews(json) {
  return (json?.articles || []).map((a) => ({
    title: String(a.headline || ""), text: String(a.description || ""),
    date: Date.parse(a.published || a.lastModified) || null,
    athleteIds: (a.categories || []).filter((c) => c.type === "athlete" && (c.athleteId || c.athlete?.id)).map((c) => String(c.athleteId || c.athlete.id)),
  }));
}

/** Name matcher over active players (full names; suffixes like Jr. optional). */
export function playerMatcher(players) {
  const byFull = new Map();
  for (const p of players) byFull.set(norm(p.name).replace(/ (jr|sr|ii|iii|iv)$/, ""), p);
  const fulls = [...byFull.keys()].sort((a, b) => b.length - a.length);
  return (text) => {
    const q = ` ${norm(text)} `;
    const hit = new Set();
    for (const k of fulls) if (q.includes(` ${k} `)) hit.add(byFull.get(k).id);
    return [...hit];
  };
}

/** Count trade-flavored mentions per player id (one per item per player). Only items within `maxAgeMs`. */
export function countMentions(items, match, { now = Date.now(), maxAgeMs = 21 * 864e5, tradeOnly = true } = {}) {
  const counts = new Map();
  for (const it of items) {
    if (it.date && now - it.date > maxAgeMs) continue;
    const blob = `${it.title} ${it.text}`;
    if (tradeOnly && !TRADE_WORDS.test(blob)) continue;
    const ids = new Set([...match(blob), ...(it.athleteIds || [])]);
    // a name in the headline counts double
    const head = new Set(match(it.title));
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + (head.has(id) ? 2 : 1));
  }
  return counts;
}

/**
 * Rank the top N. `league` = cached ESPN league ({ players, teams }), `book` = salary book, `stats` = players feed.
 * userAdds: Map(id → adds in the last 7 days).
 */
export function rankTrending({ league, book, stats, rumor = new Map(), news = new Map(), buzz = new Map(), userAdds = new Map(), top = 12 }) {
  const players = league?.players || [];
  const byId = new Map(players.map((p) => [String(p.id), p]));
  const byName = new Map(players.map((p) => [norm(p.name).replace(/ (jr|sr|ii|iii|iv)$/, ""), p]));
  const statsById = new Map((stats?.players || []).map((p) => [String(p.id), p.stats]));
  const score = new Map();
  const bump = (id, k, v) => { if (!byId.has(id) || !v) return; const s = score.get(id) || { rumor: 0, news: 0, users: 0, base: 0, buzz: 0 }; s[k] += v; score.set(id, s); };
  for (const [id, n] of rumor) bump(String(id), "rumor", n);
  for (const [id, n] of news) bump(String(id), "news", n);
  for (const [id, n] of userAdds) bump(String(id), "users", n);
  for (const [id, n] of buzz) bump(String(id), "buzz", n);           // any ESPN headline: weak filler signal
  BASELINE.forEach((name, i) => { const p = byName.get(norm(name).replace(/ (jr|sr|ii|iii|iv)$/, "")); if (p) bump(String(p.id), "base", BASELINE.length - i); });
  const total = (s) => 4 * s.rumor + 3 * s.news + 2.5 * Math.sqrt(s.users) + 0.6 * s.base + 0.25 * Math.min(s.buzz, 4);
  const ranked = [...score].map(([id, s]) => ({ id, s, t: total(s) })).sort((a, b) => b.t - a.t).slice(0, top);
  const max = ranked[0]?.t || 1;
  return ranked.map(({ id, s, t }, i) => {
    const p = byId.get(id);
    const team = league.teams?.[p.teamAbbr] || {};
    const sal = resolveSalary(p, { book, stats: statsById.get(id), cba: book?.cba });
    const heat = Math.max(20, Math.round((t / max) * 100));
    return {
      rank: i + 1, id, name: p.name, position: p.position || "",
      headshot: p.headshotSmall || p.headshot || null,
      team: { abbr: p.teamAbbr, code: CODE_OF[p.teamAbbr] || p.teamAbbr, name: team.displayName || "", logo: team.logo || null, color: team.color || "#64748b" },
      salary: sal.salary, salaryEstimate: sal.source === "estimate",
      heat, label: heat >= 85 ? "🔥 Hot" : heat >= 55 ? "Rising" : "Buzz",
      mentions: { rumor: s.rumor, news: s.news }, userAdds: s.users, baseline: s.base > 0 && !s.rumor && !s.news && !s.users,
    };
  });
}

/* ---------- Hooptrax user trade counter (rolling 7 days, de-duplicated per visitor) ---------- */
export function createTradeCounter({ windowMs = 7 * 864e5, dedupeMs = 6 * 3600e3, maxEvents = 50000 } = {}) {
  let events = [];                  // [id, t]
  const seen = new Map();           // visitorKey|id → t
  return {
    add(visitor, ids, now = Date.now()) {
      let n = 0;
      for (const raw of ids.slice(0, 20)) {
        const id = String(raw); if (!/^\d{1,10}$/.test(id)) continue;
        const k = `${visitor}|${id}`;
        if (now - (seen.get(k) || 0) < dedupeMs) continue;
        seen.set(k, now); events.push([id, now]); n++;
      }
      if (events.length > maxEvents) events = events.slice(-maxEvents);
      if (seen.size > 100000) for (const [k, t] of seen) if (now - t > dedupeMs) seen.delete(k);
      return n;
    },
    counts(now = Date.now()) {
      const m = new Map();
      for (const [id, t] of events) if (now - t < windowMs) m.set(id, (m.get(id) || 0) + 1);
      return m;
    },
    toJSON() { return events; },
    load(list) { if (Array.isArray(list)) events = list.filter((e) => Array.isArray(e) && e.length === 2).slice(-maxEvents); },
  };
}
