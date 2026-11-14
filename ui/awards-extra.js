// Awards sub-tabs: "Weekly & Polls" and "2K27 Ratings". Rendered by awards.html.
import { avatar, teamLogo, esc } from "./avatar.js";
import { ATTRS } from "../service/ratings.js";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const nameKey = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ş/gi, "s").toLowerCase().replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
const ESPN_FROM_CODE = { NYK: "NY", SAS: "SA", GSW: "GS", NOP: "NO", UTA: "UTAH", WAS: "WSH" };
const logoOf = (abbr) => ({ abbr, logo: `https://a.espncdn.com/i/teamlogos/nba/500/${String(abbr).toLowerCase()}.png`, color: "#64748B" });
const f1 = (x) => (x == null || !Number.isFinite(+x) ? "—" : Number(x).toFixed(1));

/* ===================================================================== Weekly & Polls */
// Official 2026–27 Players of the Week, as supplied to Hooptrax. New winners are picked up from ESPN's news feed.
export const POW = [
  { week: 3, date: "2026-11-09", east: ["Jalen Brunson", "NYK"], west: ["Luka Dončić", "LAL"] },
  { week: 2, date: "2026-11-02", east: ["Jayson Tatum", "BOS"], west: ["Victor Wembanyama", "SAS"] },
  { week: 1, date: "2026-10-26", east: ["Tyrese Maxey", "PHI"], west: ["Ty Jerome", "MEM"] },
];
export const SCHEDULE = [
  ["Every Monday", "Players of the Week (East & West)", "Announced each Monday for the previous week."],
  ["Fridays", "NBA.com MVP Ladder", "Weekly ranking, updated most Fridays."],
  ["First week of Dec 2026", "Oct/Nov Players & Rookies of the Month", "East and West, plus Coaches of the Month."],
  ["Mid-Dec 2026", "1st Media MVP Straw Poll", "ESPN's first panel straw poll of the season."],
  ["Early Jan 2027", "December Players & Rookies of the Month", ""],
  ["Late Jan 2027", "All-Star starters announced", "Fan, player and media vote."],
  ["Early Feb 2027", "All-Star reserves announced", "Coaches' vote."],
  ["Mid-Feb 2027", "NBA All-Star Weekend", ""],
];
const HONOR_RE = /(players? of the (week|month)|rookies? of the month|mvp ladder|rookie ladder|straw poll|coach(es)? of the month)/i;

/** Pull honors from ESPN headlines; returns { items, pow } where pow is a parsed weekly winner pair (if any). */
export function scanHonors(news, players) {
  const items = (news || []).filter((n) => HONOR_RE.test(`${n.headline || ""} ${n.description || ""}`));
  const byName = new Map((players || []).map((p) => [nameKey(p.name), p]));
  const parsed = [];
  for (const n of items) {
    if (!/players? of the week/i.test(n.headline || "")) continue;
    const text = nameKey(`${n.headline} ${n.description || ""}`);
    const hits = [...byName.entries()].filter(([k]) => k.split(" ").length > 1 && text.includes(k)).map(([, p]) => p);
    const east = hits.find((p) => p.conference === "East"), west = hits.find((p) => p.conference === "West");
    if (east || west) parsed.push({ date: (n.published || "").slice(0, 10), east: east ? [east.name, east.teamAbbr] : null, west: west ? [west.name, west.teamAbbr] : null, source: n.url || null });
  }
  return { items, parsed };
}

let pollState = { results: {}, loading: false };
const voterId = () => { let v = store.get("polls:voter", null); if (!v) { v = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set("polls:voter", v); } return v; };

function personRow(name, abbr, players, extra = "") {
  const espnAbbr = ESPN_FROM_CODE[abbr] || abbr;
  const p = (players || []).find((x) => nameKey(x.name) === nameKey(name));
  const who = p || { name, initials: name.split(" ").map((w) => w[0]).join("").slice(0, 2) };
  return `<div class="pow-p"${p?.id ? ` data-player="${esc(p.id)}" role="button" tabindex="0"` : ""}>${avatar(who, { size: "3rem", color: "#64748B" })}
    <div class="pow-t"><b>${esc(name)}</b><span>${teamLogo(logoOf(espnAbbr), { size: "1rem" })}${esc(espnAbbr)}${extra}</span></div></div>`;
}

export function renderWeekly(el, { model, league, news, client, toast }) {
  const players = league?.players || [];
  const { items, parsed } = scanHonors(news, players);
  const weeks = POW.map((w) => ({ ...w, source: "official" }));
  for (const p of parsed) if (p.east && p.west && !weeks.some((w) => w.date >= p.date && nameKey(w.east[0]) === nameKey(p.east[0]))) weeks.unshift({ week: weeks[0].week + 1, date: p.date, east: p.east, west: p.west, source: "espn" });
  let wk = Math.min(store.get("weekly:wk", 0), weeks.length - 1);
  const ladder = (lad, label) => !lad?.leaders?.length ? `<div class="empty">The ${label} fills in once ESPN season stats load.</div>`
    : `<ol class="lad">${lad.leaders.map((e, i) => { const p = e.player; return `<li data-player="${esc(p.id)}" role="button" tabindex="0"><span class="lad-n">${i + 1}</span>${avatar(p, { size: "2.25rem", color: p.team?.color })}
      <span class="lad-t"><b>${esc(p.name)}</b><span>${esc(p.teamAbbr || "")}</span></span><span class="lad-s num">${f1(p.stats.pts)}<small>PTS</small> ${f1(p.stats.reb)}<small>REB</small> ${f1(p.stats.ast)}<small>AST</small></span></li>`; }).join("")}</ol>`;

  // polls: candidates from the live model
  const weekKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const conf = (c) => (model?.players || []).filter((p) => p.conference === c).sort((a, b) => b.score - a.score).slice(0, 5).map((p) => ({ player: p }));
  const POLLS = model ? [
    ["mvp-2026-27", "MVP", model.awards.mvp.leaders],
    ["roy-2026-27", "Rookie of the Year", model.awards.roy.leaders],
    ["dpoy-2026-27", "Defensive Player of the Year", model.awards.dpoy.leaders],
    [`pow-east-${mondayKey()}`, "Player of the Week · East", conf("East")],
    [`pow-west-${mondayKey()}`, "Player of the Week · West", conf("West")],
  ].filter(([, , l]) => l?.length) : [];
  void weekKey;
  const voted = store.get("polls:voted", {});
  const pollCard = ([id, title, list]) => {
    const r = pollState.results[id] || { counts: {}, total: 0 };
    const mine = voted[id];
    const show = !!mine;
    return `<section class="card poll" data-poll="${id}"><h4>${esc(title)}</h4>
      <ul class="poll-opts">${list.map((e) => { const p = e.player; const n = r.counts[p.id] || 0; const pc = r.total ? Math.round((n / r.total) * 100) : 0;
        return `<li><button class="poll-opt${mine === p.id ? " mine" : ""}" type="button" data-vote="${esc(p.id)}" ${show ? "disabled" : ""} aria-label="Vote ${esc(p.name)}">
          <span class="poll-bar" style="width:${show ? pc : 0}%"></span>${avatar(p, { size: "1.9rem", color: p.team?.color })}<span class="poll-n">${esc(p.name)}</span>${show ? `<span class="poll-pc num">${pc}%</span>` : ""}</button></li>`; }).join("")}</ul>
      <p class="poll-foot">${show ? `${r.total} vote${r.total === 1 ? "" : "s"} · thanks for voting` : "Tap to vote and see results"}</p></section>`;
  };

  const w = weeks[wk];
  el.innerHTML = `
    <div class="wk-grid">
      <section class="card pow">
        <div class="pow-head"><h4>Players of the Week</h4>
          <label class="sr-only" for="wkSel">Week</label>
          <select id="wkSel" class="wk-sel">${weeks.map((x, i) => `<option value="${i}" ${i === wk ? "selected" : ""}>Week ${x.week} · ${new Date(x.date + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</option>`).join("")}</select></div>
        <div class="pow-pair"><div><div class="pow-c">East</div>${personRow(w.east[0], w.east[1], players)}</div><div><div class="pow-c">West</div>${personRow(w.west[0], w.west[1], players)}</div></div>
        ${w.source === "espn" ? `<p class="poll-foot">Detected from ESPN news.</p>` : ""}
      </section>
      <section class="card"><h4>Upcoming Honors & Straw Poll Schedule</h4>
        <ul class="sched">${SCHEDULE.map(([when, what, note]) => `<li><span class="when">${esc(when)}</span><span class="what">${esc(what)}${note ? `<small>${esc(note)}</small>` : ""}</span></li>`).join("")}</ul>
        <p class="poll-foot">Expected windows; the league sets exact dates.</p></section>
    </div>
    ${items.length ? `<section class="card"><h4>Latest honors news</h4><ul class="news">${items.slice(0, 6).map((n) => `<li>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : esc(n.headline)}</li>`).join("")}</ul></section>` : ""}
    <div class="wk-grid">
      <section class="card"><h4>MVP Ladder</h4>${ladder(model?.awards?.mvp, "MVP Ladder")}</section>
      <section class="card"><h4>Rookie Ladder</h4>${ladder(model?.awards?.roy, "Rookie Ladder")}</section>
    </div>
    <h3 class="sub-h">Hooptrax Live Polls</h3>
    <div class="poll-grid">${POLLS.length ? POLLS.map(pollCard).join("") : `<div class="empty">Polls open once ESPN season stats load.</div>`}</div>
    <p class="fine">Ladders use the Hooptrax awards model on live ESPN stats. Poll votes are community votes on this site (one per poll per browser); they reset if the server is redeployed.</p>`;

  el.querySelector("#wkSel")?.addEventListener("change", (e) => { store.set("weekly:wk", +e.target.value); renderWeekly(el, { model, league, news, client, toast }); });
  el.querySelectorAll("[data-vote]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.closest("[data-poll]").dataset.poll, opt = b.dataset.vote;
    const v = store.get("polls:voted", {}); if (v[id]) return;
    try {
      const r = await fetch("/api/polls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ poll: id, option: opt, voter: voterId() }) });
      const body = await r.json().catch(() => ({}));
      if (body.data) pollState.results[id] = body.data;
      if (!r.ok && r.status !== 409) throw new Error(body.error || r.status);
    } catch {
      // static hosting / offline: count locally so the bar still responds
      const local = pollState.results[id] || { counts: {}, total: 0 };
      local.counts[opt] = (local.counts[opt] || 0) + 1; local.total++; pollState.results[id] = local;
      toast?.("Saved on this device (live poll server unavailable)");
    }
    v[id] = opt; store.set("polls:voted", v);
    renderWeekly(el, { model, league, news, client, toast });
  }));
  // live results (refresh when the view renders; cheap)
  if (POLLS.length && !pollState.loading) {
    pollState.loading = true;
    fetch(`/api/polls?ids=${POLLS.map((p) => p[0]).join(",")}`).then((r) => r.json()).then((b) => {
      const changed = JSON.stringify(b.data) !== JSON.stringify(Object.fromEntries(POLLS.map((p) => [p[0], pollState.results[p[0]]])));
      Object.assign(pollState.results, b.data || {});
      if (changed && el.isConnected && !el.hidden) renderWeekly(el, { model, league, news, client, toast });
    }).catch(() => {}).finally(() => { setTimeout(() => { pollState.loading = false; }, 15000); });
  }
}
function mondayKey(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10).replace(/-/g, "");
}

/* ===================================================================== 2K27 Ratings */
const SORTS = [["ovr", "Overall OVR"], ["shooting", "Shooting / 3PT"], ["playmaking", "Playmaking"], ["defense", "Defense"], ["finishing", "Finishing"], ["rebounding", "Rebounding"], ["risers", "Biggest Risers +"]];
const POS = ["All", "PG", "SG", "SF", "PF", "C"];
const MINS = [["0", "All"], ["90", "90+"], ["85", "85+"], ["80", "80+"]];
export const ovrBadge = (p, cls = "") => `<span class="ovr t-${p.tier} ${cls}" title="2K27 OVR${p.seeded ? " (official update)" : " (Hooptrax estimate)"}">${p.ovr}</span>`;
export const deltaPill = (d) => (d > 0 ? `<span class="delta up">+${d}</span>` : d < 0 ? `<span class="delta down">−${Math.abs(d)}</span>` : "");
const valOf = (p, sort) => (sort === "ovr" ? p.ovr : sort === "risers" ? p.delta : sort === "shooting" ? Math.round((p.attrs.shooting + p.attrs.threePt) / 2) : p.attrs[sort]);

export function attrBars(p) {
  return `<div class="attr-bars">${ATTRS.map(([k, l]) => `<div class="ab"><span class="ab-l">${l}</span><span class="ab-t"><span class="ab-f t-${p.attrs[k] >= 90 ? "dia" : p.attrs[k] >= 80 ? "rub" : p.attrs[k] >= 70 ? "ok" : "lo"}" style="width:${p.attrs[k]}%"></span></span><span class="ab-v num">${p.attrs[k]}</span></div>`).join("")}</div>`;
}

export function renderRatings(el, { ratings, sheet, openCompare, openPlayer }) {
  const st = store.get("ratings:ui", { tab: "players", q: "", team: "", pos: "All", sort: "ovr", min: "0" });
  let limit = 60;
  const save = () => store.set("ratings:ui", { ...st, q: "" });
  if (!ratings) { el.innerHTML = `<div class="card">${Array.from({ length: 8 }, () => `<div class="sk-row"><div class="sk c"></div><div class="sk-l"><div class="sk t"></div><div class="sk t s"></div></div><div class="sk n"></div></div>`).join("")}</div>`; return; }
  const teams = [...new Set(ratings.players.map((p) => p.teamAbbr).filter(Boolean))].sort();
  el.innerHTML = `
    <div class="rt-top"><span class="seg rt-tabs" id="rtTabs" style="--n:2"><span class="thumb" style="transform:translateX(${st.tab === "teams" ? 100 : 0}%)"></span>
      <button type="button" data-tab="players" aria-pressed="${st.tab === "players"}">Players</button><button type="button" data-tab="teams" aria-pressed="${st.tab === "teams"}">30 Teams</button></span>
      <span class="rt-note">${esc(ratings.note)}</span></div>
    <div id="rtBody"></div>`;
  const body = el.querySelector("#rtBody");
  function drawPlayers() {
    const q = st.q.trim().toLowerCase(), min = +st.min;
    let list = ratings.players.filter((p) => (!q || `${p.name} ${p.teamAbbr}`.toLowerCase().includes(q)) && (!st.team || p.teamAbbr === st.team) && (st.pos === "All" || p.pos === st.pos) && p.ovr >= min);
    list = list.slice().sort((a, b) => valOf(b, st.sort) - valOf(a, st.sort) || b.ovr - a.ovr);
    const lbl = SORTS.find((s) => s[0] === st.sort)[1].replace(" OVR", "").replace("Biggest Risers +", "+/−");
    body.innerHTML = `<section class="card rt-card">
      <div class="rt-filters">
        <input class="search" id="rtSearch" type="search" placeholder="Search players" value="${esc(st.q)}" autocomplete="off" aria-label="Search players" />
        <select id="rtTeam" class="wk-sel" aria-label="Team"><option value="">All teams</option>${teams.map((t) => `<option ${st.team === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
      <div class="pills" data-k="pos">${POS.map((p) => `<button type="button" data-v="${p}" aria-pressed="${st.pos === p}">${p}</button>`).join("")}</div>
      <div class="pills" data-k="sort">${SORTS.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${st.sort === k}">${l}</button>`).join("")}</div>
      <div class="pills" data-k="min">${MINS.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${st.min === k}">${l}</button>`).join("")}</div>
      <div class="rt-count">${list.length} players · sorted by ${esc(lbl)}</div>
      <ul class="rt-list">${list.slice(0, limit).map((p, i) => `<li><button class="rt-row" type="button" data-rt="${esc(p.id)}">
        <span class="rt-rank num">${i + 1}</span>${avatar(p, { size: "2.5rem", color: "#64748B" })}
        <span class="rt-who"><b>${esc(p.name)}</b><span>${teamLogo(logoOf(p.teamAbbr), { size: "0.95rem" })}${esc(p.teamAbbr)} · ${esc(p.pos)}</span></span>
        ${st.sort !== "ovr" ? `<span class="rt-attr num">${st.sort === "risers" ? (p.delta > 0 ? "+" : "") + p.delta : valOf(p, st.sort)}</span>` : ""}
        ${deltaPill(p.delta)}${ovrBadge(p)}</button></li>`).join("") || `<li class="empty">No players match. <button class="link" type="button" data-reset>Reset filters</button></li>`}</ul>
      ${list.length > limit ? `<button class="btn ghost press" type="button" id="rtMore" style="width:100%;margin-top:.5rem">Show more</button>` : ""}
    </section>`;
    const s = body.querySelector("#rtSearch");
    s.addEventListener("input", () => { st.q = s.value; limit = 60; const pos = s.selectionStart; drawPlayers(); const n = body.querySelector("#rtSearch"); n.focus(); n.setSelectionRange(pos, pos); });
    body.querySelector("#rtTeam").addEventListener("change", (e) => { st.team = e.target.value; save(); drawPlayers(); });
    body.querySelectorAll(".pills[data-k] button").forEach((b) => b.addEventListener("click", () => { st[b.parentElement.dataset.k] = b.dataset.v; limit = 60; save(); drawPlayers(); }));
    body.querySelector("#rtMore")?.addEventListener("click", () => { limit += 60; drawPlayers(); });
    body.querySelector("[data-reset]")?.addEventListener("click", () => { Object.assign(st, { q: "", team: "", pos: "All", min: "0" }); save(); drawPlayers(); });
    body.querySelectorAll("[data-rt]").forEach((b) => b.addEventListener("click", () => drawer(ratings.players.find((p) => p.id === b.dataset.rt))));
  }
  function drawTeams() {
    body.innerHTML = `<section class="card rt-card"><table class="rt-teams"><thead><tr><th>#</th><th>Team</th><th>OVR</th><th>OFF</th><th>DEF</th></tr></thead><tbody>
      ${ratings.teams.map((t, i) => `<tr data-team-hub="${esc(t.abbr)}"><td class="num">${i + 1}</td><td><span class="rt-team">${teamLogo(t, { size: "1.6rem" })}<span><b>${esc(t.name)}</b><small>Best: ${esc(t.best)}</small></span></span></td>
        <td>${ovrBadge({ ovr: t.overall, tier: t.overall >= 95 ? "gal" : t.overall >= 90 ? "dia" : t.overall >= 85 ? "ame" : t.overall >= 80 ? "rub" : "base", seeded: false })}</td><td class="num">${t.offense}</td><td class="num">${t.defense}</td></tr>`).join("")}</tbody></table>
      <p class="poll-foot">Team ratings weight each roster's top 10 by 2K27 OVR and attributes. Tap a team for its Team Vault.</p></section>`;
  }
  function drawer(p) {
    if (!p) return;
    sheet.open({
      title: "2K27 Ratings",
      render(b) {
        b.innerHTML = `<div class="rt-dh">${avatar(p, { size: "4.5rem", color: "#64748B", full: true })}<div><div class="qv-name">${esc(p.name)}</div>
          <div class="qv-sub">${teamLogo(logoOf(p.teamAbbr), { size: "1.1rem" })}${esc(p.teamAbbr)} · ${esc(p.pos)}${p.age ? ` · ${p.age} yrs` : ""}</div>
          <div class="qv-sub">${ovrBadge(p, "big")} ${deltaPill(p.delta)} <span class="muted small">${p.badges} badges · ${p.seeded ? "official Nov 2026 update" : "Hooptrax estimate"}</span></div></div></div>
          ${attrBars(p)}
          <div class="hub-actions"><button class="btn primary press" type="button" data-cmp>Compare</button><button class="btn ghost press" type="button" data-pcard>Player card</button></div>`;
        b.querySelector("[data-cmp]").addEventListener("click", () => openCompare?.(p.id));
        b.querySelector("[data-pcard]").addEventListener("click", () => openPlayer?.(p.id));
      },
    });
  }
  const tabs = el.querySelector("#rtTabs");
  tabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; st.tab = b.dataset.tab; save(); renderRatings(el, { ratings, sheet, openCompare, openPlayer }); });
  st.tab === "teams" ? drawTeams() : drawPlayers();
}
