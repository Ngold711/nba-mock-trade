// Build all_players.json: every player in NBA, ABA and BAA history (one row per person), deduplicated.
//
// Sources (open data, fetched at build time and cached in scripts/.cache/):
//   • Basketball-Reference-derived career index: sumitrodatta/bball-reference-datasets
//     ("Player Career Info.csv": name, position, height, first/last season, Hall of Fame flag;
//      "Player Season Info.csv": league and position per season)
//   • NBA.com person ids for headshots: swar/nba_api static player index (data.py)
//   • ESPN athlete ids for profiles: nba_history.json legends (by name); active players are matched to the live
//     ESPN roster at request time by the server.
//
// Run:  node --experimental-strip-types scripts/sync-all-nba-players.ts   (Node ≥ 22.6; add --refresh to re-download)
// The live roster (team badges, live stats, active status) is merged in by the server; this file is the history.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const CACHE = new URL("./.cache/", import.meta.url);
const SRC = {
  career: "https://raw.githubusercontent.com/sumitrodatta/bball-reference-datasets/master/Data/Player%20Career%20Info.csv",
  seasons: "https://raw.githubusercontent.com/sumitrodatta/bball-reference-datasets/master/Data/Player%20Season%20Info.csv",
  nbaIndex: "https://raw.githubusercontent.com/swar/nba_api/master/src/nba_api/stats/library/data.py",
};

/** NBA 75th Anniversary Team (2021): 76 honorees because of a tie. Names as the career index spells them. */
const TOP75: string[] = ["Kareem Abdul-Jabbar", "Ray Allen", "Giannis Antetokounmpo", "Carmelo Anthony", "Tiny Archibald", "Paul Arizin", "Charles Barkley",
  "Rick Barry", "Elgin Baylor", "Dave Bing", "Larry Bird", "Kobe Bryant", "Wilt Chamberlain", "Bob Cousy", "Dave Cowens", "Billy Cunningham", "Stephen Curry",
  "Anthony Davis", "Dave DeBusschere", "Clyde Drexler", "Tim Duncan", "Kevin Durant", "Julius Erving", "Patrick Ewing", "Walt Frazier", "Kevin Garnett",
  "George Gervin", "Hal Greer", "James Harden", "John Havlicek", "Elvin Hayes", "Allen Iverson", "LeBron James", "Magic Johnson", "Sam Jones", "Michael Jordan",
  "Jason Kidd", "Kawhi Leonard", "Damian Lillard", "Jerry Lucas", "Karl Malone", "Moses Malone", "Pete Maravich", "Bob McAdoo", "Kevin McHale", "George Mikan",
  "Reggie Miller", "Earl Monroe", "Steve Nash", "Dirk Nowitzki", "Shaquille O'Neal", "Hakeem Olajuwon", "Robert Parish", "Chris Paul", "Gary Payton", "Bob Pettit",
  "Paul Pierce", "Scottie Pippen", "Willis Reed", "Oscar Robertson", "David Robinson", "Dennis Rodman", "Bill Russell", "Dolph Schayes", "Bill Sharman",
  "John Stockton", "Isiah Thomas", "Nate Thurmond", "Wes Unseld", "Dwyane Wade", "Bill Walton", "Jerry West", "Russell Westbrook", "Lenny Wilkens",
  "Dominique Wilkins", "James Worthy"];

/** Hall of Famers in the index who were inducted for coaching or as contributors, not as players. */
const HOF_ROLE: Record<string, "coach" | "contributor"> = {
  "Al McGuire": "coach", "Alex Hannum": "coach", "Billy Donovan": "coach", "Doc Rivers": "coach", "Don Nelson": "coach", "George Karl": "coach",
  "Jerry Sloan": "coach", "John Thompson": "coach", "Larry Brown": "coach", "Mike D'Antoni": "coach", "Pat Riley": "coach", "Phil Jackson": "coach",
  "Red Holzman": "coach", "Rick Adelman": "coach", "Rudy Tomjanovich": "coach", "Slick Leonard": "coach",
  "Al Attles": "contributor", "Chuck Cooper": "contributor", "Don Barksdale": "contributor", "Doug Collins": "contributor", "Earl Lloyd": "contributor",
  "Nat Clifton": "contributor", "Rod Thorn": "contributor", "Tom Sanders": "contributor", "Wayne Embry": "contributor",
};

type Row = Record<string, string>;
type Player = { id: string; name: string; pos: string; g: string; from: number | null; to: number | null; lg: string[];
  hof: "" | "player" | "coach" | "contributor"; top75: boolean; nba: number | null; espn: string | null; ht: number | null };

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function source(name: keyof typeof SRC): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(`./${name}.txt`, CACHE);
  if (existsSync(file) && !process.argv.includes("--refresh")) return readFileSync(file, "utf8");
  const r = await fetch(SRC[name], { headers: { "user-agent": "Hooptrax/1.0 (player index build)" } });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const text = await r.text();
  writeFileSync(file, text);
  return text;
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas). */
function csv(text: string): Row[] {
  const out: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); out.push(row); row = []; cur = ""; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  const [head, ...rest] = out.filter((r) => r.length > 1);
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** Position groups G / F / C from "G", "F-C", "C-F", "G-F"…; falls back to the most common season position, then height. */
function groups(pos: string, seasonPos: string[], heightIn: number | null): string {
  const pick = (p: string) => [..."GFC"].filter((x) => p.toUpperCase().includes(x)).join("");
  let g = pick(pos && pos !== "NA" ? pos : "");
  if (!g) {
    const counts = new Map<string, number>();
    for (const p of seasonPos) if (p && p !== "NA") counts.set(p, (counts.get(p) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    g = pick(top.replace(/PG|SG/g, "G").replace(/SF|PF/g, "F"));
  }
  if (!g && heightIn) g = heightIn >= 82 ? "C" : heightIn >= 78 ? "F" : "G";
  return g || "F";
}

const career = csv(await source("career"));
const seasons = csv(await source("seasons"));
const nbaPy = await source("nbaIndex");

const leagues = new Map<string, Set<string>>(), seasonPos = new Map<string, string[]>();
for (const s of seasons) {
  (leagues.get(s.player_id) || leagues.set(s.player_id, new Set()).get(s.player_id)!).add(s.lg);
  (seasonPos.get(s.player_id) || seasonPos.set(s.player_id, []).get(s.player_id)!).push(s.pos);
}

// NBA.com ids by folded full name (only names that are unique in both indexes)
const nbaRows = [...nbaPy.matchAll(/\[(\d+), "(?:[^"\\]|\\.)*", "(?:[^"\\]|\\.)*", "((?:[^"\\]|\\.)*)", (True|False)\]/g)].map((m) => ({ id: +m[1], name: m[2].replace(/\\"/g, '"') }));
const nbaBy = new Map<string, number[]>();
for (const r of nbaRows) { const k = fold(r.name); nbaBy.set(k, [...(nbaBy.get(k) || []), r.id]); }

// ESPN ids from the Hooptrax legends archive
const history = JSON.parse(readFileSync(new URL("nba_history.json", ROOT), "utf8"));
const espnBy = new Map<string, string>();
for (const l of history.legends || []) if (/^\d+$/.test(String(l.id))) espnBy.set(fold(l.name), String(l.id));

const nameCount = new Map<string, number>();
for (const r of career) nameCount.set(fold(r.player), (nameCount.get(fold(r.player)) || 0) + 1);

const top75 = new Set(TOP75.map(fold));
const seen = new Set<string>();
const players: Player[] = [];
for (const r of career) {
  if (!r.player_id || seen.has(r.player_id)) continue;
  seen.add(r.player_id);
  const k = fold(r.player), unique = nameCount.get(k) === 1;
  const ht = Number(r.ht_in_in) || null;
  const from = Number(r.from) || null, to = Number(r.to) || null;
  const nbaIds = nbaBy.get(k) || [];
  players.push({
    id: r.player_id, name: r.player, pos: r.pos === "NA" ? "" : r.pos, g: groups(r.pos, seasonPos.get(r.player_id) || [], ht),
    from: from ? from - 1 : null, to,                               // index years are season-end years: 1970 → the 1969–70 season
    lg: [...(leagues.get(r.player_id) || new Set(["NBA"]))].sort(),
    hof: r.hof === "TRUE" ? (HOF_ROLE[r.player] || "player") : "", top75: unique && top75.has(k),
    nba: unique && nbaIds.length === 1 ? nbaIds[0] : null, espn: unique ? espnBy.get(k) || null : null, ht,
  });
}

// Top 75 names shared by two players (Patrick Ewing Sr./Jr.): tag the Hall of Famer, else the longest career
for (const n of TOP75) {
  const same = players.filter((p) => fold(p.name) === fold(n));
  if (same.length > 1 && !same.some((p) => p.top75)) {
    same.sort((a, b) => (b.hof ? 1 : 0) - (a.hof ? 1 : 0) || ((b.to ?? 0) - (b.from ?? 0)) - ((a.to ?? 0) - (a.from ?? 0)));
    same[0].top75 = true;
  }
}
// checks
const t75 = players.filter((p) => p.top75);
const missing75 = TOP75.filter((n) => !t75.some((p) => fold(p.name) === fold(n)));
if (t75.length !== 76) throw new Error(`Top 75: ${t75.length} tagged; missing ${missing75.join(", ")}`);
const unknownRole = Object.keys(HOF_ROLE).filter((n) => !players.some((p) => p.name === n && p.hof === HOF_ROLE[n]));
if (unknownRole.length) throw new Error(`HOF role names not found: ${unknownRole.join(", ")}`);
if (players.some((p) => !/^[GFC]+$/.test(p.g))) throw new Error("player without a G/F/C group");

const out = {
  version: 1, builtAt: new Date().toISOString(),
  sources: [SRC.career, SRC.seasons, SRC.nbaIndex],
  note: "Every NBA, ABA and BAA player (Basketball-Reference-derived open dataset). Years are first season start – last season end. hof: inducted as player, or as coach/contributor for people who also played.",
  count: players.length,
  // compact rows: [id, name, pos, groups, from, to, leagues, hof, top75, nbaId, espnId]
  fields: ["id", "name", "pos", "g", "from", "to", "lg", "hof", "top75", "nba", "espn"],
  players: players.map((p) => [p.id, p.name, p.pos, p.g, p.from, p.to, p.lg.join("/"), p.hof, p.top75 ? 1 : 0, p.nba, p.espn]),
};
writeFileSync(new URL("all_players.json", ROOT), JSON.stringify(out));
const hof = players.filter((p) => p.hof);
console.log(`all_players.json: ${players.length} players | HOF ${hof.length} (${hof.filter((p) => p.hof === "player").length} as players) | Top 75 ${t75.length} | NBA.com ids ${players.filter((p) => p.nba).length} | ESPN ids ${players.filter((p) => p.espn).length} | ABA-only ${players.filter((p) => p.lg.join() === "ABA").length}`);
