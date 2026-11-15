// Wikipedia fallback for the Archive search: when someone looks up a coach, executive or owner the people
// archive doesn't cover, ask Wikipedia's public REST search and return short bio cards (description,
// summary, teams named in the summary, span of years, championship line). Everything shown is quoted or
// derived from the Wikipedia summary and labelled as such; nothing is invented.
const UA = "Hooptrax/1.0 (NBA encyclopedia; server-side lookup)";
const SEARCH = (q) => `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(`${q} NBA`)}&limit=6`;
const SUMMARY = (t) => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, "_"))}`;

const TEAMS = {
  ATL: ["Atlanta Hawks", "St. Louis Hawks", "Milwaukee Hawks", "Tri-Cities Blackhawks"], BOS: ["Boston Celtics"], BKN: ["Brooklyn Nets", "New Jersey Nets"],
  CHA: ["Charlotte Hornets", "Charlotte Bobcats"], CHI: ["Chicago Bulls"], CLE: ["Cleveland Cavaliers"], DAL: ["Dallas Mavericks"], DEN: ["Denver Nuggets"],
  DET: ["Detroit Pistons", "Fort Wayne Pistons"], GSW: ["Golden State Warriors", "San Francisco Warriors", "Philadelphia Warriors"], HOU: ["Houston Rockets", "San Diego Rockets"],
  IND: ["Indiana Pacers"], LAC: ["Los Angeles Clippers", "San Diego Clippers", "Buffalo Braves"], LAL: ["Los Angeles Lakers", "Minneapolis Lakers"], MEM: ["Memphis Grizzlies", "Vancouver Grizzlies"],
  MIA: ["Miami Heat"], MIL: ["Milwaukee Bucks"], MIN: ["Minnesota Timberwolves"], NOP: ["New Orleans Pelicans", "New Orleans Hornets"], NYK: ["New York Knicks"],
  OKC: ["Oklahoma City Thunder", "Seattle SuperSonics"], ORL: ["Orlando Magic"], PHI: ["Philadelphia 76ers", "Syracuse Nationals"], PHX: ["Phoenix Suns"],
  POR: ["Portland Trail Blazers"], SAC: ["Sacramento Kings", "Kansas City Kings", "Cincinnati Royals", "Rochester Royals"], SAS: ["San Antonio Spurs"],
  TOR: ["Toronto Raptors"], UTA: ["Utah Jazz", "New Orleans Jazz"], WAS: ["Washington Wizards", "Washington Bullets", "Capital Bullets", "Baltimore Bullets"],
};
const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").trim();
const NBA = /\b(NBA|basketball|National Basketball Association)\b/i;

/** Which archive role a Wikipedia description/summary reads as. */
export function roleOf(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(owner|governor|businessman|businesswoman|investor|billionaire|entrepreneur)\b/.test(t)) return "owner";
  if (/\b(general manager|executive|president of basketball|front office)\b/.test(t)) return "exec";
  if (/\bcoach\b/.test(t)) return "coach";
  if (/\bplayer\b/.test(t)) return "player";
  return null;
}
/** Facts read straight out of the summary text: teams it names, the span of years it mentions, its championship sentence. */
export function factsFrom(extract) {
  const x = String(extract || "");
  const teams = Object.entries(TEAMS).filter(([, names]) => names.some((n) => x.includes(n))).map(([code, names]) => ({ code, name: names.find((n) => x.includes(n)) }));
  const years = (x.match(/\b(19[4-9]\d|20[0-2]\d)\b/g) || []).map(Number);
  const span = years.length ? (Math.min(...years) === Math.max(...years) ? `${years[0]}` : `${Math.min(...years)}–${Math.max(...years)}`) : "";
  const titles = x.split(/(?<=[.!?])\s+/).filter((s) => /\b(championships?|champions?|titles?)\b/i.test(s) && NBA.test(s)).slice(0, 2).join(" ");
  return { teams, span, titles };
}
/** Turn a REST search payload + summaries into bio cards (NBA-related pages only). */
export function cardsFrom(search, summaries = {}) {
  return (search?.pages || []).map((p) => {
    const sum = summaries[p.key] || summaries[p.title] || null;
    const description = strip(sum?.description || p.description);
    const extract = strip(sum?.extract || p.excerpt);
    if (!NBA.test(`${description} ${extract}`)) return null;
    if (/^(List|Lists|Timeline|History) of\b|\b(season|draft|playoffs|finals|team|arena|league)$/i.test(strip(p.title))) return null;   // bios only
    const role = roleOf(description) || roleOf(extract);
    if (!role) return null;
    const url = sum?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.key || p.title).replace(/ /g, "_"))}`;
    return { kind: "wiki", id: `wiki:${p.key || p.title}`, name: strip(sum?.title || p.title), description, extract, role, url,
      thumb: sum?.thumbnail?.source || (p.thumbnail?.url ? (p.thumbnail.url.startsWith("//") ? `https:${p.thumbnail.url}` : p.thumbnail.url) : null),
      facts: factsFrom(extract), source: "Wikipedia" };
  }).filter(Boolean);
}

const cache = new Map();   // q → { at, cards }
/** Look up a name on Wikipedia. Never throws; [] on any failure. Results are cached for a day. */
export async function wikiLookup(q, { role = null, fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const key = String(q).toLowerCase().trim();
  const hit = cache.get(key);
  let cards = hit && Date.now() - hit.at < 864e5 ? hit.cards : null;
  if (!cards) {
    try {
      // browsers send their own User-Agent (and a custom one would force a CORS preflight); the server names itself honestly
      const headers = typeof window === "undefined" ? { "user-agent": UA, accept: "application/json" } : { accept: "application/json" };
      const get = async (url) => { const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error(`wikipedia ${r.status}`); return r.json(); };
      const search = await get(SEARCH(q));
      const pages = (search?.pages || []).slice(0, 5);
      const sums = {};
      await Promise.all(pages.map(async (p) => { try { sums[p.key] = await get(SUMMARY(p.key || p.title)); } catch { /* the search excerpt is enough */ } }));
      cards = cardsFrom({ pages }, sums);
      cache.set(key, { at: Date.now(), cards });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    } catch { return []; }   // 429 / offline / timeout: no cards (not cached, so the next search retries)
  }
  return role ? cards.filter((c) => c.role === role || (role === "exec" && c.role === "owner" && /executive|president/i.test(c.description))) : cards;
}
