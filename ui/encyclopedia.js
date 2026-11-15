// Player Encyclopedia: 🔍 in the header → instant search across active players, all-time legends and ESPN,
// then a full profile (bio hero, trophy shelf, season-by-season stats in four modes, last 15 games).
// Data: /api/players/search and /api/players/:id/full. Rendered in the app's shared bottom sheet.
import { avatar, esc } from "./avatar.js";
import { MODES, inMode } from "../service/player.js";

const FEATURED = [["5104157", "Victor Wembanyama"], ["3945274", "Luka Dončić"], ["1966", "LeBron James"], ["1035", "Michael Jordan"], ["110", "Kobe Bryant"], ["3456", "Derrick Rose"], ["3975", "Stephen Curry"]];
const ICON = { titles: "🏆", fmvp: "🏅", mvp: "👑", dpoy: "🛡️", roy: "🌟", smoy: "6️⃣", mip: "📈", allNba1: "🥇", allNba2: "🥈", allNba3: "🥉", allDef1: "🧱", allDef2: "🧱", asmvp: "⭐" };
const money = (m) => (m == null ? "—" : `$${m >= 10 ? Math.round(m * 10) / 10 : m.toFixed(2)}M`);
const f = (x, d = 1) => (x == null || x === "" ? "—" : typeof x === "number" ? (Number.isInteger(x) && d === 1 ? String(x) : x.toFixed(d)) : esc(x));
const pct = (x) => (x == null ? "—" : Number(x).toFixed(1));
const shortDate = (iso) => { const t = new Date(iso); return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" }); };
const ROLE_LABEL = { player: "Player Career", coach: "Coaching Career", exec: "Front Office / GM", owner: "Ownership" };
const ROLE_TAG = { player: "Player", coach: "Coach", exec: "Exec", owner: "Owner" };
/** Segmented role switcher (Player Career | Coaching Career | Front Office / GM | Ownership). */
const rolesBar = (roles, current) => (roles?.length > 1 ? `<div class="seg enc-roles" role="tablist" aria-label="Career" style="--n:${roles.length}">${roles.map((r) => `<button type="button" role="tab" data-role="${r}" aria-selected="${r === current}">${ROLE_LABEL[r]}</button>`).join("")}</div>` : "");
/** One search-result row (player or person). */
const wikiCards = new Map();   // id → Wikipedia bio card from the last searches
const WIKI_ROLE = { coach: "Coach", exec: "Front Office", owner: "Owner", player: "Player" };
export function resultRow(p) {
  if (p.kind === "wiki") {
    wikiCards.set(p.id, p);
    return `<li><button class="row press" type="button" data-wiki="${esc(p.id)}">
    ${avatar({ name: p.name, headshot: p.thumb }, { size: "2.6rem", color: "#475569" })}
    <span class="meta"><span class="nm">${esc(p.name)}</span><span class="sub">${esc(p.description || "NBA")}</span></span>
    <span class="enc-tag wiki">${esc(WIKI_ROLE[p.role] || "Bio")} · W</span></button></li>`;
  }
  const isPerson = p.kind === "person";
  const tag = isPerson ? p.roles.map((r) => ROLE_TAG[r]).join(" · ") : p.roles ? p.roles.map((r) => ROLE_TAG[r]).join(" · ") : p.active ? "Active" : p.active === false ? "Legend" : "NBA";
  const sub = isPerson ? (p.team ? `${esc(p.team)} · ` : "") + p.roles.map((r) => ROLE_LABEL[r].replace(" Career", "")).join(", ") : p.active ? `${esc(p.team)}${p.position ? ` · ${esc(p.position)}` : ""}` : p.years ? esc(p.years) : esc(p.team || "NBA");
  return `<li><button class="row press" type="button" ${isPerson ? `data-person="${esc(p.id)}"` : `data-enc="${esc(p.id)}"`}>
    ${avatar({ name: p.name, headshot: p.headshot || (p.playerId ? `https://a.espncdn.com/i/headshots/nba/players/full/${p.playerId}.png` : null) }, { size: "2.6rem", color: "#475569" })}
    <span class="meta"><span class="nm">${esc(p.name)}${p.unverified ? ' <span class="unv" title="Not confirmed for 2026–27">?</span>' : ""}</span><span class="sub">${sub}</span></span>
    <span class="enc-tag ${isPerson || p.roles ? "role" : p.active ? "act" : "leg"}">${tag}</span></button></li>`;
}
const yearsTxt = (ys) => (ys.length > 6 ? `${ys.slice(0, 3).join(", ")} … ${ys.slice(-2).join(", ")}` : ys.join(", "));

export function mountEncyclopedia({ sheet, openCompare = () => {}, toast = () => {} }) {
  let searchSeq = 0, timer = 0, logTimer = 0;
  const cache = new Map();

  /* ---------- search ---------- */
  function openSearch(initial = "") {
    sheet.open({
      title: "Player Search",
      searchable: true,
      placeholder: "Any NBA player, past or present",
      render(body, q) {
        clearTimeout(timer);
        if (q.length < 2) {
          body.innerHTML = `<p class="enc-hint">Search every active 2026–27 player and every legend since 1946.</p>
            <div class="enc-featured">${FEATURED.map(([id, name]) => `<button class="press" type="button" data-enc="${id}">${esc(name)}</button>`).join("")}</div>`;
          return;
        }
        if (!body.querySelector(".enc-results")) body.innerHTML = `<ul class="list enc-results"><li class="empty">Searching…</li></ul>`;
        const seq = ++searchSeq;
        timer = setTimeout(async () => {
          try {
            const r = await fetch(`/api/players/search?q=${encodeURIComponent(q)}`);
            const j = await r.json(); if (seq !== searchSeq || !sheet.isOpen) return;
            const list = j.data?.players || [];
            body.innerHTML = list.length ? `<ul class="list enc-results">${list.map(resultRow).join("")}</ul>`
              : `<div class="empty">No NBA player matches “${esc(q)}”.</div>`;
          } catch { if (seq === searchSeq) body.innerHTML = `<div class="empty">Search is unavailable right now.</div>`; }
        }, 140);
      },
    });
    if (initial) { const s = document.getElementById("sheetSearch"); if (s) { s.value = initial; sheet.refresh(); } }
    sheet.body.onclick = (e) => { const b = e.target.closest("[data-enc]"); if (b) return openProfile(b.dataset.enc); const pp = e.target.closest("[data-person]"); if (pp) return openPerson(pp.dataset.person); const w = e.target.closest("[data-wiki]"); if (w) openWiki(w.dataset.wiki); };
  }

  /* ---------- profile ---------- */
  async function load(id) {
    const hit = cache.get(id); if (hit && Date.now() - hit.at < 5 * 60e3) return hit.p;
    const r = await fetch(`/api/players/${encodeURIComponent(id)}/full`);
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Not found");
    cache.set(id, { at: Date.now(), p: j.data }); if (cache.size > 30) cache.delete(cache.keys().next().value);
    return j.data;
  }
  function openProfile(id) {
    const S = { p: null, tab: "stats", mode: "pg", err: "" };
    clearInterval(logTimer);
    sheet.open({
      title: "Player Profile",
      render(body) {
        body.onclick = (e) => {
          const t = e.target;
          const tb = t.closest("[data-etab]"); if (tb) { S.tab = tb.dataset.etab; draw(body); return; }
          const md = t.closest("[data-emode]"); if (md) { S.mode = md.dataset.emode; draw(body); return; }
          if (t.closest("[data-ecompare]")) { openCompare(String(id)); return; }
          if (t.closest("[data-eback]")) { openSearch(); return; }
          const rb = t.closest("[data-role]"); if (rb && S.p?.personId && rb.dataset.role !== "player") { openPerson(S.p.personId, { role: rb.dataset.role }); return; }
        };
        draw(body);
      },
      onClose() { clearInterval(logTimer); if (sheet.body) sheet.body.onclick = null; },
    });
    load(id).then((p) => { S.p = p; if (sheet.isOpen) draw(sheet.body); })
      .catch((e) => { S.err = e.message; if (sheet.isOpen) draw(sheet.body); });
    // live game log: refresh every 2 minutes while the profile is open
    logTimer = setInterval(async () => {
      if (!sheet.isOpen || !S.p?.active) return;
      try { cache.delete(id); const p = await load(id); if (S.p?.id === p.id) { S.p = p; if (S.tab === "log") draw(sheet.body); } } catch {}
    }, 120e3);

    function draw(body) {
      if (!body) return;
      if (S.err) { body.innerHTML = `<button class="link-back press" type="button" data-eback>‹ Search</button><div class="empty">${esc(S.err)}</div>`; return; }
      const p = S.p;
      if (!p) { body.innerHTML = `<div class="enc-hero"><div class="sk c" style="width:5.5rem;height:5.5rem;border-radius:99px"></div><div style="flex:1;display:grid;gap:.4rem"><div class="sk" style="height:1.4rem;width:70%"></div><div class="sk" style="height:.9rem;width:50%"></div></div></div><div class="sk" style="height:12rem;margin-top:1rem;border-radius:1rem"></div>`; return; }
      const badge = p.active && p.team ? `<span class="enc-team" style="--c:${esc(p.team.color || "#475569")}">${p.team.logo ? `<img src="${esc(p.team.logo)}" alt="" width="20" height="20" referrerpolicy="no-referrer">` : ""}${esc(p.team.code)}</span>`
        : `<span class="enc-team ret">${p.hof ? "🏛 Hall of Fame" : "Retired"}</span>`;
      const fact = (k, v) => (v ? `<div class="enc-fact"><small>${k}</small><b>${v}</b></div>` : "");
      const d = p.draft;
      const draftTxt = d?.year ? `${d.year} • Rd ${d.round} • Pick #${d.pick}${d.team ? ` (${esc(d.team)})` : ""}` : esc(d?.text || "Undrafted");
      const hero = `<button class="link-back press" type="button" data-eback>‹ Search</button>
        <div class="enc-hero">
          <div class="enc-face">${avatar({ name: p.name, headshot: p.headshot }, { size: "5.5rem", color: p.team?.color || "#475569", full: true })}${p.ovr ? `<span class="enc-ovr" title="NBA 2K27 OVR${p.ovr.official ? " (official)" : " (Hooptrax estimate)"}">${p.ovr.value}</span>` : ""}</div>
          <div class="enc-id"><h3>${esc(p.name)}</h3>
            <div class="enc-sub">${badge}${p.jersey ? `<span>#${esc(p.jersey)}</span>` : ""}${p.position ? `<span>${esc(p.position)}</span>` : ""}${p.height ? `<span>${esc(p.height)}</span>` : ""}${p.weight ? `<span>${esc(p.weight)}</span>` : ""}</div></div>
        </div>
        <div class="enc-facts">
          ${fact(p.active ? "Age" : "Born", p.active && p.age ? `${p.age}${p.dob ? ` <small>(${esc(p.dob)})</small>` : ""}` : esc(p.dob))}
          ${fact(p.college ? "College" : "From", esc(p.college || p.country || p.birthPlace))}
          ${fact("Draft", draftTxt)}
          ${fact("Years Pro", p.yearsPro ? `${p.yearsPro}${p.span ? ` <small>(${esc(p.span)})</small>` : ""}` : esc(p.span))}
          ${p.active ? fact("2026–27 Salary", p.salary ? `${money(p.salary.amount)}${p.salary.estimate ? " <small>est.</small>" : ""}` : "—") : ""}
          ${p.active && p.ovr ? fact("NBA 2K27 OVR", `${p.ovr.value}${p.ovr.official ? "" : " <small>est.</small>"}`) : ""}
        </div>`;
      const shelf = (p.trophies.length || p.retired.length) ? `<div class="enc-shelf" aria-label="Trophies and honors">
          ${p.trophies.map((t) => `<div class="tro ${t.key}" title="${esc(t.label)}: ${t.years.join(", ")}"><span class="tro-i">${ICON[t.key] || "🏆"}</span><b>${t.count > 1 ? `${t.count}×` : ""} ${esc(t.label)}</b><small>${esc(yearsTxt(t.years))}</small></div>`).join("")}
          ${p.retired.map((r) => `<div class="tro jersey" title="${r.upcoming ? `Ceremony scheduled ${r.date}` : `Retired${r.retiredOn ? ` ${r.retiredOn}` : ""}`}"><span class="tro-i num">#${esc(r.num)}</span><b>${r.upcoming ? "Retiring" : "Retired"} · ${esc(r.team === "NBA" ? "League-wide" : r.team)}</b><small>${esc(r.upcoming ? r.date : r.retiredOn ? r.retiredOn.slice(0, 7) : "jersey")}</small></div>`).join("")}
        </div><p class="enc-note">All-Star selections aren't in ESPN's free feeds; All-Star Game MVPs are shown.</p>` : "";
      const acts = `<div class="enc-acts"><button class="btn ghost press" type="button" data-ecompare>⚖️ Compare Player</button>${p.active && p.team ? `<a class="btn primary press" href="index.html#t=${encodeURIComponent(`${p.team.code},_`)}&a=${encodeURIComponent(`${p.team.code}:p${p.id}>_`)}">⇄ Load in Trade Machine</a>` : ""}</div>`;
      const tabs = `<div class="seg2 enc-tabs" role="tablist"><button type="button" role="tab" data-etab="stats" aria-selected="${S.tab === "stats"}">Career Stats</button><button type="button" role="tab" data-etab="log" aria-selected="${S.tab === "log"}" ${p.gameLog ? "" : "disabled"}>Game Log</button></div>`;
      body.innerHTML = hero + rolesBar(p.roles, "player") + shelf + acts + tabs + (S.tab === "log" && p.gameLog ? logTable(p) : statsTable(p));
    }
    function statsTable(p) {
      if (!p.seasons.length) return p.legendCareer ? careerCard(p.legendCareer) : `<div class="empty">ESPN has no NBA season stats for this player.</div>`;
      const m = S.mode;
      const cols = m === "adv" ? [["gp", "GP"], ["min", "MIN"], ["tsPct", "TS%"], ["efgPct", "eFG%"], ["astTo", "AST/TO"], ["gmsc", "GmSc"], ["fgPct", "FG%"], ["tpPct", "3P%"], ["ftPct", "FT%"]]
        : [["gp", "GP"], ["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["tov", "TOV"], ["fg", "FG"], ["fgPct", "FG%"], ["tp", "3PT"], ["tpPct", "3P%"], ["ft", "FT"], ["ftPct", "FT%"]];
      const cell = (k, v) => (v == null ? "—" : /Pct$/.test(k) ? pct(v) : k === "astTo" ? Number(v).toFixed(2) : typeof v !== "number" ? esc(v)
        : k === "gp" || m === "tot" ? v.toLocaleString("en-US") : v.toFixed(1));
      const row = (label, team, s, cls = "") => { const x = inMode(s, m); return `<tr class="${cls}"><th scope="row" class="c1">${label}</th><td class="c2">${team}</td>${cols.map(([k]) => `<td>${cell(k, x[k])}</td>`).join("")}</tr>`; };
      // ESPN adds a combined row (no team) for seasons split across teams: Basketball Reference calls it TOT
      const teamCell = (t) => (t ? `<span class="tm">${t.logo ? `<img src="${esc(t.logo)}" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer">` : ""}${esc(t.code)}</span>` : `<span class="tm tot" title="Season total across teams">TOT</span>`);
      const body = p.seasons.map((s) => row(esc(s.season), teamCell(s.team), s)).join("");
      const car = p.career;
      const totRow = car && m !== "tot" ? (() => { const x = inMode(car, "tot"); const tc = [["gp", "GP"], ["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["tov", "TOV"], ["fg", "FG"], ["fgPct", "FG%"], ["tp", "3PT"], ["tpPct", "3P%"], ["ft", "FT"], ["ftPct", "FT%"]];
        return m === "adv" ? "" : `<tr class="car tot"><th scope="row" class="c1">Career</th><td class="c2">Totals</td>${tc.map(([k]) => `<td>${/Pct$/.test(k) ? pct(x[k]) : typeof x[k] === "number" ? x[k].toLocaleString("en-US") : f(x[k])}</td>`).join("")}</tr>`; })() : "";
      const footer = car ? (m === "tot" ? row("Career", "Totals", car, "car") : row("Career", m === "p36" ? "Per 36" : m === "adv" ? "Adv." : "Averages", car, "car") + totRow) : "";
      return `<div class="seg enc-modes" role="group" aria-label="Stat mode" style="--n:4">${MODES.map(([k, l]) => `<button type="button" data-emode="${k}" aria-pressed="${m === k}">${l}</button>`).join("")}</div>
        <div class="enc-table-wrap" tabindex="0" aria-label="Season-by-season stats"><table class="enc-table">
          <thead><tr><th class="c1">Season</th><th class="c2">Team</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
          <tbody>${body}</tbody><tfoot>${footer}</tfoot></table></div>
        <p class="enc-note">Regular season, from ESPN. ${m === "adv" ? "TS% = PTS ÷ (2 × (FGA + 0.44 × FTA)); eFG% = (FGM + 0.5 × 3PM) ÷ FGA; GmSc = Hollinger Game Score per game." : m === "p36" ? "Per-game numbers scaled to 36 minutes." : ""}</p>`;
    }
    function logTable(p) {
      const g = p.gameLog;
      return `<div class="enc-table-wrap" tabindex="0" aria-label="Recent games"><table class="enc-table log">
          <thead><tr><th class="c1">Date</th><th class="c2">OPP</th><th>Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th><th>FG</th><th>3PT</th><th>FT</th></tr></thead>
          <tbody>${g.games.map((x) => `<tr><th scope="row" class="c1">${esc(shortDate(x.date))}</th><td class="c2"><span class="tm">${x.home ? "vs" : "@"} ${x.oppLogo ? `<img src="${esc(x.oppLogo)}" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer">` : ""}${esc(x.opp)}</span></td>
            <td class="res ${x.result === "W" ? "w" : x.result === "L" ? "l" : ""}">${esc(x.result)} ${esc(x.score)}</td><td>${f(x.min)}</td><td><b>${f(x.pts)}</b></td><td>${f(x.reb)}</td><td>${f(x.ast)}</td><td>${f(x.stl)}</td><td>${f(x.blk)}</td><td>${f(x.tov)}</td><td>${esc(x.fg)}</td><td>${esc(x.tp)}</td><td>${esc(x.ft)}</td></tr>`).join("")}</tbody></table></div>
        <p class="enc-note">Last ${g.games.length} games of the ${esc(g.season)} regular season, from ESPN (refreshes while open). ESPN's game log doesn't include +/-.</p>`;
    }
  }

  /* ---------- coaches, executives, owners (and the non-player eras of multi-role people) ---------- */
  const careerCard = (c) => `<div class="enc-facts">${[["Games", c.gp], ["PPG", c.pts], ["RPG", c.reb], ["APG", c.ast], ["Career points", c.totals?.pts?.toLocaleString("en-US")]].filter(([, v]) => v != null).map(([k, v]) => `<div class="enc-fact"><small>${k}</small><b>${typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(1)) : v}</b></div>`).join("")}</div>
    <p class="enc-note">Career totals from the Hooptrax legends archive; ESPN has no season-by-season line for this player.</p>`;
  const yearsChips = (label, ys, icon) => (ys?.length ? `<div class="tro" title="${esc(label)}: ${ys.join(", ")}"><span class="tro-i">${icon}</span><b>${ys.length > 1 ? `${ys.length}× ` : ""}${esc(label)}</b><small>${esc(yearsTxt(ys))}</small></div>` : "");
  const teamRow = (t, right = "", sub = "") => `<li class="pp-row"><img src="${esc(t.logo)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer"><span class="pp-who"><b>${esc(t.name)}</b>${sub ? `<small>${sub}</small>` : ""}</span><span class="pp-r">${right}</span></li>`;
  const pct3 = (x) => (x == null ? "—" : x.toFixed(3).replace(/^0/, ""));
  function personSection(p, role) {
    if (role === "player") {
      const pl = p.player || {};
      return `${pl.note ? `<p class="pp-lede">${esc(pl.note)}</p>` : ""}${pl.career ? careerCard(pl.career) : ""}${pl.span ? `<p class="enc-note">Playing career ${esc(pl.span)}.</p>` : ""}`;
    }
    if (role === "coach" && p.coach) {
      const c = p.coach, r = c.record;
      return `<div class="enc-facts">
          ${r ? `<div class="enc-fact"><small>Regular season</small><b>${r.w.toLocaleString("en-US")}–${r.l.toLocaleString("en-US")} <small>(${pct3(r.pct)})</small></b></div>` : ""}
          ${r?.pw != null ? `<div class="enc-fact"><small>Playoffs</small><b>${r.pw}–${r.pl} <small>(${pct3(r.playoffPct)})</small></b></div>` : ""}
          ${c.current ? `<div class="enc-fact"><small>2026–27 (live)</small><b>${c.current.w}–${c.current.l} <small>#${c.current.seed} ${esc(c.current.conf)}</small></b></div>` : ""}
          <div class="enc-fact"><small>Titles as coach</small><b>${c.titles.length}</b></div>
        </div>
        <div class="enc-shelf">${yearsChips("NBA Champion (coach)", c.titles, "🏆")}${yearsChips("Coach of the Year", c.coy, "📋")}</div>
        <h4 class="pp-h">Teams coached</h4><ul class="pp-list">${c.stints.map((s) => teamRow(s, esc(s.years), esc(s.note))).join("")}</ul>
        ${c.notes.length ? `<ul class="pp-notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        ${!r ? `<p class="enc-note">Career win–loss totals are shown for finished coaching careers; active coaches show this season's live record.</p>` : ""}`;
    }
    if (role === "exec" && p.exec) {
      const x = p.exec;
      return `<div class="enc-shelf">${yearsChips("Championships built", x.titles, "🏆")}${yearsChips("Executive of the Year", x.eoy, "🧠")}</div>
        <h4 class="pp-h">Front-office tenure</h4><ul class="pp-list">${x.stints.map((s) => teamRow(s, esc(s.years), esc(s.title))).join("")}</ul>
        ${x.notes.length ? `<h4 class="pp-h">Signature moves</h4><ul class="pp-notes">${x.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
    }
    if (role === "owner" && p.owner) {
      const o = p.owner;
      return `<div class="enc-shelf">${yearsChips("Titles as owner", o.titles, "🏆")}</div>
        <h4 class="pp-h">Franchises owned</h4><ul class="pp-list">${o.teams.map((s) => teamRow(s, esc(s.years), [s.price && `Purchase: ${esc(s.price)}`, esc(s.note)].filter(Boolean).join(" · "))).join("")}</ul>`;
    }
    return `<div class="empty">No details for this role yet.</div>`;
  }
  const people = new Map();
  async function loadPerson(id) {
    if (people.has(id)) return people.get(id);
    const r = await fetch(`/api/people/${encodeURIComponent(id)}`); const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Not found");
    people.set(id, j.data); return j.data;
  }
  function openPerson(id, { role = null } = {}) {
    const S = { p: null, role, err: "" };
    clearInterval(logTimer);
    sheet.open({
      title: "Profile",
      render(body) {
        body.onclick = (e) => {
          if (e.target.closest("[data-eback]")) { openSearch(); return; }
          const rb = e.target.closest("[data-role]"); if (!rb || !S.p) return;
          if (rb.dataset.role === "player" && S.p.player?.playerId) { openProfile(S.p.player.playerId); return; }
          S.role = rb.dataset.role; draw(body);
        };
        draw(body);
      },
      onClose() { if (sheet.body) sheet.body.onclick = null; },
    });
    loadPerson(id).then((p) => { S.p = p; S.role ||= p.roles.find((r) => r !== "player") || p.roles[0]; if (sheet.isOpen) draw(sheet.body); })
      .catch((e) => { S.err = e.message; if (sheet.isOpen) draw(sheet.body); });
    function draw(body) {
      if (!body) return;
      if (S.err) { body.innerHTML = `<div class="empty">${esc(S.err)}</div>`; return; }
      const p = S.p;
      if (!p) { body.innerHTML = `<div class="enc-hero"><div class="sk c" style="width:5.5rem;height:5.5rem;border-radius:99px"></div><div style="flex:1;display:grid;gap:.4rem"><div class="sk" style="height:1.4rem;width:70%"></div></div></div>`; return; }
      body.innerHTML = `<div class="enc-hero"><div class="enc-face">${avatar({ name: p.name, headshot: p.headshot }, { size: "5rem", color: "#475569", full: true })}</div>
          <div class="enc-id"><h3>${esc(p.name)}</h3><div class="enc-sub">${p.roles.map((r) => `<span class="enc-team role">${ROLE_TAG[r]}</span>`).join("")}</div></div></div>
        ${rolesBar(p.roles, S.role)}${personSection(p, S.role)}
        ${p.meta?.generated ? `<p class="enc-note">${p.meta.verified ? "Directory entry" : 'Directory entry, <span class="unv">?</span> not confirmed against 2026–27 reporting'}${p.meta.source ? ` · Source: ${esc(p.meta.source)}` : ""}${p.meta.note ? ` · ${esc(p.meta.note)}` : ""}. Full career history isn't in the archive yet.</p>` : ""}
        <p class="enc-note">Coaching, front-office and ownership details are editorial (nba_people.json); current head coaches and records come live from ESPN.</p>`;
    }
  }

  /** Bio card for a Wikipedia fallback result: everything shown is quoted or read from the Wikipedia summary. */
  function openWiki(id) {
    const c = wikiCards.get(id); if (!c) return;
    const f = c.facts || {};
    sheet.open({
      title: "Profile",
      render(body) {
        body.innerHTML = `<div class="enc-hero"><div class="enc-face">${avatar({ name: c.name, headshot: c.thumb }, { size: "5rem", color: "#475569", full: true })}</div>
          <div class="enc-id"><h3>${esc(c.name)}</h3><div class="enc-sub">${c.role ? `<span class="enc-team role">${esc(WIKI_ROLE[c.role])}</span>` : ""}<span class="enc-team">${esc(c.description || "")}</span></div></div></div>
          <div class="enc-facts">${f.span ? `<div class="enc-fact"><small>Years mentioned</small><b>${esc(f.span)}</b></div>` : ""}<div class="enc-fact"><small>NBA teams named</small><b>${(f.teams || []).length}</b></div></div>
          ${(f.teams || []).length ? `<h4 class="pp-h">Teams</h4><ul class="pp-list">${f.teams.map((t) => `<li class="pp-row"><img src="https://a.espncdn.com/i/teamlogos/nba/500/${({ GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" })[t.code] || t.code.toLowerCase()}.png" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer"><span class="pp-who"><b>${esc(t.name)}</b></span></li>`).join("")}</ul>` : ""}
          ${f.titles ? `<h4 class="pp-h">Championships</h4><p class="pp-lede">${esc(f.titles)}</p>` : ""}
          <h4 class="pp-h">Bio</h4><p class="pp-lede">${esc(c.extract)}</p>
          <p class="enc-note">From Wikipedia, not yet in the Hooptrax archive. Teams and years are read from the summary text. <a href="${esc(c.url)}" target="_blank" rel="noopener">Read on Wikipedia ›</a></p>`;
      },
    });
  }

  return { openSearch, openProfile, openPerson, openWiki };
}
