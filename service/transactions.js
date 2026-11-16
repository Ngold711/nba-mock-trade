// Transactions: ESPN's feed merged with NBA.com's official player-movement JSON, newest first. ESPN can lag a
// day or two behind (its feed sometimes stops for days), so NBA.com fills the gap when it's reachable. Pure parse +
// merge functions; the loader in espn.js does the fetching. Each source's newest entry is reported so the UI can
// say how current the list is instead of silently looking frozen.
export const NBA_MOVEMENT_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json";
// RealGM's Wiretap RSS (a syndication feed; reachable from cloud hosts where NBA.com's CDN blocks them)
export const REALGM_RSS_URL = "https://basketball.realgm.com/rss/wiretap/0/0.xml";

/* ---------- RealGM Wiretap RSS ---------- */
const NICK = [["Trail Blazers", "POR"], ["Blazers", "POR"], ["Timberwolves", "MIN"], ["Wolves", "MIN"], ["76ers", "PHI"], ["Sixers", "PHI"], ["Cavaliers", "CLE"], ["Cavs", "CLE"],
  ["Mavericks", "DAL"], ["Mavs", "DAL"], ["Hawks", "ATL"], ["Celtics", "BOS"], ["Nets", "BKN"], ["Hornets", "CHA"], ["Bulls", "CHI"], ["Nuggets", "DEN"], ["Pistons", "DET"],
  ["Warriors", "GS"], ["Rockets", "HOU"], ["Pacers", "IND"], ["Clippers", "LAC"], ["Lakers", "LAL"], ["Grizzlies", "MEM"], ["Heat", "MIA"], ["Bucks", "MIL"], ["Pelicans", "NO"],
  ["Knicks", "NY"], ["Thunder", "OKC"], ["Magic", "ORL"], ["Suns", "PHX"], ["Kings", "SAC"], ["Spurs", "SA"], ["Raptors", "TOR"], ["Jazz", "UTAH"], ["Wizards", "WSH"]];
const MOVE_RE = /\b(sign(s|ed)?|re-sign(s|ed)?|waive(s|d)?|release(s|d)?|guarantee(s|d)?|trade(s|d)?|acquire(s|d)?|assign(s|ed)?|recall(s|ed)?|convert(s|ed)?|suspend(s|ed)?|exercise(s|d)?|decline(s|d)?|extension|extend(s|ed)?|claim(s|ed)?)\b/i;
const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#039": "'", nbsp: " " };
const decode = (x) => String(x || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#?\w+);/g, (m, e) => ENTITY[e] ?? (/^#\d+$/.test(e) ? String.fromCharCode(+e.slice(1)) : m)).replace(/<[^>]+>/g, "").trim();
const tag = (block, name) => decode((new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block) || [])[1]);

/** Speculation / reporting language: never an "official move". */
export const RUMOR_RE = new RegExp([
  "available in trades?", "open to trad(es|ing)", "working on (a )?trade", "tops? rival", "signals? no interest", "shopping", "explor(e|es|ing)",
  "\\binterest(ed)? in", "linked to", "\\brumou?rs?\\b", "\\bcould\\b", "expected to", "plans? to", "\\bwould\\b", "\\bmight\\b", "\\bmay\\b", "likely",
  "\\bin talks", "talks with", "\\bdiscuss(es|ed|ing)?\\b", "\\bconsider(s|ed|ing)?\\b", "\\bpursu(e|es|ing)\\b", "\\beye(s|ing)?\\b", "\\btarget(s|ing)?\\b", "\\bmonitor(s|ing)?\\b",
  "\\bnearing\\b", "close to", "\\bagree(s|d)? to", "\\bagreement\\b", "deal in place", "\\breport(s|ed|edly)?\\b", "\\bsources\\b", "\\bwants? to", "\\bseek(s|ing)?\\b", "\\binquir", "\\bintrigued\\b",
].join("|"), "i");

/** Trade chatter / speculation that never counts as a move, even from a top reporter. */
export const SPECULATION_RE = /\b(available in trades?|open to trad(es|ing)|working on (a )?trade|tops? rival|signals? no interest|shopping|explor(e|es|ing)|interest(ed)? in|linked to|rumou?rs?|could|expected to|plans? to|would|might|may|likely|in talks|talks with|discuss(es|ed|ing)?|consider(s|ed|ing)?|pursu(e|es|ing)|eye(s|ing)?|target(s|ing)?|monitor(s|ing)?|nearing|close to|deal in place|wants? to|seek(s|ing)?|inquir\w*|intrigued|market for|on the block|frontrunner)\b/i;
/** A reported agreement from a top insider ("Sources: X is signing…", "agreeing to a deal"). */
export const AGREED_RE = /\b(is|are) (signing|re-signing|trading|waiving|finalizing)\b|\bagree(s|d|ing)? (to|on) (a |an )?(?:[\w$,.'-]+ ){0,4}(deal|contract|extension|buyout|trade)|\bhas (signed|agreed)|\bfinaliz(e|es|ed|ing) (a |an )?(deal|contract|trade|extension)/i;
const INJURY_RE = /\b(injur\w*|miss(es|ed|ing)?|out (for|indefinitely)|ankle|knee|hamstring|calf|groin|shoulder|back|foot|wrist|concussion|sprain\w*|strain\w*|surgery|torn|tear|week-to-week|day-to-day|return(s|ed|ing)?|questionable|doubtful|ruled out|lineup|starting|bench(ed)?|minutes restriction)\b/i;
const TRADE_TALK_RE = /\b(trade|traded|deal|offer|bid|free agen\w*|market|interest|available|target|pursu\w*|suitors?)\b/i;
const INSIDERS = [["Shams Charania", /shams/i], ["Brian Windhorst", /windhorst/i], ["Bobby Marks", /bobby marks/i], ["Adrian Wojnarowski", /wojnarowski/i]];
/** "Per Shams Charania" when an insider broke it, else "Per <outlet>". */
export function attributionFor(byline = "", text = "", fallback = "ESPN") {
  const who = INSIDERS.find(([, re]) => re.test(byline)) || INSIDERS.find(([, re]) => re.test(text) && /\bsources?\b|reported|per\b|told/i.test(text));
  return `Per ${who ? who[0] : fallback}`;
}
/**
 * One classifier for every news source. "move": a completed move (move verb, no speculation, no reporting hedges),
 * or (insider sources only) a reported agreement ("is signing", "agreed to a deal"). "rumor": everything else —
 * kind "rumor" for trade chatter, "news" for injuries, lineups, coaching and other league reports.
 */
export function classifyNews(text, { insider = false } = {}) {
  const t = String(text || "");
  const speculative = SPECULATION_RE.test(t);
  if (insider && AGREED_RE.test(t) && !speculative) return { category: "move", kind: "agreed" };
  if (MOVE_RE.test(t) && !RUMOR_RE.test(t)) return { category: "move", kind: transactionKind(t) };
  if (INJURY_RE.test(t) && !TRADE_TALK_RE.test(t)) return { category: "rumor", kind: "news" };     // injury timelines, lineups
  return { category: "rumor", kind: TRADE_TALK_RE.test(t) || speculative ? "rumor" : "news" };
}
const teamFrom = (text, teamsByAbbr) => {
  const hit = NICK.find(([n]) => new RegExp(`\\b${n}\\b`).test(text));
  if (!hit) return null;
  const abbr = hit[1];
  return teamsByAbbr[abbr] || { id: "", abbr, name: abbr, displayName: abbr, logo: `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png` };
};
const iso = (t) => new Date(t).toISOString().replace(/:\d\d\.\d+Z$/, "Z");

/* ---------- ESPN NBA news (site API) ---------- */
const ESPN_NEWS_TYPES = /^(Story|HeadlineNews|Blog|Rumor)$/i;
/** Not news: fantasy/betting columns, other sports, quizzes and listicles. */
const FLUFF_RE = /\b(fantasy|bets?|betting|odds|parlay|picks to make|best bets|USMNT|soccer|NFL|MLB|NHL|WNBA draft|golf|quiz)\b|^(which|what|who|why|how)\b.*\?$/i;
/**
 * ESPN NBA news → rows (stories and headline news only: no game recaps, previews or highlight videos; last 3 days).
 * teamsById: ESPN team id → team object.
 */
export function espnNewsItems(news = [], teamsById = {}, teamsByAbbr = {}, { now = Date.now(), maxAgeH = 72 } = {}) {
  const out = [];
  for (const n of news || []) {
    if (n.type && !ESPN_NEWS_TYPES.test(n.type)) continue;
    const t = Date.parse(n.published || ""); if (!Number.isFinite(t) || now - t > maxAgeH * 3600e3) continue;
    if (FLUFF_RE.test(n.headline || "")) continue;
    const text = `${n.headline} ${n.description || ""}`;
    const team = teamsById[n.teamIds?.[0]] || teamFrom(n.headline, teamsByAbbr) || { id: "", abbr: "NBA", name: "NBA", displayName: "NBA", logo: null };
    const attribution = attributionFor(n.byline, text, "ESPN");
    const insider = /Shams|Windhorst|Bobby Marks|Wojnarowski/.test(attribution) || /\bsources?\b/i.test(text);
    out.push({ date: iso(t), description: /[.!?]$/.test(n.headline) ? n.headline : `${n.headline}.`, detail: n.description || "",
      ...classifyNews(text, { insider }), team, source: "espnNews", sourceAttribution: attribution, url: n.url || "" });
  }
  return out;
}

/* ---------- Shams Charania breaking feed (any RSS: Google News search by default, or SHAMS_RSS_URL) ---------- */
export const SHAMS_RSS_URL = "https://news.google.com/rss/search?q=%22Shams+Charania%22+NBA+when:3d&hl=en-US&gl=US&ceid=US:en";
/** Shams RSS items → rows. Google News titles end in " - Outlet"; that outlet is kept for the attribution. */
export function shamsItems(items = [], teamsByAbbr = {}, { now = Date.now(), maxAgeH = 72 } = {}) {
  const out = [];
  for (const it of items || []) {
    const raw = it.title || ""; if (!raw) continue;
    const m = /^(.*?)\s+-\s+([^-]{2,40})$/.exec(raw);
    const title = (m ? m[1] : raw).replace(/^(BREAKING|Sources?|Shams)\s*:\s*/i, (x) => (/sources?/i.test(x) ? x : "")).trim();
    const outlet = m ? m[2].trim() : "";
    const t = Date.parse(it.pubDate || ""); if (!Number.isFinite(t) || now - t > maxAgeH * 3600e3) continue;
    const team = teamFrom(title, teamsByAbbr);
    if (!team && !/\bNBA\b/.test(`${title} ${it.description || ""}`)) continue;          // NBA stories only
    if (FLUFF_RE.test(title)) continue;
    out.push({ date: iso(t), description: /[.!?]$/.test(title) ? title : `${title}.`, ...classifyNews(title, { insider: true }),
      team: team || { id: "", abbr: "NBA", name: "NBA", displayName: "NBA", logo: null }, source: "shams",
      sourceAttribution: `Per Shams Charania${outlet && !/shams/i.test(outlet) ? ` (via ${outlet})` : ""}`, url: it.link || "" });
  }
  return out;
}

/** RSS 2.0 → [{ title, link, pubDate, description }] */
export function parseRss(xml) {
  return [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => ({ title: tag(m[0], "title"), link: tag(m[0], "link"), pubDate: tag(m[0], "pubDate"), description: tag(m[0], "description") }));
}
/**
 * RealGM Wiretap → rows. Only NBA items (a team name in the headline). A headline is an official "move" when it
 * reports a completed transaction (move verb) with no speculation language; everything else is "rumor"
 * (trade talk, interest, availability) or "news" (other league reports).
 */
export function realgmTransactions(items, teamsByAbbr = {}, { limit = 80 } = {}) {
  const out = [];
  for (const it of items || []) {
    const title = it.title || "";
    const hit = NICK.find(([n]) => new RegExp(`\\b${n}\\b`).test(title));
    if (!hit) continue;
    const t = Date.parse(it.pubDate || ""); if (!Number.isFinite(t)) continue;
    const abbr = hit[1];
    const team = teamsByAbbr[abbr] || { id: "", abbr, name: abbr, displayName: abbr, logo: `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png` };
    out.push({ date: iso(t), description: /[.!?]$/.test(title) ? title : `${title}.`, ...classifyNews(title), team, source: "realgm",
      sourceAttribution: attributionFor("", title, "RealGM"), url: it.link || "" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// NBA.com team ids → ESPN abbreviations
const NBA_TEAM = { 1610612737: "ATL", 1610612738: "BOS", 1610612739: "CLE", 1610612740: "NO", 1610612741: "CHI", 1610612742: "DAL", 1610612743: "DEN",
  1610612744: "GS", 1610612745: "HOU", 1610612746: "LAC", 1610612747: "LAL", 1610612748: "MIA", 1610612749: "MIL", 1610612750: "MIN", 1610612751: "BKN",
  1610612752: "NY", 1610612753: "ORL", 1610612754: "IND", 1610612755: "PHI", 1610612756: "PHX", 1610612757: "POR", 1610612758: "SAC", 1610612759: "SA",
  1610612760: "OKC", 1610612761: "TOR", 1610612762: "UTAH", 1610612763: "MEM", 1610612764: "WSH", 1610612765: "DET", 1610612766: "CHA" };

export function transactionKind(desc) {
  const d = String(desc || "").toLowerCase();
  if (/\btrade|acquired\b/.test(d)) return "trade";
  if (/\bwaive|released?\b/.test(d)) return "release";
  if (/\bguarantee|exercised|declined .*option|picked up .*option|extension|extended\b/.test(d)) return "contract";
  if (/\b(re-)?sign(s|ed)?\b|\bconvert(s|ed)?\b/.test(d)) return "signing";
  if (/\bassign(s|ed)?\b|\brecall(s|ed)?\b/.test(d)) return "assignment";
  if (/\bsuspend/.test(d)) return "suspension";
  return "other";
}

/** NBA.com player movement → the same shape as normalizeTransactions(). teamsByAbbr: ESPN team objects. */
export function normalizeNbaMovement(json, teamsByAbbr = {}, { limit = 120 } = {}) {
  const rows = json?.NBA_Player_Movement?.rows || json?.rows || [];
  return rows.map((r) => {
    const abbr = NBA_TEAM[Number(r.TEAM_ID)] || "";
    const t = teamsByAbbr[abbr] || { id: "", abbr, name: abbr, displayName: abbr, logo: abbr ? `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png` : null };
    const description = String(r.TRANSACTION_DESCRIPTION || "").trim();
    const day = String(r.TRANSACTION_DATE || "").slice(0, 10);
    return { date: day ? `${day}T08:00Z` : "", description, kind: transactionKind(`${r.Transaction_Type || ""} ${description}`), team: t, source: "nba" };
  }).filter((t) => t.description && t.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

const STOP = new Set(["the", "and", "for", "with", "his", "from", "contract", "deal", "team"]);
const stem = (w) => w.replace(/'s$/, "").replace(/(ing|ed|es|s|d)$/, "");
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
/** Same team, dates within a day, mostly the same words → the same move reported by two sources. */
function same(a, b) {
  if ((a.team?.abbr || "") !== (b.team?.abbr || "") || Math.abs(Date.parse(a.date) - Date.parse(b.date)) > 36 * 3600e3) return false;
  const A = words(a.description), B = words(b.description);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter >= 2 && inter / Math.max(1, Math.min(A.size, B.size)) >= 0.5;
}

/**
 * Merge sources, newest first. Official logs (ESPN, NBA.com) are always category "move"; RealGM rows carry their
 * own move/rumor category. Moves are de-duplicated across sources (the earlier list's wording wins: ESPN, NBA.com,
 * RealGM); rumors only against identical headlines. Up to 60 moves + 40 rumors.
 */
export function mergeTransactions(espn = [], ...others) {
  const ATTR = { espn: "Per ESPN", nba: "Per NBA.com", realgm: "Per RealGM", espnNews: "Per ESPN", shams: "Per Shams Charania" };
  const withAttr = (t) => ({ ...t, sourceAttribution: t.sourceAttribution || ATTR[t.source] || "" });
  const moves = [...espn.map((t) => withAttr({ ...t, source: t.source || "espn", category: "move" }))];
  const rumors = [];
  for (const list of others) for (const t0 of list || []) {
    const t = withAttr({ ...t0, category: t0.category || "move" });
    // the same story from several outlets appears once (first source wins: logs, ESPN, Shams, RealGM)
    if (t.category === "rumor") { if (!rumors.some((x) => x.description === t.description || same(x, t)) && !moves.some((x) => same(x, t))) rumors.push(t); }
    else if (!moves.some((x) => same(x, t))) { moves.push(t); for (let i = rumors.length - 1; i >= 0; i--) if (same(rumors[i], t)) rumors.splice(i, 1); }
  }
  const byDate = (a, b) => b.date.localeCompare(a.date);
  return [...moves.sort(byDate).slice(0, 60), ...rumors.sort(byDate).slice(0, 40)].sort(byDate);
}
export const newest = (list) => list.reduce((m, t) => (t.date > m ? t.date : m), "");
