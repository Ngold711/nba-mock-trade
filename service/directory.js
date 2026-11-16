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

/** Build the directory from live league rosters and the legends archive. */
export function buildDirectory({ league = null, legends = [] } = {}) {
  const byId = new Map();
  for (const p of league?.players || []) {
    if (!p?.id || !p.name) continue;
    byId.set(String(p.id), { id: String(p.id), name: p.name, active: true, team: CODE[p.teamAbbr] || p.teamAbbr || "", pos: p.position || "",
      years: "", headshot: p.headshot || `https://a.espncdn.com/i/headshots/nba/players/full/${p.id}.png` });
  }
  const seenNames = new Set([...byId.values()].map((p) => fold(p.name).toLowerCase()));
  for (const l of legends) {
    const id = String(l.id);
    const k = fold(l.name).toLowerCase();
    if (byId.has(id)) { const a = byId.get(id); a.pos ||= l.position || ""; continue; }       // active: roster entry wins
    if (seenNames.has(k)) continue;                                                            // same person twice in the archive
    seenNames.add(k);
    byId.set(id, { id, name: l.name, active: !!l.active, team: "", pos: l.position || "",
      years: l.from && l.to ? `${l.from}–${l.active ? "now" : l.to}` : "", headshot: l.headshot || null });
  }
  return [...byId.values()].map((p) => {
    if (/^(NA|N\/A|-)$/i.test(p.pos)) p.pos = "";                 // ESPN's "no position" placeholder
    const key = sortKey(p.name);
    return { ...p, key, letter: /^[a-z]/.test(key) ? key[0].toUpperCase() : "#", g: posGroups(p.pos), hof: HOF.has(p.name), top75: TOP75.has(p.name) };
  }).sort((a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name));
}

/** Filter by one of all | active | hof | top75 | G | F | C. */
export function filterDirectory(list, filter = "all") {
  switch (filter) {
    case "active": return list.filter((p) => p.active);
    case "hof": return list.filter((p) => p.hof);
    case "top75": return list.filter((p) => p.top75);
    case "G": case "F": case "C": return list.filter((p) => p.g.includes(filter));
    default: return list;
  }
}
