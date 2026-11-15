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
            body.innerHTML = list.length ? `<ul class="list enc-results">${list.map((p) => `<li><button class="row press" type="button" data-enc="${esc(p.id)}">
                ${avatar({ name: p.name, headshot: p.headshot }, { size: "2.6rem", color: "#475569" })}
                <span class="meta"><span class="nm">${esc(p.name)}</span><span class="sub">${p.active ? `${esc(p.team)}${p.position ? ` · ${esc(p.position)}` : ""}` : p.years ? esc(p.years) : esc(p.team || "NBA")}</span></span>
                <span class="enc-tag ${p.active ? "act" : "leg"}">${p.active ? "Active" : p.active === false ? "Legend" : "NBA"}</span></button></li>`).join("")}</ul>`
              : `<div class="empty">No NBA player matches “${esc(q)}”.</div>`;
          } catch { if (seq === searchSeq) body.innerHTML = `<div class="empty">Search is unavailable right now.</div>`; }
        }, 140);
      },
    });
    if (initial) { const s = document.getElementById("sheetSearch"); if (s) { s.value = initial; sheet.refresh(); } }
    sheet.body.onclick = (e) => { const b = e.target.closest("[data-enc]"); if (b) openProfile(b.dataset.enc); };
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
      body.innerHTML = hero + shelf + acts + tabs + (S.tab === "log" && p.gameLog ? logTable(p) : statsTable(p));
    }
    function statsTable(p) {
      if (!p.seasons.length) return `<div class="empty">ESPN has no NBA season stats for this player.</div>`;
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

  return { openSearch, openProfile };
}
