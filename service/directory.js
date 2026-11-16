// Unified A–Z player directory for the Archive: every active player (live ESPN rosters) plus every legend in
// nba_history.json, one list sorted by last name, with filter flags (active, Hall of Fame, NBA 75th Anniversary
// Team, position group). Pure: the server feeds it league + history and caches the result.

/** NBA 75th Anniversary Team (2021; 76 players because of a tie in the voting). */
export const TOP75 = new Set(["Kareem Abdul-Jabbar", "Ray Allen", "Giannis Antetokounmpo", "Carmelo Anthony", "Nate Archibald", "Paul Arizin", "Charles Barkley",
  "Rick Barry", "Elgin Baylor", "Dave Bing", "Larry Bird", "Kobe Bryant", "Wilt Chamberlain", "Bob Cousy", "Dave Cowens", "Billy Cunningham", "Stephen Curry",
  "Anthony Davis", "Dave DeBusschere", "Clyde Drexler", "Tim Duncan", "Kevin Durant", "Julius Erving", "Patrick Ewing", "Walt Frazier", "Kevin Garnett",
  "George Gervin", "Hal Greer", "James Harden", "John Havlicek", "Elvin Hayes", "Allen Iverson", "LeBron James", "Magic Johnson", "Sam Jones", "Michael Jordan",
  "Jason Kidd", "Kawhi Leonard", "Damian Lillard", "Jerry Lucas", "Karl Malone", "Moses Malone", "Pete Maravich", "Bob McAdoo", "Kevin McHale", "George Mikan",
  "Reggie Miller", "Earl Monroe", "Steve Nash", "Dirk Nowitzki", "Shaquille O'Neal", "Hakeem Olajuwon", "Robert Parish", "Chris Paul", "Gary Payton", "Bob Pettit",
  "Paul Pierce", "Scottie Pippen", "Willis Reed", "Oscar Robertson", "David Robinson", "Dennis Rodman", "Bill Russell", "Dolph Schayes", "Bill Sharman",
  "John Stockton", "Isiah Thomas", "Nate Thurmond", "Wes Unseld", "Dwyane Wade", "Bill Walton", "Jerry West", "Russell Westbrook", "Lenny Wilkens",
  "Dominique Wilkins", "James Worthy"]);

/** Naismith Hall of Fame, inducted as players (covers the players in the Hooptrax archive). */
export const HOF = new Set(["Kareem Abdul-Jabbar", "Ray Allen", "Carmelo Anthony", "Nate Archibald", "Charles Barkley", "Rick Barry", "Elgin Baylor", "Walt Bellamy",
  "Chauncey Billups", "Dave Bing", "Larry Bird", "Chris Bosh", "Kobe Bryant", "Vince Carter", "Wilt Chamberlain", "Maurice Cheeks", "Bob Cousy", "Dave Cowens",
  "Adrian Dantley", "Dave DeBusschere", "Vlade Divac", "Clyde Drexler", "Joe Dumars", "Tim Duncan", "Alex English", "Julius Erving", "Patrick Ewing",
  "Kevin Garnett", "Pau Gasol", "George Gervin", "Manu Ginobili", "Hal Greer", "Tim Hardaway", "John Havlicek", "Elvin Hayes", "Grant Hill", "Dwight Howard",
  "Allen Iverson", "Dennis Johnson", "Magic Johnson", "Michael Jordan", "Jason Kidd", "Bernard King", "Toni Kukoc", "Bob Lanier", "Jerry Lucas", "Karl Malone",
  "Moses Malone", "Pete Maravich", "Bob McAdoo", "Tracy McGrady", "Kevin McHale", "Reggie Miller", "Yao Ming", "Sidney Moncrief", "Earl Monroe", "Alonzo Mourning",
  "Chris Mullin", "Dikembe Mutombo", "Steve Nash", "Dirk Nowitzki", "Shaquille O'Neal", "Hakeem Olajuwon", "Robert Parish", "Tony Parker", "Gary Payton",
  "Bob Pettit", "Paul Pierce", "Scottie Pippen", "Willis Reed", "Mitch Richmond", "Oscar Robertson", "David Robinson", "Guy Rodgers", "Dennis Rodman",
  "Bill Russell", "Dolph Schayes", "Jack Sikma", "John Stockton", "Isiah Thomas", "Nate Thurmond", "Wes Unseld", "Dwyane Wade", "Ben Wallace", "Bill Walton",
  "Chris Webber", "Jerry West", "Lenny Wilkens", "Dominique Wilkins", "James Worthy"]);

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Sort key "lastname firstname" (suffixes like Jr./III ignored), accent-folded. */
export function sortKey(name) {
  const parts = fold(name).trim().split(/\s+/);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  const last = parts.length > 1 ? parts.pop() : parts[0];
  return `${last} ${parts.join(" ")}`.toLowerCase().replace(/[^a-z0-9 ]+/g, "");
}
/** Position groups from ESPN position strings ("PG", "SF", "G-F", "F-C", "C"). */
export function posGroups(pos) {
  const p = String(pos || "").toUpperCase();
  const out = new Set();
  if (/G/.test(p)) out.add("G");
  if (/F/.test(p)) out.add("F");
  if (/C/.test(p)) out.add("C");
  return [...out];
}
const CODE = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };

/** Name key that survives suffixes and punctuation: "Jimmy Butler III" = "Jimmy Butler", "AJ Green" = "A.J. Green". */
export function matchKey(name) {
  const parts = fold(name).toLowerCase().replace(/[.'’]/g, "").split(/[\s-]+/).filter(Boolean);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  const k = parts.join("");
  return ALIAS[k] || k;
}
const ALIAS = { ronaldholland: "ronholland" };      // roster name → historical index name
/** Rows of all_players.json → objects. */
export function indexRows(all) {
  const f = all?.fields || ["id", "name", "pos", "g", "from", "to", "lg", "hof", "top75", "nba", "espn"];
  return (all?.players || []).map((r) => Object.fromEntries(f.map((k, i) => [k, r[i]])));
}
const nbaHead = (id) => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`;
const espnHead = (id) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;

/**
 * The full directory: every NBA/ABA/BAA player from all_players.json, with live ESPN rosters merged in (active
 * status, team, ESPN id) and the legends archive's ESPN ids for profiles. Falls back to legends only when the
 * index isn't available.
 */
export function buildDirectory({ league = null, legends = [], all = null } = {}) {
  const rows = indexRows(all);
  const out = [];
  const byName = new Map();             // matchKey → [entries]
  const add = (e) => { out.push(e); const k = matchKey(e.name); byName.set(k, [...(byName.get(k) || []), e]); return e; };
  for (const r of rows) {
    add({ id: r.espn ? String(r.espn) : `h:${r.id}`, bref: r.id, name: r.name, active: false, team: "", pos: r.pos || r.g.split("").join("-"), g: r.g.split(""),
      from: r.from, to: r.to, years: r.from && r.to ? `${r.from}–${r.to}` : "", lg: r.lg || "NBA", hof: !!r.hof, hofRole: r.hof || "", top75: !!r.top75,
      headshot: r.nba ? nbaHead(r.nba) : r.espn ? espnHead(r.espn) : null, alt: r.espn && r.nba ? espnHead(r.espn) : null });
  }
  const pickRecent = (list) => [...list].sort((a, b) => (b.to || 0) - (a.to || 0))[0];
  // legends archive: attach ESPN / archive ids so their profiles open (by name; the most recent namesake wins)
  for (const l of legends) {
    const hit = byName.get(matchKey(l.name));
    if (hit) { const e = hit.length === 1 ? hit[0] : hit.find((x) => l.from && Math.abs((x.from || 0) - l.from) <= 1) || null; if (e && e.id.startsWith("h:")) { e.id = String(l.id); e.headshot ||= l.headshot || null; } }
    else if (!rows.length) add({ id: String(l.id), name: l.name, active: !!l.active, team: "", pos: l.position || "", g: posGroups(l.position), from: l.from, to: l.to,
      years: l.from && l.to ? `${l.from}–${l.to}` : "", lg: "NBA", hof: HOF.has(l.name), hofRole: HOF.has(l.name) ? "player" : "", top75: TOP75.has(l.name), headshot: l.headshot || null });
  }
  // live rosters: active status, team, ESPN id and headshot
  for (const p of league?.players || []) {
    if (!p?.id || !p.name) continue;
    const hit = byName.get(matchKey(p.name));
    const e = hit ? (hit.length === 1 ? hit[0] : pickRecent(hit)) : add({ id: String(p.id), name: p.name, pos: p.position || "", g: posGroups(p.position), from: 2026, to: 2027,
      years: "", lg: "NBA", hof: false, hofRole: "", top75: false, headshot: null });
    Object.assign(e, { id: String(p.id), name: p.name, active: true, team: CODE[p.teamAbbr] || p.teamAbbr || "", alt: e.headshot && !/espncdn/.test(e.headshot) ? espnHead(p.id) : null });
    e.headshot = e.headshot || p.headshot || espnHead(p.id);
    if (!e.g.length) e.g = posGroups(p.position);
    if (!e.pos) e.pos = p.position || "";
  }
  return out.map((p) => {
    if (/^(NA|N\/A|-)$/i.test(p.pos)) p.pos = p.g.join("-");
    if (!p.g.length) p.g = posGroups(p.pos);
    if (!p.years && p.active) p.years = "";
    const key = sortKey(p.name);
    return { ...p, key, letter: /^[a-z]/.test(key) ? key[0].toUpperCase() : "#" };
  }).sort((a, b) => a.key.localeCompare(b.key) || (a.from || 0) - (b.from || 0));
}

/** Filter by one of all | active | hof | top75 | G | F | C, and an optional name query. */
export function filterDirectory(list, filter = "all", q = "") {
  let out;
  switch (filter) {
    case "active": out = list.filter((p) => p.active); break;
    case "hof": out = list.filter((p) => p.hof); break;
    case "top75": out = list.filter((p) => p.top75); break;
    case "G": case "F": case "C": out = list.filter((p) => p.g.includes(filter)); break;
    default: out = list;
  }
  const k = fold(q).toLowerCase().trim();
  if (k.length >= 2) out = out.filter((p) => fold(p.name).toLowerCase().includes(k));
  return out;
}
