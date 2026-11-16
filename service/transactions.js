// Transactions: ESPN's feed merged with NBA.com's official player-movement JSON, newest first. ESPN can lag a
// day or two behind (its feed sometimes stops for days), so NBA.com fills the gap when it's reachable. Pure parse +
// merge functions; the loader in espn.js does the fetching. Each source's newest entry is reported so the UI can
// say how current the list is instead of silently looking frozen.
export const NBA_MOVEMENT_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json";

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
  if (/\bsigned|re-signed|converted\b/.test(d)) return "signing";
  if (/\bassigned|recalled\b/.test(d)) return "assignment";
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

const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 2));
/** Same day + same team + mostly the same words → the same move reported by both sources. */
function same(a, b) {
  if (a.date.slice(0, 10) !== b.date.slice(0, 10) || (a.team?.abbr || "") !== (b.team?.abbr || "")) return false;
  const A = words(a.description), B = words(b.description);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.6;
}

/** Merge ESPN + NBA.com lists, newest first, ESPN wording kept on duplicates. */
export function mergeTransactions(espn = [], nba = [], { limit = 60 } = {}) {
  const out = [...espn.map((t) => ({ ...t, source: t.source || "espn" }))];
  for (const t of nba) if (!out.some((x) => same(x, t))) out.push(t);
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
export const newest = (list) => list.reduce((m, t) => (t.date > m ? t.date : m), "");
