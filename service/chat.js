// "Ask Hooptrax": NBA-only assistant.
//   findEntities()  players / teams / years mentioned in a question
//   buildContext()  compact, question-targeted facts from the live cache + nba_history.json (for Gemini grounding)
//   localAnswer()   zero-API-key engine that answers common NBA questions straight from the same data
// Pure: the server passes in the data it has cached.
import { TIERS, teamTier, money, resolveSalary } from "./trade.js";

export const SYSTEM_PROMPT = `You are "Hooptrax AI", the NBA assistant inside the Hooptrax app (live scores and schedules, trade machine, 3-2-1 lottery simulator, draft hub, awards and history).
Rules:
1. Only answer NBA basketball questions (players, teams, games, schedules, stats, standings, injuries, trades, contracts and the salary cap, the draft and lottery, awards, records, history back to 1946, and Hooptrax features). For anything else, reply in one short, friendly sentence that you only cover the NBA and suggest an NBA question.
2. The DATA block is live (ESPN feeds plus Hooptrax models) and newer than your training. For the 2026-27 season, today's and upcoming games, injuries, standings, rosters, contracts, 2K27 ratings and prospects, use ONLY the DATA block; if it doesn't cover something current, say so briefly. Never invent current scores, stats, injuries, contracts or game times.
3. Today is in the 2026-27 season (see TODAY), well past your training cutoff, so your memory of records, career totals, stats, rosters, contracts, injuries and standings is stale. NEVER answer those from memory. Use, in this order: (a) the DATA block (live ESPN feeds; CAREER lines are live all-time leaderboards with active players' totals updated through today's games; HISTORY, RETIRED, CHAMPIONS, AWARDS, SEASON and LIVE ESPN NEWS lines are ground truth and override your training), then (b) Google Search when you have the search tool and the DATA block doesn't cover the question. If neither confirms it, say you can't confirm it right now instead of guessing. Settled history that can't change (a past season's champion or Finals MVP, a draft that already happened) may come from your knowledge when the DATA block is silent. Retired numbers: if the DATA block lists one, it is retired (with the date given); a ceremony under UPCOMING is scheduled but has not happened yet; never say a jersey "hasn't been retired" when the DATA block lists it.
3b. Leaderboards and "who passed whom": give the order and totals exactly as the CAREER lines show them; an active player's total there already includes his games through today.
4. Game times are US Eastern Time. Say "tonight"/"tomorrow" relative to the TODAY line in the DATA block.
5. Hooptrax 2K27 ratings are estimates except where marked official; salaries marked "est." are estimates; cap thresholds are 2026-27 projections. Mention it when it matters.
6. Be fast and scannable: a one-line answer first, then short bullets. At most about 120 words unless asked for more, except for list answers (retired numbers, champions, award winners), which must be complete.
7. Retired numbers: give every number in the DATA block, never truncate or refuse. For several teams or the whole league, write one compact line per team with no bullets, grouped by team, e.g. "CHI: #1 Derrick Rose, #4 Jerry Sloan, #10 Bob Love, #23 Michael Jordan, #33 Scottie Pippen", and note that #6 (Bill Russell) is retired league-wide. Use full player and team names so the app can link them. Use **bold** sparingly. No markdown tables or headings.`;

/** The system prompt with today's date (US Eastern) stamped in, so the model never assumes its training date. */
export function systemPrompt(now = Date.now()) {
  const today = new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return `TODAY'S DATE: ${today} (US Eastern). The current NBA season is 2026-27.\n\n${SYSTEM_PROMPT}`;
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const CODE_OF = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
const ESPN_OF = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" };
const f1 = (x) => (x == null || !Number.isFinite(+x) ? "—" : (+x).toFixed(1));

/** Index of active players, legends and teams for entity matching. */
export function buildIndex({ league, history }) {
  const players = [], teams = [];
  const lastCount = new Map();
  for (const p of league?.players || []) { const last = norm(p.name).split(" ").slice(-1)[0]; lastCount.set(last, (lastCount.get(last) || 0) + 1); }
  for (const p of league?.players || []) players.push({ id: p.id, name: p.name, key: norm(p.name), last: norm(p.name).split(" ").slice(-1)[0], team: p.teamAbbr, active: true });
  const activeIds = new Set(players.map((p) => p.id));
  for (const l of history?.legends || []) if (!activeIds.has(l.id)) players.push({ id: l.id, name: l.name, key: norm(l.name), last: null, legend: true });
  for (const [abbr, t] of Object.entries(league?.teams || {})) {
    teams.push({ abbr, code: CODE_OF[abbr] || abbr, name: t.displayName || `${t.location} ${t.name}`, keys: [norm(t.displayName), norm(t.name), norm(t.location), abbr.toLowerCase(), (CODE_OF[abbr] || abbr).toLowerCase()].filter((k) => k && k.length >= 2) });
  }
  // nicknames people actually type
  const nick = { sixers: "PHI", cavs: "CLE", mavs: "DAL", wolves: "MIN", blazers: "POR", dubs: "GS", knickerbockers: "NY", nets: "BKN", celtics: "BOS" };
  for (const [k, abbr] of Object.entries(nick)) teams.find((t) => t.abbr === abbr)?.keys.push(k);
  return { players, teams, uniqueLast: (l) => lastCount.get(l) === 1 };
}

export function findEntities(text, idx, { maxPlayers = 4, maxTeams = 3 } = {}) {
  const q = ` ${norm(text)} `;
  const players = [];
  for (const p of idx.players) if (q.includes(` ${p.key} `)) players.push(p);
  if (!players.length) for (const p of idx.players) if (p.last && p.last.length > 3 && idx.uniqueLast(p.last) && q.includes(` ${p.last} `)) players.push(p);
  const teams = [];
  for (const t of idx.teams) if (t.keys.some((k) => q.includes(` ${k} `) && !(k === "jazz" && false))) teams.push(t);
  // ambiguous one-word city keys ("los angeles") match both LA teams; keep the explicit name match when present
  const years = [...q.matchAll(/\b(19[4-9]\d|20[0-3]\d)\b/g)].map((m) => +m[1]);
  return { players: dedupe(players).slice(0, maxPlayers), teams: dedupe(teams, "abbr").slice(0, maxTeams), years };
}
const dedupe = (arr, k = "id") => arr.filter((x, i) => arr.findIndex((y) => y[k] === x[k]) === i);

const isNba = (q) => /\b(nba|basketball|hoop|player|team|game|games|score|scores|tonight|today|tomorrow|schedule|plays|playing|upcoming|standings?|seed|playoffs?|injur|trade|salary|contract|cap|apron|draft|lottery|prospect|rookie|mvp|roy|dpoy|award|champion|finals|title|ring|retired|jersey|records?|stats?|points?|rebounds?|assists?|steals?|blocks?|scor\w*|all.?time|career|passed|three|2k|rating|ovr|coach|all.?star|leaders?|hooptrax|stepien|tank|odds)\b/i.test(q);

/* ---------------------------------------------------------- dates (US Eastern) */
const ET_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** YYYYMMDD in America/New_York, `offset` days from `now`. */
export function etDate(offset = 0, now = Date.now()) {
  const [y, m, d] = ET_FMT.format(new Date(now)).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + offset));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
}
/** Yesterday, today and the next 14 days (16 dates), US Eastern. */
export const scheduleDates = (now = Date.now()) => Array.from({ length: 16 }, (_, i) => etDate(i - 1, now));
const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ymdDate = (ymd) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
export const dayLabel = (ymd) => ymdDate(ymd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const etTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET"; } catch { return ""; } };

/** Which dates a question is about (YYYYMMDD list), from words like tonight, tomorrow, friday, "nov 20", "this week". */
export function datesAsked(question, now = Date.now()) {
  const q = norm(question), out = new Set();
  if (/\b(today|tonight|tonite)\b/.test(q)) out.add(etDate(0, now));
  if (/\b(tomorrow|tmrw|tmr)\b/.test(q)) out.add(etDate(1, now));
  if (/\b(yesterday|last night)\b/.test(q)) out.add(etDate(-1, now));
  const todayDow = ymdDate(etDate(0, now)).getUTCDay();
  DOW.forEach((d, i) => { if (new RegExp(`\\b${d}s?\\b`).test(q)) { let k = (i - todayDow + 7) % 7; if (/\bnext\b/.test(q) && k === 0) k = 7; out.add(etDate(k, now)); } });
  for (const m of q.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b/g)) {
    const y = +etDate(0, now).slice(0, 4), mi = MON.indexOf(m[1]);
    for (const yy of [y, y + 1]) { const ymd = `${yy}${String(mi + 1).padStart(2, "0")}${String(+m[2]).padStart(2, "0")}`; if (ymd >= etDate(-1, now)) { out.add(ymd); break; } }
  }
  if (/\b(this week|next 7 days|coming week)\b/.test(q)) for (let i = 0; i < 7; i++) out.add(etDate(i, now));
  if (/\b(next week)\b/.test(q)) for (let i = 7; i < 14; i++) out.add(etDate(i, now));
  if (/\b(weekend)\b/.test(q)) [5, 6, 0].forEach((dw) => out.add(etDate((dw - todayDow + 7) % 7, now)));
  return [...out].sort();
}

/** What a question is about. */
export function intentsOf(question) {
  const q = String(question || "");
  const t = (re) => re.test(q);
  const out = new Set();
  if (t(/\b(schedule|tonight|tonite|today|tomorrow|tmrw|yesterday|last night|this week|next week|weekend|upcoming|next game|play(s|ing)? (next|on|against|vs)|who plays|when (do|does|is|are)|game time|tip.?off|(mon|tues|wednes|thurs|fri|satur|sun)day|games?)\b/i)) out.add("schedule");
  if (t(/\b(score|scores|final|won|beat|lost|result|live|halftime|quarter)\b/i) && !t(/\b(19[4-9]\d|20[0-2]\d|mvp|award|champion|title|finals mvp|ever|all.?time|career|history)\b/i)) out.add("scores");
  if (t(/\binjur|\b(out|questionable|doubtful|day.to.day|hurt|return|status)\b/i)) out.add("injuries");
  if (t(/\b(standings?|seed|seeds|record|first place|best record|worst record|playoff|play.in|conference|lottery|odds|tank)\b/i)) out.add("standings");
  if (t(/\b(trade|traded|salary|contract|cap|apron|tax|payroll|signed|waived|transaction|deal|free agent)\b/i)) out.add("trade");
  if (t(/\b(draft|prospect|big board|mock|lottery|no\.? ?1 pick|top pick)\b/i)) out.add("draft");
  if (t(/\b(2k|2k27|rating|ratings|ovr|overall)\b/i)) out.add("2k");
  if (t(/\b(history|all.?time|career|ever|record|records|champion|champions|title|titles|finals|ring|mvp|rookie of the year|roy|dpoy|sixth man|most improved|coach of the year|retired|jersey|legend|hall of fame|19[4-9]\d|20[0-2]\d)\b/i)) out.add("history");
  return out;
}

/** All cached games in the schedule window (deduped), each tagged with its ET date. */
const windowGames = (d) => {
  const seen = new Set(), out = [];
  for (const day of d.schedule || []) for (const g of day.games || []) if (!seen.has(g.id)) { seen.add(g.id); out.push({ ...g, ymd: day.date }); }
  return out;
};
const gameLine = (g) => {
  const st = g.status?.state;
  const sc = st === "pre" ? etTime(g.date) : `${g.away?.score ?? ""}-${g.home?.score ?? ""} ${st === "post" ? "Final" : g.status?.shortDetail || "live"}`;
  return `${g.away?.abbr} @ ${g.home?.abbr} ${sc}${g.broadcast ? ` (${g.broadcast})` : ""}`;
};

/* ---------------------------------------------------------- retired numbers (nba_history.json) */
export const isRetiredQ = (q) => /\bretir(e|ed|es|ing|ement|ements)\b|\bjerseys?\b|\brafters\b|\bnumbers?\b.*\b(hang|hanging|honou?r)/i.test(String(q || ""));
const shortDate = (d) => (d ? String(d).slice(0, 7) : "");
/** One compact row: "CHI: #1 Derrick Rose (2026-01), #4 Jerry Sloan, …  UPCOMING: …" */
export function retiredLine(code, f, { detail = false } = {}) {
  const list = (f?.retired || []).map((r) => `#${r.num} ${r.name}${r.retiredOn ? ` (${detail ? r.retiredOn : shortDate(r.retiredOn)})` : ""}${detail && r.hof ? " HOF" : ""}`);
  const up = (f?.upcomingRetirements || []).map((u) => `#${u.num} ${u.name} (NOT retired yet; ceremony scheduled ${u.date})`);
  return `${code}: ${list.join(", ") || "none"}${up.length ? ` | UPCOMING: ${up.join(", ")}` : ""}`;
}
/** Every franchise that retired (or will retire) a player's number. */
export function retiredBy(history, name) {
  const k = norm(name), out = [];
  for (const [code, f] of Object.entries(history?.franchises || {})) {
    for (const r of f.retired || []) if (norm(r.name) === k) out.push({ code, ...r });
    for (const u of f.upcomingRetirements || []) if (norm(u.name) === k) out.push({ code, ...u, upcoming: true });
  }
  if (norm("Bill Russell") === k) out.push({ code: "NBA", num: "6", retiredOn: "2022-08" });
  return out;
}

/** Facts for the model, targeted at the question. */
export function buildContext(question, d, idx, now = Date.now()) {
  const ent = findEntities(question, idx);
  const intents = intentsOf(question);
  const general = !ent.players.length && !ent.teams.length && !ent.years.length && !intents.size;
  const out = [];
  const today = etDate(0, now);
  out.push(`TODAY (US Eastern): ${dayLabel(today)} ${today.slice(0, 4)}. Season: 2026-27.`);
  // Schedule: dates asked about, plus each mentioned team's last result and next 3 games.
  const all = windowGames(d);
  const asked = datesAsked(question, now);
  const wantSched = intents.has("schedule") || intents.has("scores") || general;
  const dates = asked.length ? asked : wantSched && !ent.teams.length ? [today, etDate(1, now)] : [];
  for (const ymd of dates.slice(0, 7)) {
    const games = all.filter((g) => g.ymd === ymd);
    const known = (d.schedule || []).some((x) => x.date === ymd);
    out.push(`GAMES ${dayLabel(ymd)}: ${known ? games.map(gameLine).join("; ") || "no games" : "outside the cached 14-day window"}`);
  }
  for (const t of ent.teams) {
    const mine = all.filter((g) => g.home?.abbr === t.abbr || g.away?.abbr === t.abbr);
    const last = mine.filter((g) => g.status?.state === "post").slice(-1);
    const next = mine.filter((g) => g.status?.state !== "post").slice(0, 3);
    if (mine.length) out.push(`${t.abbr} SCHEDULE: ${[...last, ...next].map((g) => `${dayLabel(g.ymd)} ${gameLine(g)}`).join("; ")}`);
  }
  if (intents.has("standings") || general || ent.teams.length) for (const conf of d.standings?.conferences || []) out.push(`${conf.abbr || conf.name} STANDINGS: ${conf.teams.map((t) => `${t.seed}.${t.team.abbr} ${t.wins}-${t.losses}`).join(", ")}`);
  if (d.lottery && (intents.has("standings") || intents.has("draft"))) out.push(`3-2-1 LOTTERY PROJECTION (seed: team, #1 odds, top-4, floor): ${d.lottery.slice(0, 16).map((r) => `${r.seed}:${r.team} ${(r.p1 * 100).toFixed(1)}% ${(r.top4 * 100).toFixed(0)}% #${r.floor}`).join(", ")}. Seeds 1-3 are draft-relegated (2 balls, floor #12). All 16 picks drawn.`);
  if (intents.has("injuries")) {
    const scoped = ent.teams.length ? (d.injuries || []).filter((i) => ent.teams.some((t) => t.abbr === i.team?.abbr)) : (d.injuries || []).slice(0, 25);
    out.push(`INJURIES: ${scoped.map((i) => `${i.athlete?.name} (${i.team?.abbr}) ${i.status}${i.injury ? " – " + i.injury : ""}`).join("; ") || "none reported"}`);
  }
  if (intents.has("trade")) {
    out.push(`RECENT OFFICIAL TRANSACTIONS: ${(d.transactions || []).filter((t) => t.category !== "rumor").slice(0, 12).map((t) => `${t.team?.abbr}: ${t.description}`).join(" | ")}`);
    const rum = (d.transactions || []).filter((t) => t.category === "rumor").slice(0, 8);
    if (rum.length) out.push(`RUMORS & REPORTS (RealGM Wiretap, NOT official; say so if you cite them): ${rum.map((t) => `${t.team?.abbr}: ${t.description}`).join(" | ")}`);
  }
  if (intents.has("2k") && !ent.players.length) out.push(`2K27 TOP 20 (Hooptrax; * = official Nov 2026 update): ${(d.ratings?.players || []).slice(0, 20).map((p) => `${p.name} ${p.ovr}${p.seeded ? "*" : ""}`).join(", ")}`);
  const statsById = new Map((d.stats?.players || []).map((p) => [p.id, p]));
  for (const p of ent.players) {
    if (p.active) {
      const s = statsById.get(p.id)?.stats, r = d.ratings?.players?.find((x) => x.id === p.id), lp = d.league?.players?.find((x) => x.id === p.id);
      const sal = lp ? resolveSalary(lp, { book: d.book, stats: s, cba: d.book?.cba }) : null;
      const inj = (d.injuries || []).find((i) => i.athlete?.id === p.id);
      out.push(`PLAYER ${p.name} (${p.team}${lp ? `, ${lp.position}, age ${lp.age}, ${lp.height}` : ""}): 2026-27 ${s ? `${s.gp} GP, ${f1(s.pts)} PTS, ${f1(s.reb)} REB, ${f1(s.ast)} AST, ${f1(s.stl)} STL, ${f1(s.blk)} BLK, FG ${f1(s.fgPct)}%, 3P ${f1(s.threePct)}%, ${f1(s.min)} MIN` : "no games yet"}; 2K27 OVR ${r ? `${r.ovr}${r.seeded ? " (official)" : " (est.)"}` : "—"}; 2026-27 salary ${sal ? money(sal.salary) + (sal.source === "estimate" ? " est." : "") : "—"}${inj ? `; injury: ${inj.status} ${inj.injury || ""}` : ""}.`);
    }
    const leg = d.history?.legends?.find((l) => l.id === p.id);
    if (leg) out.push(`CAREER ${leg.name} (${leg.from}–${leg.to}): ${leg.gp} GP, ${f1(leg.pts)} PPG, ${f1(leg.reb)} RPG, ${f1(leg.ast)} APG; totals ${leg.totals.pts} PTS, ${leg.totals.reb} REB, ${leg.totals.ast} AST; ${leg.draft || "undrafted"}.`);
    const aw = Object.entries(d.history?.awards || {}).flatMap(([k, list]) => list.filter((a) => a.name === p.name).map((a) => `${k.toUpperCase()} ${a.year}`));
    const fm = (d.history?.champions || []).filter((c) => c.fmvp === p.name).map((c) => `Finals MVP ${c.year}`);
    if (aw.length || fm.length) out.push(`AWARDS ${p.name}: ${[...aw, ...fm].join(", ")}`);
  }
  for (const t of ent.teams) {
    const f = d.history?.franchises?.[t.code];
    let st = null; for (const c of d.standings?.conferences || []) for (const x of c.teams) if (x.team.abbr === t.abbr) st = `${x.wins}-${x.losses}, #${x.seed} in ${c.abbr || c.name}, streak ${x.streak}`;
    const roster = (d.league?.players || []).filter((p) => p.teamAbbr === t.abbr);
    const payroll = roster.reduce((s, p) => s + resolveSalary(p, { book: d.book, stats: statsById.get(p.id)?.stats, cba: d.book?.cba }).salary, 0);
    out.push(`TEAM ${t.name} (${t.abbr}): ${st || "—"}; payroll ~${money(payroll)} (${d.book?.cba ? TIERS[teamTier(payroll, d.book.cba)] : ""}); roster: ${roster.map((p) => p.name).join(", ")}.`);
    if (f) out.push(`HISTORY ${t.name}: ${f.titles.length} titles${f.titles.length ? ` (${f.titles.map((x) => `${x.year}${x.fmvp ? ` FMVP ${x.fmvp}` : ""}`).join(", ")})` : ""}.`);
    if (f) out.push(retiredLine(t.code, f, { detail: true }));
  }
  for (const y of ent.years) {
    const c = d.history?.champions?.find((x) => x.year === y);
    const aw = Object.entries(d.history?.awards || {}).map(([k, list]) => { const a = list.filter((x) => x.year === y).map((x) => x.name); return a.length ? `${k.toUpperCase()}: ${a.join(" & ")}` : ""; }).filter(Boolean);
    const n1 = d.history?.draft?.no1?.find((x) => x.year === y);
    out.push(`SEASON ${y}: ${c ? `champion ${c.champion} def. ${c.runnerUp} ${c.series}${c.fmvp ? `, Finals MVP ${c.fmvp}` : ""}; ` : ""}${aw.join("; ")}${n1 ? `; #1 pick ${n1.name} (${n1.team})` : ""}`);
  }
  // this season's league leaders (live ESPN per-game stats; qualifiers: 5+ games)
  if (/\b(leads?|leading|leaders?|top scorer|scoring title|best (scorer|rebounder|passer)|most (points|rebounds|assists) (per|a) game|ppg|rpg|apg|this season)\b/i.test(question) && d.stats?.players?.length) {
    const q = d.stats.players.filter((p) => (p.stats?.gp || 0) >= 5);
    for (const [k, lbl] of [["pts", "PPG"], ["reb", "RPG"], ["ast", "APG"], ["stl", "SPG"], ["blk", "BPG"]]) {
      const top = [...q].sort((a, b) => (b.stats[k] || 0) - (a.stats[k] || 0)).slice(0, 5);
      out.push(`2026-27 LEADERS ${lbl} (live, min 5 GP): ${top.map((p, i) => `${i + 1}. ${p.name} (${p.teamAbbr}) ${f1(p.stats[k])}`).join(", ")}`);
    }
  }
  if (/all.?time|career|most (points|rebounds|assists|steals|blocks|threes)|leader/i.test(question) && d.history) {
    for (const [c, l] of d.history.careerCategories) out.push(`CAREER ${l.toUpperCase()} TOP 10 (live through today's games): ${d.history.careerLeaders[c].slice(0, 10).map((r, i) => `${i + 1}. ${r.name} ${r.total.toLocaleString("en-US")}${r.active ? " (active)" : ""}`).join(", ")}`);
  }
  if (/draft|prospect|2027|2028|2029|mock/i.test(question) && d.prospects) for (const y of ["2027", "2028", "2029"]) out.push(`${y} BIG BOARD TOP 10: ${(d.prospects[y] || []).slice(0, 10).map((p) => `${p.rank}. ${p.name} (${p.position}, ${p.school || p.type})`).join("; ")}`);
  if (/mvp|rookie|defensive|sixth|improved|coach of/i.test(question) && d.history) for (const k of ["mvp", "roy", "dpoy", "smoy", "mip", "coy"]) out.push(`${k.toUpperCase()} last 8: ${(d.history.awards[k] || []).slice(0, 8).map((a) => `${a.year} ${a.name}`).join("; ")}`);
  if (isRetiredQ(question) && d.history) {
    if (!ent.teams.length || /\b(all|every|each|league|nba|teams)\b/i.test(question)) {
      out.push(`RETIRED NUMBERS, ALL 30 TEAMS (Hooptrax dataset, audited Nov 2026; #6 Bill Russell retired league-wide in 2022):`);
      for (const [code, f] of Object.entries(d.history.franchises)) out.push(retiredLine(code, f));
    }
    for (const p of ent.players) {
      const hits = retiredBy(d.history, p.name);
      out.push(hits.length ? `RETIRED ${p.name}: ${hits.map((h) => `${h.code} #${h.num}${h.retiredOn ? ` (retired ${h.retiredOn})` : ""}${h.upcoming ? ` NOT RETIRED YET (ceremony scheduled ${h.date})` : ""}`).join("; ")}` : `RETIRED ${p.name}: not in the Hooptrax retired-number list as of Nov 2026`);
    }
  }
  if (/\b(champion|champions|title|titles|finals|won it all)\b/i.test(question) && !ent.years.length && d.history) out.push(`CHAMPIONS (all, newest first): ${d.history.champions.map((c) => `${c.year} ${c.champion}${c.fmvp ? ` (FMVP ${c.fmvp})` : ""}`).join("; ")}`);
  if (/\bmvp\b/i.test(question) && !/finals mvp/i.test(question) && !ent.years.length && d.history) out.push(`MVP (all, newest first): ${(d.history.awards.mvp || []).map((a) => `${a.year} ${a.name}`).join("; ")}`);
  if (/cap|apron|tax|salary|contract|payroll/i.test(question) && d.book?.cba) { const c = d.book.cba; out.push(`2026-27 CAP (projected): cap ${money(c.salaryCap)}, tax ${money(c.taxLine)}, 1st apron ${money(c.firstApron)}, 2nd apron ${money(c.secondApron)}.`); }
  return { text: out.join("\n"), entities: ent, intents };
}

/* ------------------------------------------------------------------ local engine */
export function localAnswer(question, d, idx, now = Date.now()) {
  const q = String(question || "");
  const ent = findEntities(q, idx);
  const L = [];
  const has = (re) => re.test(q);
  if (!ent.players.length && !ent.teams.length && !isNba(q) && !datesAsked(q, now).length) {
    return { text: "I only cover the NBA. Try something like “Who's playing tonight?”, “What's Victor Wembanyama's 2K27 rating?” or “Who has the best lottery odds?”", entities: ent, refused: true };
  }
  const statsById = new Map((d.stats?.players || []).map((p) => [p.id, p]));
  const standingOf = (abbr) => { for (const c of d.standings?.conferences || []) for (const x of c.teams) if (x.team.abbr === abbr) return { ...x, conf: c.abbr || c.name }; return null; };

  const all = windowGames(d), asked = datesAsked(q, now), intents = intentsOf(q);
  if (ent.teams.length && (intents.has("schedule") || intents.has("scores")) && !asked.length) {
    for (const t of ent.teams) {
      const mine = all.filter((g) => g.home?.abbr === t.abbr || g.away?.abbr === t.abbr);
      const last = mine.filter((g) => g.status?.state === "post").slice(-1)[0];
      const next = mine.filter((g) => g.status?.state !== "post").slice(0, 3);
      L.push([`**${t.name} schedule**`, last ? `• Last: ${dayLabel(last.ymd)} — ${gameLine(last)}` : "", ...next.map((g) => `• ${dayLabel(g.ymd)} — ${gameLine(g)}`)].filter(Boolean).join("\n"));
    }
  } else if ((intents.has("schedule") || intents.has("scores") || asked.length) && !ent.players.length) {
    const dates = asked.length ? asked.slice(0, 7) : [etDate(0, now)];
    for (const ymd of dates) {
      const games = all.filter((g) => g.ymd === ymd);
      const known = (d.schedule || []).some((x) => x.date === ymd);
      const scoped = ent.teams.length ? games.filter((g) => ent.teams.some((t) => t.abbr === g.home?.abbr || t.abbr === g.away?.abbr)) : games;
      L.push(!known ? `${dayLabel(ymd)} is outside the 14-day schedule window I keep cached.` : scoped.length ? [`**${dayLabel(ymd)} — ${scoped.length} game${scoped.length > 1 ? "s" : ""} (ET):**`, ...scoped.map((g) => `• ${gameLine(g)}`)].join("\n") : `No games on ${dayLabel(ymd)}.`);
    }
  }
  if (isRetiredQ(q) && d.history && (!ent.teams.length || /\b(all|every|each|league|teams)\b/i.test(q))) {
    if (ent.players.length && !/\b(all|every|each|league|teams)\b/i.test(q)) {
      for (const p of ent.players) {
        const hits = retiredBy(d.history, p.name);
        L.push(hits.length ? `**${p.name}**: ${hits.map((h) => `${h.code === "NBA" ? "league-wide" : h.code} #${h.num}${h.upcoming ? ` not retired yet: ceremony scheduled ${h.date}` : h.retiredOn ? ` (retired ${h.retiredOn})` : ""}`).join(" · ")}` : `**${p.name}**: no retired number on file as of Nov 2026.`);
      }
    } else {
      L.push("**Retired numbers, all 30 teams** (#6 Bill Russell is retired league-wide):");
      L.push(Object.entries(d.history.franchises).map(([code, f]) => retiredLine(code, f)).join("\n"));
    }
  }
  if (has(/\b(lottery|odds|tank|worst record)\b/i) && d.lottery) {
    L.push("**3-2-1 lottery projection** (current standings, exact odds):");
    for (const r of d.lottery.slice(0, 8)) L.push(`• Seed ${r.seed}: ${r.teamName || r.team} — ${(r.p1 * 100).toFixed(1)}% for #1, ${(r.top4 * 100).toFixed(1)}% top 4, floor #${r.floor}`);
    L.push("Seeds 1–3 are draft-relegated (2 balls) but can't fall past #12.");
  }
  if (has(/\b(draft|prospect|big board|mock)\b/i) && d.prospects) {
    const y = ["2027", "2028", "2029"].find((x) => q.includes(x)) || "2027";
    L.push(`**${y} big board — top 10:**`);
    for (const p of (d.prospects[y] || []).slice(0, 10)) L.push(`${p.rank}. ${p.name} — ${p.position}, ${p.school || p.type}`);
  }
  if (has(/\b(standings?|seed|seeds|first place|best record)\b/i) && !ent.teams.length) {
    for (const c of d.standings?.conferences || []) L.push(`**${c.name}:** ${c.teams.slice(0, 6).map((t) => `${t.seed}. ${t.team.abbr} ${t.wins}-${t.losses}`).join(" · ")}`);
  }
  if (has(/\b(injur|injured|out|questionable|day.to.day)\w*/i) && !ent.players.length && !ent.teams.length) {
    L.push("**Latest injuries:**");
    for (const i of (d.injuries || []).slice(0, 8)) L.push(`• ${i.athlete?.name} (${i.team?.abbr}) — ${i.status}${i.injury ? `, ${i.injury}` : ""}`);
  }
  if (has(/\b(2k|rating|ratings|ovr)\b/i) && !ent.players.length) {
    L.push("**Top 2K27 ratings** (Hooptrax; ✱ = official Nov 2026 update):");
    for (const p of (d.ratings?.players || []).slice(0, 10)) L.push(`• ${p.name} ${p.ovr}${p.seeded ? " ✱" : ""}${p.delta ? ` (${p.delta > 0 ? "+" : ""}${p.delta})` : ""}`);
  }
  if (has(/\b(cap|apron|luxury tax|tax line)\b/i) && d.book?.cba && !ent.teams.length) {
    const c = d.book.cba;
    L.push(`**2026–27 thresholds (projected):** cap ${money(c.salaryCap)} · tax ${money(c.taxLine)} · 1st apron ${money(c.firstApron)} · 2nd apron ${money(c.secondApron)}.`);
  }
  if (has(/\b(all.?time|career)\b|most (points|rebounds|assists|steals|blocks|threes|3)/i) && d.history) {
    const cat = has(/rebound/i) ? "reb" : has(/assist/i) ? "ast" : has(/steal/i) ? "stl" : has(/block/i) ? "blk" : has(/three|3.?point|3s/i) ? "tpm" : "pts";
    const label = Object.fromEntries(d.history.careerCategories)[cat];
    L.push(`**All-time ${label.toLowerCase()} leaders:**`);
    d.history.careerLeaders[cat].slice(0, 5).forEach((r, i) => L.push(`${i + 1}. ${r.name} — ${r.total.toLocaleString("en-US")} (${r.perGame}/g)${r.active ? " · active" : ""}`));
  }
  for (const y of ent.years) {
    const c = d.history?.champions?.find((x) => x.year === y);
    const wantAward = ["mvp", "roy", "dpoy", "smoy", "mip", "coy"].find((k) => new RegExp({ mvp: "\\bmvp\\b", roy: "rookie", dpoy: "defensive", smoy: "sixth", mip: "improved", coy: "coach" }[k], "i").test(q));
    if (wantAward) { const a = (d.history.awards[wantAward] || []).filter((x) => x.year === y); L.push(a.length ? `**${y} ${wantAward.toUpperCase()}:** ${a.map((x) => x.name).join(" & ")}` : `No ${wantAward.toUpperCase()} on file for ${y}.`); }
    else if (c) L.push(`**${y} champion:** ${c.champion} def. ${c.runnerUp} ${c.series}${c.fmvp ? ` — Finals MVP ${c.fmvp}` : ""}.`);
    const n1 = d.history?.draft?.no1?.find((x) => x.year === y);
    if (n1 && has(/draft|pick/i)) L.push(`**${y} #1 pick:** ${n1.name} (${n1.team}, ${n1.from}).`);
  }
  if (!ent.years.length && has(/\b(mvp|rookie of the year|roy|dpoy|defensive player|sixth man|most improved|coach of the year)\b/i) && d.history) {
    const k = has(/rookie|roy/i) ? "roy" : has(/defensive|dpoy/i) ? "dpoy" : has(/sixth/i) ? "smoy" : has(/improved/i) ? "mip" : has(/coach/i) ? "coy" : "mvp";
    if (!ent.players.length) L.push(`**Recent ${k.toUpperCase()} winners:** ${(d.history.awards[k] || []).slice(0, 6).map((a) => `${a.year} ${a.name}`).join(" · ")}`);
  }
  if (!ent.years.length && !ent.teams.length && has(/\b(champion|champions|title|finals|won it all)\b/i) && d.history) {
    L.push(`**Recent champions:** ${d.history.champions.slice(0, 8).map((c) => `${c.year} ${c.champion}`).join(" · ")}`);
  }
  for (const t of ent.teams) {
    const st = standingOf(t.abbr), f = d.history?.franchises?.[t.code];
    const roster = (d.league?.players || []).filter((p) => p.teamAbbr === t.abbr);
    const lines = [`**${t.name}**${st ? ` — ${st.wins}-${st.losses}, #${st.seed} in the ${st.conf}${st.streak ? `, ${st.streak}` : ""}` : ""}`];
    if (isRetiredQ(q) && f) lines.push(retiredLine(t.code, f));
    if (has(/title|champion|ring|finals|history/i) && f) lines.push(f.titles.length ? `${f.titles.length} NBA title${f.titles.length > 1 ? "s" : ""}: ${f.titles.map((x) => x.year).join(", ")}` : "No NBA titles yet.");
    if (has(/salary|cap|payroll|apron|tax/i)) {
      const payroll = roster.reduce((s, p) => s + resolveSalary(p, { book: d.book, stats: statsById.get(p.id)?.stats, cba: d.book?.cba }).salary, 0);
      lines.push(`2026–27 payroll ~${money(payroll)}${d.book?.cba ? ` (${TIERS[teamTier(payroll, d.book.cba)]})` : ""}.`);
    }
    if (has(/injur|out|hurt/i)) { const inj = (d.injuries || []).filter((i) => i.team?.abbr === t.abbr); lines.push(inj.length ? `Injuries: ${inj.map((i) => `${i.athlete?.name} (${i.status})`).join(", ")}` : "No reported injuries."); }
    if (lines.length === 1) {
      const top = roster.map((p) => ({ p, s: statsById.get(p.id)?.stats })).filter((x) => x.s?.gp).sort((a, b) => b.s.pts - a.s.pts).slice(0, 3);
      if (top.length) lines.push(`Top scorers: ${top.map(({ p, s }) => `${p.name} ${f1(s.pts)}`).join(", ")}`);
      if (f) lines.push(`${f.titles.length} titles · ${f.retired.length} retired numbers`);
    }
    L.push(lines.join("\n"));
  }
  for (const p of ent.players) {
    const lines = [];
    if (p.active) {
      const s = statsById.get(p.id)?.stats, r = d.ratings?.players?.find((x) => x.id === p.id), lp = d.league?.players?.find((x) => x.id === p.id);
      const sal = lp ? resolveSalary(lp, { book: d.book, stats: s, cba: d.book?.cba }) : null;
      const inj = (d.injuries || []).find((i) => i.athlete?.id === p.id);
      lines.push(`**${p.name}** (${p.team}${lp?.position ? `, ${lp.position}` : ""})`);
      if (s?.gp) lines.push(`2026–27: ${f1(s.pts)} PTS · ${f1(s.reb)} REB · ${f1(s.ast)} AST · ${f1(s.fgPct)} FG% in ${s.gp} games`);
      if (r && (has(/2k|rating|ovr/i) || true)) lines.push(`2K27 OVR ${r.ovr}${r.seeded ? " (official update)" : " (Hooptrax estimate)"}${r.delta ? `, ${r.delta > 0 ? "+" : ""}${r.delta}` : ""}`);
      if (sal && (has(/salary|contract|cap|paid|money|make/i) || true)) lines.push(`2026–27 salary ${money(sal.salary)}${sal.source === "estimate" ? " (estimate)" : ""}`);
      if (inj) lines.push(`Injury: ${inj.status}${inj.injury ? ` — ${inj.injury}` : ""}`);
    }
    const leg = d.history?.legends?.find((l) => l.id === p.id);
    if (leg && (!p.active || has(/career|all.?time|legend/i))) {
      if (!lines.length) lines.push(`**${leg.name}** (${leg.from}–${leg.to})`);
      lines.push(`Career: ${f1(leg.pts)} PPG · ${f1(leg.reb)} RPG · ${f1(leg.ast)} APG over ${leg.gp} games (${leg.totals.pts.toLocaleString("en-US")} points)`);
    }
    const aw = Object.entries(d.history?.awards || {}).flatMap(([k, list]) => list.filter((a) => a.name === p.name).map((a) => `${k.toUpperCase()} ${a.year}`));
    const fm = (d.history?.champions || []).filter((c) => c.fmvp === p.name).map((c) => `Finals MVP ${c.year}`);
    if (aw.length || fm.length) lines.push(`Honors: ${[...fm, ...aw].join(", ")}`);
    if (lines.length) L.push(lines.join("\n"));
  }
  if (!L.length) L.push("I can answer from live Hooptrax data: games and schedules for the next 14 days, standings, injuries, the 3-2-1 lottery, 2027–2029 prospects, 2K27 ratings, salaries and the cap, retired numbers, champions and award winners. Name a player or team to get started.");
  return { text: L.join("\n\n"), entities: ent };
}

/** Player/team chips for the UI: anything in the index that appears in the answer text. */
export function chipsFor(text, idx, entities) {
  const found = findEntities(text, idx, { maxPlayers: 8, maxTeams: 30 });
  const players = dedupe([...(entities?.players || []), ...found.players]).slice(0, 8);
  const allTeams = dedupe([...(entities?.teams || []), ...found.teams], "abbr");
  const teams = allTeams.length > 6 ? [] : allTeams;     // a schedule list: the game cards cover the teams
  return [...players.map((p) => ({ type: "player", id: p.id, label: p.name })), ...teams.map((t) => ({ type: "team", id: t.code, label: t.name }))];
}

/** Compact stat cards for the UI: up to 3 players and up to 4 games relevant to the question. */
export function cardsFor(question, d, idx, entities, now = Date.now()) {
  const ent = entities || findEntities(question, idx);
  const cards = [];
  const statsById = new Map((d.stats?.players || []).map((p) => [p.id, p]));
  const teamOf = (abbr) => d.league?.teams?.[abbr] || null;
  for (const p of ent.players.slice(0, 3)) {
    const lp = d.league?.players?.find((x) => x.id === p.id);
    const s = statsById.get(p.id)?.stats, r = d.ratings?.players?.find((x) => x.id === p.id);
    const leg = d.history?.legends?.find((l) => l.id === p.id);
    if (!lp && !leg) continue;
    const t = lp ? teamOf(lp.teamAbbr) : null;
    cards.push({
      type: "player", id: p.id, name: p.name,
      headshot: lp?.headshotSmall || lp?.headshot || `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${p.id}.png&w=96&h=70&scale=crop&cquality=80&location=origin`,
      team: t ? { abbr: t.abbr, logo: t.logo, color: t.color } : null,
      sub: lp ? [lp.position, t?.abbr].filter(Boolean).join(" · ") : `${leg.from}–${leg.to}`,
      line: s?.gp ? { label: "2026–27", ppg: +f1(s.pts), rpg: +f1(s.reb), apg: +f1(s.ast), gp: s.gp } : leg ? { label: "Career", ppg: +f1(leg.pts), rpg: +f1(leg.reb), apg: +f1(leg.ast), gp: leg.gp } : null,
      ovr: r?.ovr ?? null,
    });
  }
  const intents = intentsOf(question), asked = datesAsked(question, now), all = windowGames(d);
  let games = [];
  const historyOnly = (isRetiredQ(question) || intents.has("history")) && !intents.has("schedule") && !intents.has("scores") && !asked.length;
  if (historyOnly) games = [];
  else if (ent.teams.length) {
    for (const t of ent.teams) {
      const mine = all.filter((g) => g.home?.abbr === t.abbr || g.away?.abbr === t.abbr);
      const live = mine.find((g) => g.status?.state === "in");
      games.push(...(asked.length ? mine.filter((g) => asked.includes(g.ymd)) : [live || mine.filter((g) => g.status?.state === "post").slice(-1)[0], ...mine.filter((g) => g.status?.state === "pre").slice(0, live ? 1 : 1)]).filter(Boolean));
    }
  } else if (intents.has("schedule") || intents.has("scores") || asked.length) {
    const ymds = asked.length ? asked : [etDate(0, now)];
    games = all.filter((g) => ymds.includes(g.ymd));
  }
  const seen = new Set();
  for (const g of games) {
    if (seen.has(g.id) || seen.size >= 4) continue; seen.add(g.id);
    const side = (x) => ({ abbr: x?.abbr, logo: x?.logo, color: x?.color, score: x?.score ?? null, record: x?.record || "" });
    cards.push({ type: "game", id: g.id, day: dayLabel(g.ymd), state: g.status?.state, detail: g.status?.state === "pre" ? etTime(g.date) : g.status?.state === "post" ? "Final" : g.status?.shortDetail || "Live", away: side(g.away), home: side(g.home), broadcast: g.broadcast || "" });
  }
  return cards;
}
