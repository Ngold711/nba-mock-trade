// "Ask Hooptrax": NBA-only assistant.
//   findEntities()  players / teams / years mentioned in a question
//   buildContext()  compact, question-targeted facts from the live cache + nba_history.json (for Gemini grounding)
//   localAnswer()   zero-API-key engine that answers common NBA questions straight from the same data
// Pure: the server passes in the data it has cached.
import { TIERS, teamTier, money, resolveSalary } from "./trade.js";

export const SYSTEM_PROMPT = `You are "Ask Hooptrax", the NBA assistant inside the Hooptrax app (live NBA trade machine, 3-2-1 lottery simulator, draft hub, awards and history).
Rules:
1. Only answer questions about NBA basketball (players, teams, games, stats, standings, injuries, trades, contracts and the salary cap, the draft and lottery, awards, history, and Hooptrax features). For anything else, reply in one short sentence that you only cover the NBA, and suggest an NBA question instead.
2. Ground every fact in the DATA block when it covers the question. It is live (ESPN feeds plus Hooptrax models) and newer than your training. If the data doesn't cover something, say so briefly instead of guessing; never invent scores, stats, injuries or contracts.
3. Hooptrax 2K27 ratings are estimates except where marked as from the official update; salaries marked "est." are estimates; cap thresholds are 2026–27 projections. Say so when it matters.
4. Be concise and scannable: short paragraphs or bullets, at most about 150 words unless asked for more. Use full player and team names so the app can link them. No markdown tables.`;

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

export function findEntities(text, idx) {
  const q = ` ${norm(text)} `;
  const players = [];
  for (const p of idx.players) if (q.includes(` ${p.key} `)) players.push(p);
  if (!players.length) for (const p of idx.players) if (p.last && p.last.length > 3 && idx.uniqueLast(p.last) && q.includes(` ${p.last} `)) players.push(p);
  const teams = [];
  for (const t of idx.teams) if (t.keys.some((k) => q.includes(` ${k} `) && !(k === "jazz" && false))) teams.push(t);
  // ambiguous one-word city keys ("los angeles") match both LA teams; keep the explicit name match when present
  const years = [...q.matchAll(/\b(19[4-9]\d|20[0-3]\d)\b/g)].map((m) => +m[1]);
  return { players: dedupe(players).slice(0, 4), teams: dedupe(teams, "abbr").slice(0, 3), years };
}
const dedupe = (arr, k = "id") => arr.filter((x, i) => arr.findIndex((y) => y[k] === x[k]) === i);

const isNba = (q) => /\b(nba|basketball|hoop|player|team|game|games|score|scores|tonight|today|standings?|seed|playoffs?|injur|trade|salary|contract|cap|apron|draft|lottery|prospect|rookie|mvp|roy|dpoy|award|champion|finals|title|ring|retired|jersey|record|stats?|points|rebounds|assists|steals|blocks|three|2k|rating|ovr|coach|all.?star|leader|hooptrax|stepien|tank|odds)\b/i.test(q);

/** Facts for the model, targeted at the question. */
export function buildContext(question, d, idx) {
  const ent = findEntities(question, idx);
  const out = [];
  const today = (d.scoreboard?.games || []).map((g) => `${g.away?.abbr} ${g.away?.score ?? ""} @ ${g.home?.abbr} ${g.home?.score ?? ""} (${g.status?.shortDetail || g.status?.state})`);
  out.push(`TODAY'S GAMES (${new Date().toISOString().slice(0, 10)}): ${today.join("; ") || "none"}`);
  for (const conf of d.standings?.conferences || []) out.push(`${conf.abbr || conf.name} STANDINGS: ${conf.teams.map((t) => `${t.seed}.${t.team.abbr} ${t.wins}-${t.losses}`).join(", ")}`);
  if (d.lottery) out.push(`3-2-1 LOTTERY PROJECTION (seed: team, #1 odds, top-4, floor): ${d.lottery.slice(0, 16).map((r) => `${r.seed}:${r.team} ${(r.p1 * 100).toFixed(1)}% ${(r.top4 * 100).toFixed(0)}% #${r.floor}`).join(", ")}. Seeds 1-3 are draft-relegated (2 balls, floor #12). All 16 picks drawn.`);
  out.push(`RECENT INJURIES: ${(d.injuries || []).slice(0, 25).map((i) => `${i.athlete?.name} (${i.team?.abbr}) ${i.status}${i.injury ? " – " + i.injury : ""}`).join("; ")}`);
  out.push(`RECENT TRANSACTIONS: ${(d.transactions || []).slice(0, 12).map((t) => `${t.team?.abbr}: ${t.description}`).join(" | ")}`);
  out.push(`2K27 TOP 20 (Hooptrax; * = official Nov 2026 update): ${(d.ratings?.players || []).slice(0, 20).map((p) => `${p.name} ${p.ovr}${p.seeded ? "*" : ""}`).join(", ")}`);
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
    if (f) out.push(`HISTORY ${t.name}: ${f.titles.length} titles${f.titles.length ? ` (${f.titles.map((x) => x.year).join(", ")})` : ""}; retired numbers: ${f.retired.map((r) => `#${r.num} ${r.name}`).join(", ") || "none"}.`);
  }
  for (const y of ent.years) {
    const c = d.history?.champions?.find((x) => x.year === y);
    const aw = Object.entries(d.history?.awards || {}).map(([k, list]) => { const a = list.filter((x) => x.year === y).map((x) => x.name); return a.length ? `${k.toUpperCase()}: ${a.join(" & ")}` : ""; }).filter(Boolean);
    const n1 = d.history?.draft?.no1?.find((x) => x.year === y);
    out.push(`SEASON ${y}: ${c ? `champion ${c.champion} def. ${c.runnerUp} ${c.series}${c.fmvp ? `, Finals MVP ${c.fmvp}` : ""}; ` : ""}${aw.join("; ")}${n1 ? `; #1 pick ${n1.name} (${n1.team})` : ""}`);
  }
  if (/all.?time|career|most (points|rebounds|assists|steals|blocks|threes)|leader/i.test(question) && d.history) {
    for (const [c, l] of d.history.careerCategories) out.push(`CAREER ${l.toUpperCase()} TOP 10: ${d.history.careerLeaders[c].slice(0, 10).map((r) => `${r.name} ${r.total}`).join(", ")}`);
  }
  if (/draft|prospect|2027|2028|2029|mock/i.test(question) && d.prospects) for (const y of ["2027", "2028", "2029"]) out.push(`${y} BIG BOARD TOP 10: ${(d.prospects[y] || []).slice(0, 10).map((p) => `${p.rank}. ${p.name} (${p.position}, ${p.school || p.type})`).join("; ")}`);
  if (/champion|title|finals|ring/i.test(question) && d.history) out.push(`RECENT CHAMPIONS: ${d.history.champions.slice(0, 12).map((c) => `${c.year} ${c.champion}${c.fmvp ? ` (FMVP ${c.fmvp})` : ""}`).join("; ")}`);
  if (/mvp|rookie|defensive|sixth|improved|coach of/i.test(question) && d.history) for (const k of ["mvp", "roy", "dpoy", "smoy", "mip", "coy"]) out.push(`${k.toUpperCase()} last 8: ${(d.history.awards[k] || []).slice(0, 8).map((a) => `${a.year} ${a.name}`).join("; ")}`);
  if (/cap|apron|tax|salary|contract|payroll/i.test(question) && d.book?.cba) { const c = d.book.cba; out.push(`2026-27 CAP (projected): cap ${money(c.salaryCap)}, tax ${money(c.taxLine)}, 1st apron ${money(c.firstApron)}, 2nd apron ${money(c.secondApron)}.`); }
  return { text: out.join("\n"), entities: ent };
}

/* ------------------------------------------------------------------ local engine */
export function localAnswer(question, d, idx) {
  const q = String(question || "");
  const ent = findEntities(q, idx);
  const L = [];
  const has = (re) => re.test(q);
  if (!ent.players.length && !ent.teams.length && !isNba(q)) {
    return { text: "I only cover the NBA. Try something like “Who's playing tonight?”, “What's Victor Wembanyama's 2K27 rating?” or “Who has the best lottery odds?”", entities: ent, refused: true };
  }
  const statsById = new Map((d.stats?.players || []).map((p) => [p.id, p]));
  const standingOf = (abbr) => { for (const c of d.standings?.conferences || []) for (const x of c.teams) if (x.team.abbr === abbr) return { ...x, conf: c.abbr || c.name }; return null; };

  if (has(/\b(tonight|today|score|scores|games?|playing)\b/i) && !ent.players.length) {
    const games = d.scoreboard?.games || [];
    L.push(games.length ? `**Today's games (${games.length}):**` : "No games on today's ESPN scoreboard.");
    for (const g of games) L.push(`• ${g.away?.displayName || g.away?.abbr} ${g.away?.score ?? ""} @ ${g.home?.displayName || g.home?.abbr} ${g.home?.score ?? ""} — ${g.status?.shortDetail || g.status?.state}`);
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
    if (has(/retired|jersey|number/i) && f) lines.push(f.retired.length ? `Retired numbers: ${f.retired.map((r) => `#${r.num} ${r.name}`).join(", ")}` : "No retired numbers.");
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
  if (!L.length) L.push("I can answer from live Hooptrax data: tonight's games, standings, injuries, the 3-2-1 lottery, 2027–2029 prospects, 2K27 ratings, salaries and the cap, retired numbers, champions and award winners. Name a player or team to get started.");
  return { text: L.join("\n\n"), entities: ent };
}

/** Player/team chips for the UI: anything in the index that appears in the answer text. */
export function chipsFor(text, idx, entities) {
  const found = findEntities(text, idx);
  const players = dedupe([...(entities?.players || []), ...found.players]).slice(0, 8);
  const teams = dedupe([...(entities?.teams || []), ...found.teams], "abbr").slice(0, 6);
  return [...players.map((p) => ({ type: "player", id: p.id, label: p.name })), ...teams.map((t) => ({ type: "team", id: t.code, label: t.name }))];
}
