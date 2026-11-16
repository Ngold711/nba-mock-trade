// Awards → History: all-time leaders (career + single-season), awards & champions timeline, draft archive.
import { avatar, esc } from "./avatar.js";

const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
/** Pill → stat key. Each key reads only its own list (careerLeaders[key] / singleSeason[key]); never by position. */
const CATS = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"], ["tpm", "3-Pointers"]];
const UNIT = { pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", tpm: "3PM" };
/** The four Archive sections, in the same order as the Archive quick links. */
export const HIST_TABS = [["leaders", "All-Time Leaders"], ["awards", "Champions & Awards"], ["retired", "Retired Jerseys"], ["draft", "Draft History"]];
const SLUG = { GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" };
const TEAM_NAMES = { ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets", CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards" };
const AWARDS = [["champ", "Champion"], ["fmvp", "Finals MVP"], ["mvp", "MVP"], ["roy", "Rookie of the Year"], ["dpoy", "Defensive POY"], ["smoy", "Sixth Man"], ["mip", "Most Improved"], ["coy", "Coach of the Year"]];
const SHORT = { champ: "Champion", fmvp: "Finals MVP", mvp: "MVP", roy: "ROY", dpoy: "DPOY", smoy: "6MOY", mip: "MIP", coy: "COY" };
const n0 = (x) => (x == null ? "—" : Number(x).toLocaleString("en-US"));
const espnHs = (id) => (/^\d+$/.test(String(id || "")) ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : null);
const nbaHs = (nba) => (nba ? `https://cdn.nba.com/headshots/nba/latest/260x190/${nba}.png` : null);
/** Official NBA.com headshot first (legends like Reggie Miller have no ESPN photo), ESPN second, then initials. */
const face = (r) => ({ name: r.name, headshotSmall: nbaHs(r.nbaId) || espnHs(r.id), headshotAlt: r.nbaId ? espnHs(r.id) : null });

let UI = null;           // UI state lives in memory between renders; tabs/filters are also saved
export function renderHistory(el, { history, tab = null, cat = null } = {}) {
  if (!history) { el.innerHTML = `<section class="card">${Array.from({ length: 6 }, () => `<div class="sk-row"><div class="sk c"></div><div class="sk-l"><div class="sk t"></div><div class="sk t s"></div></div><div class="sk n"></div></div>`).join("")}</section>`; return; }
  const st = (UI ||= store.get("history:ui", { tab: "leaders", scope: "career", cat: "pts", award: "all", q: "", draftQ: "" }));
  if (tab) st.tab = tab;                                   // Archive links open a specific section
  if (cat && UNIT[cat]) { st.cat = cat; st.scope = "career"; }
  if (!UNIT[st.cat]) st.cat = "pts";
  st.q ??= ""; st.draftQ ??= ""; st.award ??= "all"; st.scope ??= "career";
  const save = () => store.set("history:ui", { ...st, q: "", draftQ: "" });
  const ids = new Map((history.legends || []).map((l) => [l.name, l.id]));

  function timeline() {
    const rows = [];
    for (const c of history.champions) {
      rows.push({ year: c.year, award: "champ", name: c.champion, detail: `def. ${c.runnerUp} ${c.series}`, verified: true });
      if (c.fmvp) rows.push({ year: c.year, award: "fmvp", name: c.fmvp, detail: c.champion, verified: c.fmvpVerified !== false });
    }
    for (const [k, list] of Object.entries(history.awards)) for (const a of list) rows.push({ year: a.year, award: k, name: a.name, detail: a.team || "", verified: k === "coy" ? null : a.verified !== false });
    return rows;
  }
  const ALL = timeline();

  const tabs = `<div class="pills hist-tabs" role="tablist">${HIST_TABS.map(([k, l]) => `<button type="button" data-ht="${k}" aria-pressed="${st.tab === k}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (st.tab === "leaders") {
    const isCareer = st.scope === "career";
    const cat = CATS.find(([k]) => k === st.cat) || CATS[0];
    const key = cat[0];
    const list = (isCareer ? history.careerLeaders : history.singleSeason)?.[key] || [];
    body = `<section class="card hist-card">
      <div class="hist-bar"><span class="seg hist-scope" style="--n:2"><span class="thumb" style="transform:translateX(${isCareer ? 0 : 100}%)"></span><button type="button" data-scope="career" aria-pressed="${isCareer}">Career</button><button type="button" data-scope="single" aria-pressed="${!isCareer}">Single Season</button></span></div>
      <div class="pills" data-hk="cat">${CATS.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${st.cat === k}">${l}</button>`).join("")}</div>
      <h4 class="hist-h" id="histStat">${isCareer ? "Career" : "Single-season"} ${esc(cat[1])} · ${UNIT[key]}</h4>
      <ol class="hist-list" data-stat="${key}">${(list || []).map((r, i) => `<li><button class="hist-row" type="button" data-player="${esc(r.id)}" data-name="${esc(r.name)}">
        <span class="hr-rank num">${i + 1}</span>${avatar(face(r), { size: "2.25rem", color: "#64748B" })}
        <span class="hr-who"><b>${esc(r.name)}</b><span>${isCareer ? `${n0(r.gp)} games${r.active ? ' · <em class="act">Active · live</em>' : ""}` : `${esc(r.season)} · ${r.gp} games`}</span></span>
        <span class="hr-v num">${isCareer ? n0(r.total) : key === "tpm" ? r.value : Number(r.value).toFixed(1)}<small>${isCareer ? `${UNIT[key]} · ${r.perGame ?? "—"}/g` : key === "tpm" ? "3PM" : `${UNIT[key]} per game`}</small></span></button></li>`).join("")}</ol>
      ${isCareer ? `<p class="poll-foot">Regular-season totals from ESPN, live for active players. Pre-1974 rebound totals are official NBA figures (ESPN's feed starts later). Steals and blocks have been tracked since 1973–74; threes since 1979–80.</p>`
        : `<p class="poll-foot">Since 1975–76 from ESPN season data (min. 70% of games). Marquee earlier records:</p>
           <ul class="pre75">${history.pre75.map(([k, n, s, v]) => `<li><b>${esc(n)}</b> · ${esc(s)} · ${typeof v === "number" ? `${v} ${k}` : esc(v)}</li>`).join("")}</ul>`}
    </section>`;
  } else if (st.tab === "awards") {
    const q = st.q.trim().toLowerCase();
    const rows = ALL.filter((r) => (st.award === "all" || r.award === st.award) && (!q || `${r.year} ${r.name} ${r.detail}`.toLowerCase().includes(q)))
      .sort((a, b) => b.year - a.year || AWARDS.findIndex(([k]) => k === a.award) - AWARDS.findIndex(([k]) => k === b.award));
    const byYear = new Map(); rows.slice(0, 400).forEach((r) => (byYear.get(r.year) || byYear.set(r.year, []).get(r.year)).push(r));
    body = `<section class="card hist-card">
      <input class="search" id="histQ" type="search" placeholder="Search a year, player, coach or team" value="${esc(st.q)}" autocomplete="off" style="font-size:16px;margin:0" aria-label="Search awards" />
      <div class="pills" data-hk="award"><button type="button" data-v="all" aria-pressed="${st.award === "all"}">All</button>${AWARDS.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${st.award === k}">${l}</button>`).join("")}</div>
      <div class="hist-count">${rows.length} entries${rows.length > 400 ? " · showing the latest 400" : ""}</div>
      <div class="tl-years">${[...byYear.entries()].map(([y, list]) => `<div class="tl-year"><b class="num">${y}</b><ul>${list.map((r) => `<li><span class="aw ${r.award}">${SHORT[r.award]}</span><span class="tl-n">${r.award === "champ" || r.award === "coy" || !ids.get(r.name) ? esc(r.name) : `<button class="link" type="button" data-player="${esc(ids.get(r.name))}" data-name="${esc(r.name)}">${esc(r.name)}</button>`}</span><span class="tl-d">${esc(r.detail)}${r.verified === false ? ' <span title="Not confirmed by the ESPN award record">*</span>' : ""}</span></li>`).join("")}</ul></div>`).join("") || `<div class="empty">Nothing matches.</div>`}</div>
      <p class="poll-foot">Player awards and Finals MVPs are checked against ESPN award records (* = ESPN has no record to confirm). Coach of the Year is editorial. 1948 champion Baltimore Bullets is a defunct franchise.</p>
    </section>`;
  } else if (st.tab === "retired") {
    const fr = Object.entries(history.franchises || {}).sort((a, b) => (TEAM_NAMES[a[0]] || a[0]).localeCompare(TEAM_NAMES[b[0]] || b[0]));
    const total = fr.reduce((s, [, f]) => s + (f.retired || []).length, 0);
    body = `<section class="card hist-card rj-card">
      <p class="enc-note" style="margin-top:0">${total} retired numbers across all 30 franchises. League-wide: ${(history.leagueRetired || []).map((r) => `#${esc(r.num)} ${esc(r.name)} (${esc(r.note || "")})`).join(", ")}.</p>
      <ul class="rj-teams">${fr.map(([code, f]) => `<li class="rj-team"><div class="rj-head"><img src="https://a.espncdn.com/i/teamlogos/nba/500/${SLUG[code] || code.toLowerCase()}.png" alt="" width="26" height="26" loading="lazy" referrerpolicy="no-referrer"><b>${esc(TEAM_NAMES[code] || code)}</b><span class="rj-n">${(f.retired || []).length}</span><button class="link" type="button" data-team-hub="${esc(code)}">Vault ›</button></div>
        ${(f.retired || []).length ? `<ul class="rj-nums">${f.retired.map((r) => `<li><span class="rj-num num">${esc(r.num)}</span><span class="rj-who"><b>${esc(r.name)}</b><small>${esc(r.years || "")}${r.retiredOn ? ` · retired ${esc(r.retiredOn)}` : ""}${r.hof ? " · Hall of Fame" : ""}</small></span></li>`).join("")}</ul>` : `<p class="rj-none">No retired numbers yet.</p>`}
        ${(f.upcomingRetirements || []).length ? `<p class="rj-up">Coming: ${f.upcomingRetirements.map((u) => `#${esc(u.num)} ${esc(u.name)} (${esc(u.date)})`).join(", ")}</p>` : ""}</li>`).join("")}</ul>
      <p class="poll-foot">Years are each player's seasons with the franchise. Audited against team announcements, Nov 2026.</p>
    </section>`;
  } else {
    const q = st.draftQ.trim().toLowerCase();
    const d = history.draft;
    const no1 = d.no1.filter((p) => !q || `${p.year} ${p.name} ${p.team} ${p.from}`.toLowerCase().includes(q));
    const steals = d.steals.filter((p) => !q || `${p.year} ${p.name} ${p.team}`.toLowerCase().includes(q));
    body = `<section class="card hist-card">
      <input class="search" id="draftQ" type="search" placeholder="Search a year, player or team" value="${esc(st.draftQ)}" autocomplete="off" style="font-size:16px;margin:0" aria-label="Search drafts" />
      ${!q && d.top2026?.length ? `<h4 class="hist-h">2026 Draft · lottery picks</h4><ol class="d26">${d.top2026.map((p) => `<li><span class="num">${p.pick}</span><b>${esc(p.name)}</b><small>${esc(p.draftedBy)}${p.college ? ` · ${esc(p.college)}` : ""}</small></li>`).join("")}</ol>` : ""}
      <h4 class="hist-h">#1 picks since the first lottery (1985)</h4>
      <ul class="d1">${no1.map((p) => `<li><b class="num">${p.year}</b><span><button class="link" type="button" data-player="${esc(ids.get(p.name) || "")}" data-name="${esc(p.name)}">${esc(p.name)}</button> · ${esc(p.team)} · ${esc(p.from)}${p.note ? `<small>${esc(p.note)}</small>` : ""}</span></li>`).join("") || `<li class="empty">No matches.</li>`}</ul>
      <h4 class="hist-h">Notable steals</h4>
      <ul class="d1">${steals.map((p) => `<li><b class="num">${p.year}</b><span>${esc(p.name)} · <span class="num">#${p.pick}</span> by ${esc(p.team)}</span></li>`).join("") || `<li class="empty">No matches.</li>`}</ul>
      <p class="poll-foot">Draft slots are checked against ESPN draft records. Lottery notes are editorial.</p>
    </section>`;
  }
  el.innerHTML = tabs + body;
  el.querySelectorAll("[data-ht]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.ht; save(); renderHistory(el, { history }); }));
  el.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { st.scope = b.dataset.scope; save(); renderHistory(el, { history }); }));
  el.querySelectorAll("[data-hk] [data-v]").forEach((b) => b.addEventListener("click", () => { st[b.parentElement.dataset.hk] = b.dataset.v; save(); renderHistory(el, { history }); }));
  const live = (id, key) => { const i = el.querySelector(id); if (!i) return; i.addEventListener("input", () => { st[key] = i.value; const pos = i.selectionStart; renderHistory(el, { history }); const n = el.querySelector(id); n.focus(); n.setSelectionRange(pos, pos); }); };
  live("#histQ", "q"); live("#draftQ", "draftQ");
}
