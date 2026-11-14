// Pure normalizers: ESPN JSON in, small stable shapes out.
// Every accessor tolerates missing/renamed fields and falls back to a safe value,
// so a schema change on ESPN's side degrades a field instead of crashing a page.
// Isomorphic ES module — used by the Node service and directly by the browser.

export const HEADSHOT_BASE = "https://a.espncdn.com/i/headshots/nba/players/full";

/* ------------------------------------------------------------------ helpers */
export function get(obj, path, fallback = undefined) {
  let cur = obj;
  for (const key of String(path).split(".")) {
    if (cur == null) return fallback;
    cur = cur[key];
  }
  return cur === undefined || cur === null ? fallback : cur;
}
export const arr = (v) => (Array.isArray(v) ? v : []);
export const str = (v, fallback = "") => (v === undefined || v === null ? fallback : String(v));
export function num(v, fallback = null) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}
const hex = (c) => (/^[0-9a-f]{6}$/i.test(str(c)) ? `#${c}` : null);

/* --------------------------------------------------------------- headshots */
const ID_IN_URL = /\/(?:id|full)\/(\d+)(?:[/.]|$)/;

/** ESPN athlete id from `id`, or parsed out of headshot / player-card URLs (the injuries feed omits `id`). */
export function athleteId(a) {
  if (!a || typeof a !== "object") return null;
  const direct = str(a.id).trim();
  if (/^\d+$/.test(direct)) return direct;
  const candidates = [typeof a.headshot === "string" ? a.headshot : get(a, "headshot.href"), ...arr(a.links).map((l) => get(l, "href"))];
  for (const url of candidates) {
    const m = ID_IN_URL.exec(str(url));
    if (m) return m[1];
  }
  return null;
}

/** Headshot URLs. `url` is the canonical CDN path built from the id; `small` is a ~8KB resized variant for lists. */
export function headshot(a) {
  const id = athleteId(a);
  const href = typeof get(a, "headshot") === "string" ? a.headshot : get(a, "headshot.href", null);
  const url = id ? `${HEADSHOT_BASE}/${id}.png` : href || null;
  const path = url && url.startsWith("https://a.espncdn.com") ? url.replace("https://a.espncdn.com", "") : null;
  const small = path ? `https://a.espncdn.com/combiner/i?img=${path}&w=96&h=70&scale=crop&cquality=80&location=origin` : url;
  return { url, small, espnHref: href || null };
}

function initialsOf(name) {
  const parts = str(name).replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Common athlete shape used everywhere (scores, box scores, rosters, injuries). */
export function athlete(a, extra = {}) {
  const name = str(get(a, "displayName") || get(a, "fullName") || [get(a, "firstName"), get(a, "lastName")].filter(Boolean).join(" "), "Unknown player");
  const hs = headshot(a);
  return {
    id: athleteId(a),
    name,
    shortName: str(get(a, "shortName"), name),
    initials: initialsOf(name),
    jersey: str(get(a, "jersey"), ""),
    position: str(get(a, "position.abbreviation"), ""),
    headshot: hs.url,
    headshotSmall: hs.small,
    ...extra,
  };
}

/* -------------------------------------------------------------------- teams */
export function team(t) {
  const logo = get(t, "logo") || get(t, "logos.0.href") || null;
  return {
    id: str(get(t, "id"), ""),
    abbr: str(get(t, "abbreviation"), "—"),
    name: str(get(t, "shortDisplayName") || get(t, "name"), ""),
    location: str(get(t, "location"), ""),
    displayName: str(get(t, "displayName"), str(get(t, "name"), "Unknown team")),
    color: hex(get(t, "color")) || "#6e6e73",
    altColor: hex(get(t, "alternateColor")),
    logo,
  };
}

export function normalizeTeams(json) {
  const list = arr(get(json, "sports.0.leagues.0.teams")).map((x) => team(get(x, "team", {})));
  return list.filter((t) => t.id).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/* --------------------------------------------------------------- scoreboard */
const STATES = new Set(["pre", "in", "post"]);
export function gameStatus(s) {
  const state = str(get(s, "type.state"));
  return {
    state: STATES.has(state) ? state : "unknown",
    name: str(get(s, "type.name"), ""),
    completed: Boolean(get(s, "type.completed", false)),
    detail: str(get(s, "type.detail"), ""),
    shortDetail: str(get(s, "type.shortDetail") || get(s, "type.detail"), ""),
    period: num(get(s, "period"), 0),
    clock: str(get(s, "displayClock"), ""),
  };
}

function competitor(c) {
  return {
    ...team(get(c, "team", {})),
    homeAway: get(c, "homeAway") === "home" ? "home" : "away",
    score: num(get(c, "score"), null),
    winner: Boolean(get(c, "winner", false)),
    record: str(get(arr(get(c, "records")).find((r) => get(r, "type") === "total" || get(r, "name") === "overall"), "summary"), ""),
    linescores: arr(get(c, "linescores")).map((l) => num(get(l, "value") ?? get(l, "displayValue"), 0)),
    leaders: arr(get(c, "leaders")).map((cat) => {
      const top = get(cat, "leaders.0");
      if (!top) return null;
      return {
        category: str(get(cat, "abbreviation") || get(cat, "shortDisplayName") || get(cat, "name"), ""),
        label: str(get(cat, "displayName"), ""),
        value: str(get(top, "displayValue"), ""),
        athlete: athlete(get(top, "athlete", {})),
      };
    }).filter(Boolean),
  };
}

export function normalizeGame(e) {
  const comp = get(e, "competitions.0", {});
  const status = gameStatus(get(comp, "status") || get(e, "status"));
  const teams = arr(get(comp, "competitors")).map(competitor);
  const home = teams.find((t) => t.homeAway === "home") || teams[0] || null;
  const away = teams.find((t) => t.homeAway === "away") || teams[1] || null;
  return {
    id: str(get(e, "id"), ""),
    date: str(get(e, "date") || get(comp, "date"), ""),
    name: str(get(e, "name"), ""),
    shortName: str(get(e, "shortName"), ""),
    status,
    venue: str(get(comp, "venue.fullName"), ""),
    broadcast: str(get(comp, "broadcast") || get(comp, "broadcasts.0.names.0"), ""),
    note: str(get(comp, "notes.0.headline"), ""),
    home,
    away,
  };
}

export function normalizeScoreboard(json) {
  const games = arr(get(json, "events")).map(normalizeGame).filter((g) => g.id);
  return {
    date: str(get(json, "day.date"), ""),
    season: num(get(json, "season.year"), null),
    games,
    live: games.filter((g) => g.status.state === "in").length,
  };
}

/* ------------------------------------------------------- summary / box score */
export function normalizeSummary(json, { maxPlays = 40 } = {}) {
  const comp = get(json, "header.competitions.0", {});
  const game = normalizeGame({ id: get(json, "header.id"), competitions: [comp], status: get(comp, "status") });

  const teams = arr(get(json, "boxscore.players")).map((side) => {
    const block = get(side, "statistics.0", {});
    const labels = arr(get(block, "labels")).map((l) => str(l));
    const keys = arr(get(block, "keys")).map((k) => str(k));
    const toStats = (values) => {
      const out = {};
      labels.forEach((label, i) => { out[label] = str(arr(values)[i], ""); });
      return out;
    };
    return {
      team: team(get(side, "team", {})),
      labels,
      keys,
      totals: toStats(get(block, "totals")),
      players: arr(get(block, "athletes")).map((p) => athlete(get(p, "athlete", {}), {
        starter: Boolean(get(p, "starter", false)),
        didNotPlay: Boolean(get(p, "didNotPlay", false)) || !arr(get(p, "stats")).length,
        reason: str(get(p, "reason"), ""),
        ejected: Boolean(get(p, "ejected", false)),
        stats: toStats(get(p, "stats")),
      })),
    };
  });

  const plays = arr(get(json, "plays")).slice(-maxPlays).reverse().map((p) => ({
    id: str(get(p, "id"), ""),
    period: num(get(p, "period.number"), 0),
    periodLabel: str(get(p, "period.displayValue"), ""),
    clock: str(get(p, "clock.displayValue"), ""),
    text: str(get(p, "text"), ""),
    homeScore: num(get(p, "homeScore"), null),
    awayScore: num(get(p, "awayScore"), null),
    scoring: Boolean(get(p, "scoringPlay", false)),
    teamId: str(get(p, "team.id"), ""),
  }));

  return { game, teams, plays, playCount: arr(get(json, "plays")).length };
}

/* ------------------------------------------------------------------ rosters */
/** Current-season salary in dollars. ESPN's `contract` is often absent; `contracts[]` is keyed by season.year. */
export function currentSalary(a, seasonYear) {
  const list = arr(get(a, "contracts"));
  const match = seasonYear ? list.find((c) => num(get(c, "season.year")) === seasonYear) : null;
  return num(get(match, "salary"), null) ?? num(get(a, "contract.salary"), null);
}

export function normalizeRoster(json) {
  const seasonYear = num(get(json, "season.year"), null);
  const t = get(json, "team", {});
  return {
    team: { ...team(t), record: str(get(t, "recordSummary"), ""), standing: str(get(t, "standingSummary"), "") },
    season: seasonYear,
    athletes: arr(get(json, "athletes")).map((a) => {
      const inj = get(a, "injuries.0");
      return athlete(a, {
        age: num(get(a, "age"), null),
        height: str(get(a, "displayHeight"), ""),
        weight: str(get(a, "displayWeight"), ""),
        experience: num(get(a, "experience.years"), null),
        college: str(get(a, "college.shortName") || get(a, "college.name"), ""),
        salary: currentSalary(a, seasonYear),
        status: str(get(a, "status.type"), "active"),
        injury: inj ? { status: str(get(inj, "status"), "Injured"), date: str(get(inj, "date"), "") } : null,
      });
    }),
    coach: arr(get(json, "coach")).map((c) => [get(c, "firstName"), get(c, "lastName")].filter(Boolean).join(" ")).filter(Boolean)[0] || "",
  };
}

/* ----------------------------------------------------------------- injuries */
export function normalizeInjuries(json) {
  const out = [];
  for (const group of arr(get(json, "injuries"))) {
    for (const i of arr(get(group, "injuries"))) {
      const a = get(i, "athlete", {});
      const teamObj = get(a, "team") || { id: get(group, "id"), displayName: get(group, "displayName") };
      out.push({
        id: str(get(i, "id"), ""),
        athlete: athlete(a),
        team: team(teamObj),
        status: str(get(i, "status"), "Unknown"),
        fantasy: str(get(i, "details.fantasyStatus.abbreviation"), ""),
        injury: [get(i, "details.type"), get(i, "details.detail"), get(i, "details.side")].filter((x) => x && x !== "Not Specified").join(" · "),
        returnDate: str(get(i, "details.returnDate"), ""),
        comment: str(get(i, "shortComment") || get(i, "longComment"), ""),
        date: str(get(i, "date"), ""),
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------------------------------------------------------------- standings */
function statMap(stats) {
  const byName = {};
  for (const s of arr(stats)) {
    const key = str(get(s, "type") || get(s, "name")).toLowerCase();
    if (key && !(key in byName)) byName[key] = s;
  }
  const val = (k, fb = null) => num(get(byName[k], "value"), fb);
  const disp = (k, fb = "") => str(get(byName[k], "displayValue") ?? get(byName[k], "summary"), fb);
  return { val, disp };
}

export function normalizeStandings(json) {
  const conferences = arr(get(json, "children")).map((conf) => {
    const teams = arr(get(conf, "standings.entries")).map((e) => {
      const { val, disp } = statMap(get(e, "stats"));
      const wins = val("wins", 0), losses = val("losses", 0);
      return {
        team: team(get(e, "team", {})),
        wins, losses,
        pct: val("winpercent", wins + losses ? wins / (wins + losses) : 0),
        pctText: disp("winpercent", ".000"),
        gb: disp("gamesbehind", "-"),
        seed: val("playoffseed", null),
        streak: disp("streak", ""),
        lastTen: disp("lasttengames", ""),
        home: disp("home", ""),
        road: disp("road", ""),
        ppg: val("avgpointsfor", null),
        oppPpg: val("avgpointsagainst", null),
        diff: val("differential", null),
      };
    });
    teams.sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || b.pct - a.pct);
    return { name: str(get(conf, "name"), ""), abbr: str(get(conf, "abbreviation"), ""), teams };
  });
  return { season: str(get(json, "seasons.0.displayName") || get(json, "children.0.standings.seasonDisplayName"), ""), conferences };
}

/* ------------------------------------------------------------- transactions */
export function transactionKind(desc) {
  const d = str(desc).toLowerCase();
  if (/\btrade|acquired\b/.test(d)) return "trade";
  if (/\bwaive|released?\b/.test(d)) return "release";
  if (/\bsigned|re-signed|converted\b/.test(d)) return "signing";
  if (/\bassigned|recalled\b/.test(d)) return "assignment";
  if (/\bsuspend/.test(d)) return "suspension";
  return "other";
}

export function normalizeTransactions(json) {
  return arr(get(json, "transactions")).map((t) => ({
    date: str(get(t, "date"), ""),
    description: str(get(t, "description"), ""),
    kind: transactionKind(get(t, "description")),
    team: team(get(t, "team", {})),
  })).filter((t) => t.description);
}
