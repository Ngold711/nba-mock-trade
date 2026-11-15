// Front-Office Team Vault, Player Quick-View (with 2K27 OVR) and Player-vs-Player Compare.
// Mounted by the shell; every page gets them through [data-team-hub] / [data-player] delegation.
import { avatar, teamLogo, esc } from "./avatar.js";
import { pickInventory, toCode, projectLottery, lotteryTable, DEFAULT_FORMAT } from "../service/draft.js";
import { resolveSalary, teamTier, TIERS, money } from "../service/trade.js";
import { ATTRS } from "../service/ratings.js";
import { advanced, inMode, MODES } from "../service/advanced.js";
import { loadImage, roundRect, drawAvatar, fitText, fontsReady, openImageSheet } from "./card.js";

const CODE_TO_ESPN = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" };
const f1 = (x) => (x == null || !Number.isFinite(+x) ? "—" : Number(x).toFixed(1));
const ovrTier = (o) => (o >= 95 ? "gal" : o >= 90 ? "dia" : o >= 85 ? "ame" : o >= 80 ? "rub" : "base");
const ovrBadge = (r) => (r ? `<span class="ovr t-${r.tier || ovrTier(r.ovr)}" title="2K27 OVR${r.seeded ? "" : " (Hooptrax estimate)"}">${r.ovr}</span>` : "");
const deltaPill = (d) => (d > 0 ? `<span class="delta up">+${d}</span>` : d < 0 ? `<span class="delta down">−${Math.abs(d)}</span>` : "");
const inches = (h) => { const m = /(\d)\s*'\s*(\d{1,2})/.exec(String(h || "")); return m ? +m[1] * 12 + +m[2] : null; };

let statMode = (() => { try { return localStorage.getItem("htx:statMode") || "pergame"; } catch { return "pergame"; } })();
const setMode = (m) => { statMode = m; try { localStorage.setItem("htx:statMode", m); } catch {} };
const modeSeg = () => `<div class="seg mode-seg" role="group" aria-label="Stat mode" style="--n:3"><span class="thumb" style="transform:translateX(${MODES.findIndex(([k]) => k === statMode) * 100}%)"></span>${MODES.map(([k, l]) => `<button type="button" data-smode="${k}" aria-pressed="${statMode === k}">${l}</button>`).join("")}</div>`;
const bindMode = (body, redraw) => body.querySelectorAll("[data-smode]").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.smode); redraw(); }));
const pct1 = (x) => (x == null ? "—" : (x * 100).toFixed(1));

export function mountVault({ sheet, getClient, teamLook, ensureData, pickConfig, toast = () => {} }) {
  /* ---------- shared data (each loaded once per page, then cached by the service) ---------- */
  const once = {};
  const get = (key, fn) => (once[key] ||= fn().catch((e) => { delete once[key]; throw e; }));
  const data = {
    book: () => get("book", () => fetch("salaries_2026_27.json").then((r) => r.json())),
    ratings: () => get("ratings", async () => (await (await getClient()).get("ratings", {})).data),
    league: () => get("league", async () => (await (await getClient()).get("league", {})).data),
    stats: () => get("stats", async () => (await (await getClient()).get("players", {})).data),
    standings: () => get("standings", async () => (await (await getClient()).get("standings", {})).data),
    teamstats: () => get("teamstats", async () => (await (await getClient()).get("teamstats", {})).data),
    history: () => get("history", () => fetch("nba_history.json").then((r) => r.json())),
  };
  const ratingOf = (ratings, id) => ratings?.players?.find((p) => p.id === String(id)) || null;

  /* =================================================================== Team Vault */
  let vaultTab = "roster";
  async function openTeam(input) {
    await ensureData();
    const code = toCode(input);
    const look = teamLook(code);
    const espnAbbr = CODE_TO_ESPN[code] || code;
    const S = { roster: null, err: null, standing: null, lottery: null, inv: null, book: null, ratings: null, stats: null, schedule: null, schedErr: null, eff: null, history: null };
    const draw = (body) => {
      const st = S.standing;
      const head = `<div class="hub-head" style="--c:${look.color}">${teamLogo(look, { size: "3.25rem" })}
        <div style="min-width:0"><div class="hub-name">${esc(look.city)} ${esc(look.name)}</div>
        <div class="hub-meta num">${st ? `${st.wins}-${st.losses} · ${st.seed ? `#${st.seed} in the ${esc(st.conf)}` : esc(st.conf)}${st.streak ? ` · ${esc(st.streak)}` : ""}` : S.roster?.team?.record ? esc(S.roster.team.record) : '<span class="sk" style="display:inline-block;width:8rem;height:.8rem;border-radius:4px"></span>'}</div>
        ${S.eff ? `<div class="hub-meta eff-badges">${[["ortg", "ORtg"], ["drtg", "DRtg"], ["net", "Net"], ["pace", "Pace"]].map(([k, l]) => `<span class="pill" title="${l} ${S.eff[k]}">#${S.eff.ranks?.[k] ?? "–"} ${l} <b class="num">${k === "net" && S.eff[k] > 0 ? "+" : ""}${S.eff[k]}</b></span>`).join("")}</div>` : ""}
        ${S.lottery ? `<div class="hub-meta"><span class="pill lot">3-2-1 lottery seed ${S.lottery.seed} · ${(S.lottery.p1 * 100).toFixed(1)}% for #1</span></div>` : ""}
        ${S.roster?.coach ? `<div class="hub-meta">Coach ${esc(S.roster.coach)}</div>` : ""}</div></div>
        <div class="seg vault-tabs" role="tablist" style="--n:4"><span class="thumb" style="transform:translateX(${["roster", "picks", "schedule", "history"].indexOf(vaultTab) * 100}%)"></span>
          ${[["roster", "Roster & Cap"], ["picks", "Picks"], ["schedule", "Schedule"], ["history", "History & #s"]].map(([k, l]) => `<button type="button" role="tab" data-vtab="${k}" aria-pressed="${vaultTab === k}">${l}</button>`).join("")}</div>`;
      let tab = "";
      if (vaultTab === "roster") tab = rosterTab(S, look);
      else if (vaultTab === "picks") tab = picksTab(S, code);
      else if (vaultTab === "history") tab = historyTab(S, code, look);
      else tab = scheduleTab(S);
      body.innerHTML = head + `<div class="vault-body">${tab}</div>
        <div class="hub-actions"><a class="btn primary press" href="index.html#t=${encodeURIComponent(code + ",_")}">Load Team in Trade Machine</a><a class="btn ghost press" href="draft.html">Draft board</a></div>`;
      body.querySelectorAll("[data-vtab]").forEach((b) => b.addEventListener("click", () => { vaultTab = b.dataset.vtab; draw(body); if (vaultTab === "schedule") loadSchedule(); }));
      bindMode(body, () => draw(body));
    };
    sheet.open({ title: "Team Vault", render: draw });
    const refresh = () => sheet.isOpen && sheet.refresh();
    const c = await getClient();
    pickConfig().then((cfg) => { S.inv = pickInventory(code, cfg); refresh(); });
    data.book().then((b) => { S.book = b; refresh(); }).catch(() => {});
    data.teamstats().then((t) => { S.eff = t.efficiency?.[espnAbbr] || null; refresh(); }).catch(() => {});
    data.history().then((h) => { S.history = h; refresh(); }).catch(() => { S.history = { franchises: {} }; refresh(); });
    data.ratings().then((r) => { S.ratings = r; refresh(); }).catch(() => {});
    data.stats().then((s) => { S.stats = new Map(s.players.map((p) => [p.id, p.stats])); refresh(); }).catch(() => {});
    c.get("roster", { team: look.espn || espnAbbr }).then(({ data: d }) => { S.roster = d; refresh(); }).catch((e) => { S.err = e.message; refresh(); });
    data.standings().then((d) => {
      for (const conf of d.conferences) for (const t of conf.teams) if (toCode(t.team.abbr) === code) S.standing = { wins: t.wins, losses: t.losses, seed: t.seed, conf: conf.abbr || conf.name, streak: t.streak };
      try {
        const proj = projectLottery(d, DEFAULT_FORMAT, () => 0.5);
        const i = proj.lottery.findIndex((l) => l.team === code);
        if (i >= 0) {
          const table = lotteryTable(DEFAULT_FORMAT, { balls: proj.balls, order: proj.order, ties: proj.lottery.map((t) => t.tie) });
          S.lottery = { seed: i + 1, p1: table[i]?.p1 ?? 0 };
        }
      } catch {}
      refresh();
    }).catch(() => {});
    let schedAsked = false;
    function loadSchedule() {
      if (schedAsked) return; schedAsked = true;
      c.get("schedule", { team: look.espn || espnAbbr }).then(({ data: d }) => { S.schedule = d; refresh(); }).catch((e) => { S.schedErr = e.message; refresh(); });
    }
    if (vaultTab === "schedule") loadSchedule();
  }

  function rosterTab(S, look) {
    if (S.err) return `<div class="empty">Couldn’t load the roster: ${esc(S.err)}</div>`;
    if (!S.roster) return skel(6);
    const cba = S.book?.cba || { salaryCap: 165, taxLine: 201, firstApron: 209, secondApron: 222 };
    const rows = S.roster.athletes.map((a) => {
      const r = resolveSalary(a, { book: S.book, stats: S.stats?.get(a.id), cba });
      return { a, salary: r.salary, est: r.source === "estimate", rating: ratingOf(S.ratings, a.id) };
    }).sort((x, y) => y.salary - x.salary);
    const payroll = rows.reduce((s, r) => s + r.salary, 0) + (S.book?.teams?.[S.roster.team?.abbr]?.deadMoney || 0);
    const tier = teamTier(payroll, cba);
    const max = cba.secondApron * 1.12;
    const pct = (v) => `${Math.min(100, (v / max) * 100).toFixed(2)}%`;
    const marks = [["Cap", cba.salaryCap], ["Tax", cba.taxLine], ["1st Apron", cba.firstApron], ["2nd Apron", cba.secondApron]];
    return `<div class="meter-card">
        <div class="meter-top"><span><b class="num">${money(payroll)}</b> 2026–27 payroll</span><span class="tier ${tier}">${TIERS[tier]}</span></div>
        <div class="meter" role="img" aria-label="Payroll ${money(payroll)} against the cap, tax and aprons">
          <span class="meter-fill t-${tier}" style="width:${pct(payroll)}"></span>
          ${marks.map(([l, v], i) => `<span class="meter-mark" style="left:${pct(v)}" title="${l} ${money(v)}"><span class="ml">${["C", "T", "A1", "A2"][i]}</span></span>`).join("")}
        </div>
        <div class="meter-legend">${marks.map(([l, v], i) => `<span><b>${["C", "T", "A1", "A2"][i]}</b> ${l} <span class="num">${money(v)}</span></span>`).join("")}</div>
        <p class="meter-note">${cba.projected ? "Thresholds are 2026–27 projections. " : ""}Payroll sums ESPN contracts${rows.some((r) => r.est) ? "; “est.” salaries are estimated from experience and production" : ""}. ESPN rosters include two-way players.</p>
      </div>
      <div class="sheet-sub roster-sub"><span>Active roster · ${rows.length}</span>${modeSeg()}</div>
      <ul class="list">${rows.map(({ a, salary, est, rating }) => { const st = S.stats?.get(a.id); const m = st ? inMode(st, statMode) : null; const f = (x) => (x == null ? "—" : statMode === "totals" ? Math.round(x) : Number(x).toFixed(1));
        return `<li><button class="row" type="button" data-player="${esc(a.id)}">
        ${avatar(a, { size: "2.5rem", color: look.color })}
        <span class="meta"><span class="nm">${esc(a.name)}${a.injury ? ` <span class="pill ${/out/i.test(a.injury.status) ? "out" : "dtd"}">${esc(a.injury.status)}</span>` : ""}</span>
        <span class="sub num">${m && st.gp ? `${f(m.pts)} PTS · ${f(m.reb)} REB · ${f(m.ast)} AST` : [a.position, a.age ? `${a.age} yrs` : "", a.height].filter(Boolean).map(esc).join(" · ")}</span></span>
        <span class="sal num">${money(salary)}${est ? '<span class="est">est.</span>' : ""}</span>${ovrBadge(rating)}</button></li>`; }).join("")}</ul>`;
  }
  function picksTab(S, code) {
    if (!S.inv) return skel(3);
    return `<div class="inv">${S.inv.map((y) => `<div class="inv-y"><b>${y.year}</b>
      <div class="inv-r">1st round</div><ul>${y.items.map((i) => `<li class="inv-${i.kind}">${esc(i.text)}${i.verified ? "" : ' <span class="pill risk">unconfirmed</span>'}</li>`).join("")}</ul>
      <div class="inv-r">2nd round</div><ul><li class="inv-own">Own 2nd</li></ul></div>`).join("")}</div>
      <p class="meter-note">First-round obligations, protections and swaps come from draft_picks_2027_2029.json. Second-round obligations aren’t tracked yet, so each team shows its own 2nd.</p>`;
  }
  function scheduleTab(S) {
    if (S.schedErr) return `<div class="empty">Couldn’t load the schedule: ${esc(S.schedErr)}</div>`;
    if (!S.schedule) return skel(5);
    const done = S.schedule.games.filter((g) => g.state === "post").slice(-6).reverse();
    const next = S.schedule.games.filter((g) => g.state !== "post").slice(0, 6);
    const row = (g) => `<li class="sch"><span class="sch-d num">${new Date(g.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      <span class="sch-o">${g.home ? "vs" : "@"} ${teamLogo({ abbr: g.opponent.abbr, logo: g.opponent.logo, color: "#64748B" }, { size: "1.3rem" })}<b>${esc(g.opponent.name || g.opponent.abbr)}</b></span>
      <span class="sch-r num">${g.result ? `<span class="${g.result === "W" ? "w" : "l"}">${g.result}</span> ${esc(g.score)}` : g.state === "in" ? '<span class="pill live">LIVE</span>' : esc(new Date(g.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span></li>`;
    return `<div class="sheet-sub">Upcoming</div><ul class="list">${next.map(row).join("") || '<li class="empty">No games scheduled.</li>'}</ul>
      <div class="sheet-sub">Recent results</div><ul class="list">${done.map(row).join("") || '<li class="empty">No games played yet.</li>'}</ul>`;
  }
  function historyTab(S, code, look) {
    if (!S.history) return skel(4);
    const f = S.history.franchises?.[code];
    if (!f) return `<div class="empty">No history on file for this franchise.</div>`;
    const c = look.color || "#334155";
    const banners = f.titles.length ? `<div class="banner-wall">${f.titles.map((t) => `<div class="banner" style="--c:${c}" title="${esc(t.as)} def. ${esc(t.opponent)} ${esc(t.series)}${t.fmvp ? ` · Finals MVP ${esc(t.fmvp)}` : ""}">
        <b class="num">${t.year}</b><span>CHAMPIONS</span><small>def. ${esc(t.opponent)}<br>${esc(t.series)}</small>${t.fmvp ? `<em>FMVP ${esc(t.fmvp.split(" ").slice(-1)[0])}</em>` : ""}</div>`).join("")}</div>
        <ul class="list title-list">${f.titles.map((t) => `<li class="tl"><b class="num">${t.year}</b><span>${esc(t.as)} def. ${esc(t.opponent)} <span class="num">${esc(t.series)}</span>${t.fmvp ? ` · Finals MVP <b>${esc(t.fmvp)}</b>` : ""}</span></li>`).join("")}</ul>`
      : `<div class="empty">No NBA championships yet.</div>`;
    const losses = f.finalsLosses.length ? `<p class="meter-note">Finals runner-up: ${f.finalsLosses.map((l) => `${l.year} (${esc(l.opponent)}, ${esc(l.series)})`).join(" · ")}</p>` : "";
    const jerseys = f.retired.length ? `<div class="jersey-grid">${f.retired.map((r) => `<div class="jersey" style="--c:${c}">
        <svg viewBox="0 0 60 64" aria-hidden="true"><path d="M18 4h24l4 6 10 4-4 16-7-2v34H15V28l-7 2-4-16 10-4z" fill="var(--c)" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><path d="M24 4c1.5 5 10.5 5 12 0" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/></svg>
        <span class="jn num">${esc(r.num)}</span><b>${esc(r.name)}</b><small>${esc(r.years)}</small>${r.hof ? '<span class="hof">HOF</span>' : ""}</div>`).join("")}</div>`
      : `<div class="empty">No retired numbers.</div>`;
    const L = f.leaders || {};
    const leaders = `<div class="fl-grid">${[["points", "Points"], ["rebounds", "Rebounds"], ["assists", "Assists"], ["steals", "Steals"], ["blocks", "Blocks"], ["games", "Games"]].map(([k, l]) => `<div class="fl"><b>${l}</b><ol>${(L[k] || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ol></div>`).join("")}</div>`;
    return `<div class="sheet-sub">Championship banners · ${f.titles.length}</div>${banners}${losses}
      <div class="sheet-sub">Retired numbers · ${f.retired.length}</div>${jerseys}
      <p class="meter-note">League-wide: #6 retired for Bill Russell (2022). HOF = Naismith Hall of Fame.</p>
      <div class="sheet-sub">Franchise all-time leaders (top 5)</div>${leaders}
      <p class="meter-note">Titles and Finals MVPs are checked against ESPN. Retired numbers, years and franchise leader rankings are editorial and not yet verified against official records; fix them in nba_history.json.</p>`;
  }
  const skel = (n) => `<ul class="list">${Array.from({ length: n }, () => `<li><div class="sk-row"><div class="sk c"></div><div class="sk-l"><div class="sk t"></div><div class="sk t s"></div></div><div class="sk n"></div></div></li>`).join("")}</ul>`;

  /* =================================================================== Player Quick-View */
  async function openPlayer(id, { fallback = null } = {}) {
    await ensureData();
    const S = { p: null, inj: null, rating: null, roster: null, salary: null, bio: null, loading: true };
    const draw = (body) => {
      const base = S.roster || S.p || fallback || {};
      const teamAbbr = S.p?.teamAbbr || S.roster?.teamAbbr || base.team?.abbr || base.teamAbbr || "";
      const code = toCode(teamAbbr);
      const look = teamLook(code);
      const s = S.p?.stats;
      const name = base.name || S.p?.name || "Player";
      const slug = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const tradeHref = code && window.NBA_DATA.teams[code] ? `index.html#t=${encodeURIComponent(code + ",_")}&a=${encodeURIComponent(`${code}:${slug}>_`)}` : "index.html";
      const b = S.bio;
      const draftTxt = b?.draft?.year ? `${b.draft.year} · Round ${b.draft.round} · #${b.draft.overall} overall${b.draft.team ? ` · ${esc(b.draft.team)}` : ""}` : b ? "Undrafted" : null;
      const bioGrid = b ? `<div class="bio-grid">
          <div><span>Draft</span><b>${draftTxt}</b></div>
          <div><span>${b.college ? "College" : "From"}</span><b>${esc(b.college || b.country || b.birthPlace || "—")}</b></div>
          <div><span>Age</span><b class="num">${b.age ?? "—"}</b></div>
          <div><span>Ht / Wt</span><b class="num">${esc([b.height, b.weight].filter(Boolean).join(" · ") || "—")}</b></div>
          <div><span>Experience</span><b>${esc(b.experience || "—")}</b></div>
        </div>` : `<div class="bio-grid">${Array.from({ length: 5 }, () => `<div><span class="sk" style="display:block;width:3rem;height:.6rem;border-radius:3px"></span><span class="sk" style="display:block;width:5rem;height:.8rem;border-radius:3px;margin-top:.25rem"></span></div>`).join("")}</div>`;
      const m = s ? inMode(s, statMode) : null, adv = s ? advanced(s) : null;
      const fx = (x) => (x == null ? "—" : statMode === "totals" ? Math.round(x) : Number(x).toFixed(1));
      body.innerHTML = `<div class="qv-head" style="--c:${look.color}">${avatar({ ...base, name }, { size: "5.5rem", color: look.color, full: true })}
          <div style="min-width:0"><div class="qv-name">${esc(name)}</div>
          <div class="qv-sub">${code ? `<button class="qv-team" type="button" data-team-hub="${code}">${teamLogo(look, { size: "1.25rem" })}${esc(look.city)} ${esc(look.name)}</button>` : ""}</div>
          <div class="qv-sub num">${[base.position, base.jersey ? `#${base.jersey}` : "", base.height, base.age || S.p?.age ? `${base.age || S.p.age} yrs` : ""].filter(Boolean).map(esc).join(" · ")}</div>
          ${S.rating ? `<div class="qv-sub">${ovrBadge(S.rating)} ${deltaPill(S.rating.delta)} <span class="muted small">2K27 OVR${S.rating.seeded ? "" : " · est."}</span>${S.salary != null ? ` <span class="muted small">· ${money(S.salary.salary)}${S.salary.source === "estimate" ? " est." : ""} in 2026–27</span>` : ""}</div>` : ""}
          ${S.inj ? `<div class="qv-sub"><span class="pill ${S.inj.status === "Out" ? "out" : "dtd"}">${esc(S.inj.status)}</span> ${esc(S.inj.injury || "")}</div>` : ""}</div></div>
        ${bioGrid}
        <div class="sheet-sub roster-sub"><span>2026–27 season</span>${modeSeg()}</div>
        ${s ? `<div class="qv-stats">${[[statMode === "pergame" ? "PPG" : "PTS", fx(m.pts)], [statMode === "pergame" ? "RPG" : "REB", fx(m.reb)], [statMode === "pergame" ? "APG" : "AST", fx(m.ast)], ["STL", fx(m.stl)], ["BLK", fx(m.blk)], [statMode === "totals" ? "MIN" : "3PM", statMode === "totals" ? fx(m.min) : fx(m.tpm)]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v num">${v}</div></div>`).join("")}</div>
          <div class="qv-stats adv">${[["TS%", pct1(adv?.ts)], ["eFG%", pct1(adv?.efg)], ["AST/TO", adv?.astTo != null ? adv.astTo.toFixed(2) : "—"], ["GmSc", adv?.gmsc != null ? adv.gmsc.toFixed(1) : "—"], ["FG%", f1(s.fgPct)], ["3P%", f1(s.threePct)]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v num">${v}</div></div>`).join("")}</div>
          <p class="qv-note num">${s.gp} games · ${f1(s.min)} MIN · FT ${f1(s.ftPct)}%${statMode === "per36" ? " · scaled to 36 minutes" : statMode === "totals" ? " · season totals" : ""}</p>`
          : S.loading ? `<div class="skel-line"></div>` : `<div class="empty">No 2026–27 games yet.</div>`}
        <div class="hub-actions"><button class="btn primary press" type="button" data-compare>Compare</button><a class="btn ghost press" href="${tradeHref}">Open in Trade Machine</a>${code ? `<button class="btn ghost press" type="button" data-team-hub="${code}">Team Vault</button>` : ""}</div>`;
      body.querySelector("[data-compare]").addEventListener("click", () => openCompare(String(id)));
      bindMode(body, () => draw(body));
    };
    sheet.open({ title: "Player", render: draw });
    const c = await getClient();
    c.get("bio", { id: String(id) }).then(({ data: d }) => { S.bio = d; if (sheet.isOpen) sheet.refresh(); }).catch(() => { S.bio = { draft: { text: "" }, experience: "" }; if (sheet.isOpen) sheet.refresh(); });
    const [pl, ij, rt, lg, bk] = await Promise.allSettled([data.stats(), c.get("injuries", {}), data.ratings(), data.league(), data.book()]);
    if (pl.status === "fulfilled") S.p = pl.value.players.find((x) => x.id === String(id)) || null;
    if (ij.status === "fulfilled") S.inj = ij.value.data.find((x) => x.athlete?.id === String(id)) || null;
    if (rt.status === "fulfilled") S.rating = ratingOf(rt.value, id);
    if (lg.status === "fulfilled") S.roster = lg.value.players.find((x) => x.id === String(id)) || null;
    if (S.roster) S.salary = resolveSalary(S.roster, { book: bk.status === "fulfilled" ? bk.value : null, stats: S.p?.stats, cba: bk.value?.cba });
    S.loading = false;
    if (sheet.isOpen) sheet.refresh();
  }

  /* =================================================================== Compare */
  async function profileOf(id) {
    const [lg, st, rt, bk] = await Promise.allSettled([data.league(), data.stats(), data.ratings(), data.book()]);
    const r = lg.status === "fulfilled" ? lg.value.players.find((x) => x.id === String(id)) : null;
    const s = st.status === "fulfilled" ? st.value.players.find((x) => x.id === String(id)) : null;
    if (!r && !s) {
      // Legend or inactive player: career averages from ESPN (plus the history index for name/span).
      const h = await data.history().catch(() => null);
      const leg = h?.legends?.find((x) => x.id === String(id));
      const c = await (await getClient()).get("career", { id: String(id) }).then((x) => x.data).catch(() => null);
      if (!leg && !c) return null;
      const stats = c ? { ...c } : { gp: leg.gp, min: leg.min, pts: leg.pts, reb: leg.reb, ast: leg.ast, stl: leg.stl, blk: leg.blk, fgPct: leg.fgPct, threePct: leg.threePct, ftPct: leg.ftPct };
      if (leg && leg.reb != null) stats.reb = leg.reb;               // pre-1974 rebounds from official totals
      const span = leg?.from && leg?.to ? `${leg.from}–${leg.to}` : c?.from ? `${c.from - 1}–${c.to}` : "";
      return { id: String(id), name: leg?.name || c?.name || "Player", headshot: leg?.headshot || `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`, initials: (leg?.name || "").split(" ").map((w) => w[0]).join("").slice(0, 2),
        teamAbbr: span ? `Career ${span}` : "Career", position: leg?.position || "", age: null, height: leg?.height || "", experience: null, stats, rating: null, salary: null, legend: true, career: true };
    }
    const base = { ...(s || {}), ...(r || {}) };
    const book = bk.status === "fulfilled" ? bk.value : null;
    return {
      id: String(id), name: base.name, headshot: base.headshot, headshotSmall: base.headshotSmall, initials: base.initials,
      teamAbbr: base.teamAbbr || "", position: base.position || "", age: base.age ?? null, height: base.height || "", experience: base.experience ?? null,
      stats: s?.stats || null, rating: rt.status === "fulfilled" ? ratingOf(rt.value, id) : null,
      salary: r ? resolveSalary(r, { book, stats: s?.stats, cba: book?.cba }) : null,
    };
  }
  const ms = (p) => (p.stats ? inMode(p.stats, statMode) : null);
  const STAT_ROWS = [["PTS", (p) => ms(p)?.pts], ["REB", (p) => ms(p)?.reb], ["AST", (p) => ms(p)?.ast], ["STL", (p) => ms(p)?.stl], ["BLK", (p) => ms(p)?.blk], ["3PM", (p) => ms(p)?.tpm],
    ["FG%", (p) => p.stats?.fgPct], ["3P%", (p) => p.stats?.threePct], ["FT%", (p) => p.stats?.ftPct], ["MIN", (p) => ms(p)?.min]];
  const ADV_ROWS = [["TS%", (p) => (p.stats ? advanced(p.stats)?.ts * 100 : null)], ["eFG%", (p) => (p.stats ? advanced(p.stats)?.efg * 100 : null)], ["AST/TO", (p) => (p.stats ? advanced(p.stats)?.astTo : null)], ["Game Score", (p) => (p.stats ? advanced(p.stats)?.gmsc : null)]];
  const RATING_ROWS = [["OVR", (p) => p.rating?.ovr], ...ATTRS.map(([k, l]) => [l, (p) => p.rating?.attrs?.[k]])];
  const PROFILE_ROWS = [["2026–27 Salary", (p) => (p.salary ? money(p.salary.salary) + (p.salary.source === "estimate" ? " est." : "") : "—")], ["Age", (p) => p.age ?? "—"], ["Height", (p) => p.height || "—"],
    ["Experience", (p) => (p.experience == null ? "—" : p.experience === 0 ? "Rookie" : `${p.experience} yrs`)], ["Team", (p) => p.teamAbbr || "—"]];
  function cmpRows(A, B, rows, { numeric = true, digits = 1 } = {}) {
    return rows.map(([label, f]) => {
      const a = f(A), b = B ? f(B) : null;
      let wa = false, wb = false;
      if (numeric && B && a != null && b != null && a !== b) { wa = a > b; wb = b > a; }
      const fmt = (v) => (v == null ? "—" : numeric ? Number(v).toFixed(digits) : esc(v));
      const share = numeric && a != null && b != null && (a + b) > 0 ? a / (a + b) : 0.5;
      return `<div class="cmp-row"><span class="cmp-v ${wa ? "win" : ""}">${fmt(a)}</span><span class="cmp-l">${label}${numeric && B ? `<span class="cmp-bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span>` : ""}</span><span class="cmp-v ${wb ? "win" : ""}">${B ? fmt(b) : ""}</span></div>`;
    }).join("");
  }
  async function openCompare(idA, idB = null) {
    const S = { A: null, B: null, q: "", list: [], remote: {} };
    const draw = (body) => {
      const A = S.A, B = S.B;
      const head = (p, side) => p ? `<div class="cmp-p">${avatar(p, { size: "3.6rem", color: "#64748B" })}<b>${esc(p.name)}</b><span>${esc(p.teamAbbr)}${p.rating ? ` · ${ovrBadge(p.rating)}` : p.legend ? ' · <span class="pill lgd">Legend</span>' : ""}</span>${side === "B" ? `<button class="link" type="button" data-change>Change</button>` : ""}</div>`
        : `<div class="cmp-p empty-p"><div class="sk c" style="width:3.6rem;height:3.6rem;border-radius:99px"></div><b>${side === "B" ? "Pick a player" : "Loading…"}</b></div>`;
      const qq = S.q.trim().toLowerCase();
      const local = qq.length >= 2 ? S.list.filter((p) => p.id !== A?.id && `${p.name} ${p.teamAbbr || ""}`.toLowerCase().includes(qq)).slice(0, 8) : [];
      const remote = (S.remote[qq] || []).filter((p) => p.id !== A?.id && !local.some((l) => l.id === p.id)).slice(0, 6);
      const results = [...local, ...remote];
      if (qq.length >= 3 && local.length < 4 && !(qq in S.remote)) { S.remote[qq] = []; getClient().then((c) => c.get("search", { q: qq })).then(({ data: d }) => { S.remote[qq] = d.map((x) => ({ ...x, teamAbbr: x.team || "NBA", position: "ESPN" })); if (sheet.isOpen) draw(body); }).catch(() => {}); }
      body.innerHTML = `<div class="cmp-head">${head(A, "A")}<span class="cmp-vs">VS</span>${head(B, "B")}</div>
        ${!B ? `<input class="search" id="cmpSearch" type="search" placeholder="Search any NBA player" autocomplete="off" value="${esc(S.q)}" style="font-size:16px" aria-label="Search a player to compare" />
          <ul class="list cmp-results">${results.map((p) => `<li><button class="row" type="button" data-pick="${esc(p.id)}">${avatar(p, { size: "2.25rem", color: "#64748B" })}<span class="meta"><span class="nm">${esc(p.name)}${p.legend ? ' <span class="pill lgd">Legend</span>' : ""}</span><span class="sub">${esc(p.teamAbbr)}${p.position ? ` · ${esc(p.position)}` : ""}</span></span></button></li>`).join("")}</ul>
          <p class="meter-note">Search active players and NBA legends. Legends compare on career averages.</p>` : ""}
        ${A ? `<div class="sheet-sub roster-sub"><span>${A.career || B?.career ? "2026–27 / career averages for legends" : "2026–27 season"} · ${MODES.find(([k]) => k === statMode)[1]}</span>${modeSeg()}</div><div class="cmp-tbl">${cmpRows(A, B, STAT_ROWS, { digits: statMode === "totals" ? 0 : 1 })}</div>
          <div class="sheet-sub">Advanced</div><div class="cmp-tbl">${cmpRows(A, B, ADV_ROWS, { digits: 1 })}</div>
          <div class="sheet-sub">NBA 2K27 ratings</div><div class="cmp-tbl">${cmpRows(A, B, RATING_ROWS, { digits: 0 })}</div>
          <div class="sheet-sub">Contract & profile</div><div class="cmp-tbl">${cmpRows(A, B, PROFILE_ROWS, { numeric: false })}</div>` : skel(4)}
        ${B ? `<div class="hub-actions"><button class="btn primary press" type="button" data-share>Share Comparison Card</button><button class="btn ghost press" type="button" data-swap>Swap sides</button></div>` : ""}
        <p class="meter-note">Green marks the better number in each row. Ratings marked est. are Hooptrax estimates from live stats.</p>`;
      const s = body.querySelector("#cmpSearch");
      if (s) {
        s.addEventListener("input", () => { S.q = s.value; const pos = s.selectionStart; draw(body); const n = body.querySelector("#cmpSearch"); n.focus(); n.setSelectionRange(pos, pos); });
        if (!S.q) setTimeout(() => s.focus({ preventScroll: true }), 50);
      }
      body.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
        const prof = await profileOf(b.dataset.pick);
        if (!prof) { toast("ESPN has no NBA career stats for that player"); return; }
        S.B = prof; S.q = ""; draw(body);
      }));
      body.querySelector("[data-change]")?.addEventListener("click", () => { S.B = null; draw(body); });
      bindMode(body, () => draw(body));
      body.querySelector("[data-swap]")?.addEventListener("click", () => { [S.A, S.B] = [S.B, S.A]; draw(body); });
      body.querySelector("[data-share]")?.addEventListener("click", async () => {
        try { const canvas = await renderCompareCard(S.A, S.B); await openImageSheet(sheet, canvas, { title: "Comparison Card", filename: "hooptrax-compare.png", toast }); }
        catch (e) { console.error(e); toast("Couldn't render the card"); }
      });
    };
    sheet.open({ title: "Compare Players", render: draw });
    const [a, b, lg, hist] = await Promise.all([profileOf(idA), idB ? profileOf(idB) : null, data.league().catch(() => null), data.history().catch(() => null)]);
    const activeIds = new Set((lg?.players || []).map((p) => p.id));
    const legends = (hist?.legends || []).filter((l) => !activeIds.has(l.id)).map((l) => ({ id: l.id, name: l.name, teamAbbr: `${l.from ?? ""}–${l.to ?? ""}`, position: l.position, headshot: l.headshot, legend: true }));
    S.A = a; S.B = b; S.list = [...(lg?.players || []), ...legends];
    if (sheet.isOpen) sheet.refresh();
  }

  /* ---------- comparison card PNG (1080 wide, 2x) ---------- */
  async function renderCompareCard(A, B) {
    await fontsReady();
    const W = 1080, rowsAll = [[`SEASON · ${MODES.find(([k]) => k === statMode)[1].toUpperCase()}`, STAT_ROWS], ["ADVANCED", ADV_ROWS], ["2K27", RATING_ROWS]];
    const ROW = 50, H = 300 + rowsAll.reduce((s, [, r]) => s + 60 + r.length * ROW, 0) + 120;
    const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2;
    const x = c.getContext("2d"); x.scale(2, 2);
    const SANS = '"Plus Jakarta Sans", system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, monospace';
    x.fillStyle = "#0B0E14"; x.fillRect(0, 0, W, H);
    const [la, lb, logo] = await Promise.all([loadImage(A.headshot), loadImage(B.headshot), loadImage("public/logo.svg")]);
    drawAvatar(x, la, 200, 130, 74, { initials: A.initials, tint: "#334155" });
    drawAvatar(x, lb, W - 200, 130, 74, { initials: B.initials, tint: "#334155" });
    x.textAlign = "center"; x.fillStyle = "#E8ECF3"; x.font = `800 30px ${SANS}`;
    fitText(x, A.name, 200, 242, 330); fitText(x, B.name, W - 200, 242, 330);
    x.font = `600 18px ${MONO}`; x.fillStyle = "rgba(203,213,225,.74)";
    x.fillText(`${A.teamAbbr} · ${A.rating ? `OVR ${A.rating.ovr}` : ""}`, 200, 272); x.fillText(`${B.teamAbbr} · ${B.rating ? `OVR ${B.rating.ovr}` : ""}`, W - 200, 272);
    x.font = `800 34px ${SANS}`; x.fillStyle = "#F59E0B"; x.fillText("VS", W / 2, 142);
    let y = 320;
    for (const [title, rows] of rowsAll) {
      x.textAlign = "center"; x.font = `700 16px ${MONO}`; x.fillStyle = "rgba(148,163,184,.7)"; x.fillText(title, W / 2, y); y += 24;
      for (const [label, f] of rows) {
        const a = f(A), b = f(B);
        const fmt = (v) => (v == null ? "—" : title === "2K27" ? String(Math.round(v)) : Number(v).toFixed(1));
        roundRect(x, 60, y, W - 120, ROW - 8, 12); x.fillStyle = "#151B26"; x.fill();
        const wa = a != null && b != null && a > b, wb = a != null && b != null && b > a;
        if (wa) { roundRect(x, 60, y, 220, ROW - 8, 12); x.fillStyle = "rgba(16,185,129,.18)"; x.fill(); }
        if (wb) { roundRect(x, W - 280, y, 220, ROW - 8, 12); x.fillStyle = "rgba(16,185,129,.18)"; x.fill(); }
        x.font = `700 24px ${MONO}`; x.fillStyle = wa ? "#10B981" : "#E8ECF3"; x.fillText(fmt(a), 170, y + 30);
        x.fillStyle = wb ? "#10B981" : "#E8ECF3"; x.fillText(fmt(b), W - 170, y + 30);
        x.font = `600 19px ${SANS}`; x.fillStyle = "rgba(203,213,225,.8)"; x.fillText(label, W / 2, y + 28);
        y += ROW;
      }
      y += 36;
    }
    x.textAlign = "left";
    if (logo) x.drawImage(logo, 60, H - 84, 40, 40);
    x.font = `600 22px ${SANS}`; x.fillStyle = "rgba(203,213,225,.74)"; x.fillText("Built on Hooptrax.com • Player Comparison", 112, H - 56);
    x.font = `500 15px ${MONO}`; x.fillStyle = "rgba(148,163,184,.6)"; x.textAlign = "right"; x.fillText("stats: ESPN · 2K27 OVR (est. where noted)", W - 60, H - 56);
    return c;
  }

  return { openTeam, openPlayer, openCompare };
}
