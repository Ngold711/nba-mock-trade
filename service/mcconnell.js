// McConnell: a daily NBA player guessing game. Pure logic (no DOM), shared by the page and tests.

export const MAX_GUESSES = 8;
export const LAUNCH = "2026-11-14";            // game #1
export const COLUMNS = ["team", "conf", "div", "pos", "ht", "age", "num"];
// Title case on purpose so a division never reads like a team code (Atl ≠ ATL Hawks).
export const DIV_ABBR = { Atlantic: "Atl", Central: "Cen", Southeast: "SE", Northwest: "NW", Pacific: "Pac", Southwest: "SW" };

export const inches = (ht) => { const m = /(\d+)'\s*(\d+)/.exec(ht || ""); return m ? +m[1] * 12 + +m[2] : null; };
export const fmtHeight = (i) => (i == null ? "—" : `${Math.floor(i / 12)}'${i % 12}"`);

/**
 * ESPN rosters only say G / F / C. Hybrid positions come from the roster snapshot where it has one
 * (e.g. "G/F", "F/C"), otherwise from height: tall guards and small forwards are G-F, big forwards
 * and small centers are F-C.
 */
export function hybridPosition(espnPos, heightIn, snapshotPos) {
  const snap = String(snapshotPos || "").toUpperCase();
  if (/G\/F|G-F/.test(snap)) return "G-F";
  if (/F\/C|F-C/.test(snap)) return "F-C";
  const p = String(espnPos || "").toUpperCase().charAt(0);
  const h = heightIn || 0;
  if (p === "G") return h >= 78 ? "G-F" : "G";
  if (p === "F") return h && h <= 78 ? "G-F" : h >= 82 ? "F-C" : "F";
  if (p === "C") return h && h <= 81 ? "F-C" : "C";
  return p || "—";
}

export const FIVE = ["PG", "SG", "SF", "PF", "C"];
/** Normalize a league roster player into the fields the game compares. resolvedPos: the site-wide PG/SG/SF/PF/C
 *  from service/lineups.js (/api/positions); the G / G-F / F / F-C / C hybrid is only a fallback. */
export function toGamePlayer(a, snapshotPos, resolvedPos = null) {
  const h = inches(a.height);
  const num = /^\d+$/.test(String(a.jersey || "")) ? +a.jersey : null;
  return {
    id: String(a.id), name: a.name, initials: a.initials, headshot: a.headshot, headshotSmall: a.headshotSmall,
    team: a.teamAbbr, teamId: a.teamId, conf: a.conference, div: a.division,
    pos: FIVE.includes(resolvedPos) ? resolvedPos : hybridPosition(a.position, h, snapshotPos), ht: h, age: a.age ?? null, num,
  };
}

const numeric = (g, m, close) => {
  if (g == null || m == null) return { state: "gray", arrow: "" };
  if (g === m) return { state: "green", arrow: "" };
  return { state: Math.abs(g - m) <= close ? "yellow" : "gray", arrow: m > g ? "↑" : "↓" };
};
const letters = (p) => new Set(String(p).split("-").filter(Boolean));

/** Compare a guess with the mystery player, column by column. */
export function compare(guess, mystery) {
  const eq = (k) => ({ state: guess[k] && guess[k] === mystery[k] ? "green" : "gray", arrow: "" });
  let pos;
  if (guess.pos === mystery.pos) pos = { state: "green", arrow: "" };
  else if (FIVE.includes(guess.pos) && FIVE.includes(mystery.pos)) pos = { state: Math.abs(FIVE.indexOf(guess.pos) - FIVE.indexOf(mystery.pos)) === 1 ? "yellow" : "gray", arrow: "" };   // neighbouring slot
  else { const a = letters(guess.pos), b = letters(mystery.pos); pos = { state: [...a].some((x) => b.has(x)) ? "yellow" : "gray", arrow: "" }; }
  return {
    team: eq("team"), conf: eq("conf"), div: eq("div"), pos,
    ht: numeric(guess.ht, mystery.ht, 2),
    age: numeric(guess.age, mystery.age, 2),
    num: numeric(guess.num, mystery.num, 2),
    correct: guess.id === mystery.id,
  };
}

/* ---------- daily puzzle ---------- */
/** The puzzle date in US Eastern time, so everyone gets the same mystery player and it rotates at midnight ET. */
export function dayKey(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** Milliseconds until the next midnight US Eastern (the next puzzle). */
export function msUntilNextPuzzle(now = new Date()) {
  const today = dayKey(now);
  let lo = now.getTime(), hi = lo + 26 * 3600e3;            // binary search for the instant the ET date changes (DST-safe)
  while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (dayKey(new Date(mid)) === today) lo = mid; else hi = mid; }
  return hi - now.getTime();
}
export function gameNumber(key = dayKey()) {
  const [y, m, d] = key.split("-").map(Number);
  const [y0, m0, d0] = LAUNCH.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y0, m0 - 1, d0)) / 86400000) + 1;
}
function fnv1a(str) { let h = 0x811c9dc5; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
/** Same mystery for everyone on a date: hash of the date into the pool sorted by ESPN id. */
export function dailyMystery(pool, key = dayKey()) {
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.length ? sorted[fnv1a(`mcconnell:${key}`) % sorted.length] : null;
}

/* ---------- stats + sharing ---------- */
export function emptyStats() { return { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: Array(MAX_GUESSES).fill(0), lastGame: null }; }
export function recordResult(stats, game, won, guesses) {
  const s = { ...emptyStats(), ...stats, dist: [...(stats?.dist || emptyStats().dist)] };
  if (s.lastGame === game) return s;                      // already recorded
  s.played++;
  if (won) {
    s.wins++; s.dist[guesses - 1]++;
    s.streak = s.lastGame === game - 1 ? s.streak + 1 : 1;   // consecutive days only
  } else s.streak = 0;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.lastGame = game;
  return s;
}
const SQUARE = { green: "🟩", yellow: "🟨", gray: "⬛" };
export function shareText({ results, won, game = null, url = "" }) {
  const head = `McConnell ${game != null ? `#${game} ` : "Unlimited "}${won ? results.length : "X"}/${MAX_GUESSES}`;
  const rows = results.map((r) => COLUMNS.map((k) => SQUARE[r[k].state]).join(""));
  return [head, ...rows, url].filter(Boolean).join("\n");
}

/** Accent/diacritic-insensitive name search: every query word must prefix a name word. */
export function searchPlayers(players, q, exclude = new Set(), limit = 8) {
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const p of players) {
    if (exclude.has(p.id)) continue;
    const parts = norm(p.name).split(/\s+/);
    if (words.every((w) => parts.some((x) => x.startsWith(w)))) out.push(p);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}
