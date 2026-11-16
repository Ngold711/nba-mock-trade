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

/** RSS 2.0 → [{ title, link, pubDate, description }] */
export function parseRss(xml) {
  return [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => ({ title: tag(m[0], "title"), link: tag(m[0], "link"), pubDate: tag(m[0], "pubDate"), description: tag(m[0], "description") }));
}
/** Wiretap items that are NBA transactions (a move verb + an NBA team in the headline) → transaction rows. */
export function realgmTransactions(items, teamsByAbbr = {}, { limit = 60 } = {}) {
  const out = [];
  for (const it of items || []) {
    const title = it.title || "";
    if (!MOVE_RE.test(title)) continue;
    const hit = NICK.find(([n]) => new RegExp(`\\b${n}\\b`).test(title));
    if (!hit) continue;
    const t = Date.parse(it.pubDate || ""); if (!Number.isFinite(t)) continue;
    const abbr = hit[1];
    const team = teamsByAbbr[abbr] || { id: "", abbr, name: abbr, displayName: abbr, logo: `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png` };
    out.push({ date: new Date(t).toISOString().replace(/:\d\d\.\d+Z$/, "Z"), description: /[.!?]$/.test(title) ? title : `${title}.`, kind: transactionKind(title), team, source: "realgm", url: it.link || "" });
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

/** Merge sources, newest first; on duplicates the earlier list's wording wins (ESPN, then NBA.com, then RealGM). */
export function mergeTransactions(espn = [], ...others) {
  const limit = 60;
  const out = [...espn.map((t) => ({ ...t, source: t.source || "espn" }))];
  for (const list of others) for (const t of list || []) if (!out.some((x) => same(x, t))) out.push(t);
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
export const newest = (list) => list.reduce((m, t) => (t.date > m ? t.date : m), "");
