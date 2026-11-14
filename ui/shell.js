// App shell shared by every tool: header + navigation, live status, 30 Teams switcher, LiveWire
// rail/drawer, and the global Team Hub + Player Quick-View. Tools keep their own state; the shell
// only reads shared live data and never touches a tool's saved sandbox.
//
//   const shell = mountShell({ active: "draft" });
//   shell.setWireHandler((item) => …)   // optional: a page can take over ticker clicks
import { createClient } from "./client.js";
import { avatar, teamLogo, esc } from "./avatar.js";
import { Spring, createSheet, scrollEdge, reduceMotion, project, tracker, rubberband } from "./motion.js";
import { mountLiveWire } from "./ticker.js";
import { pickInventory, toCode } from "../service/draft.js";
import { logoMark, wordmark, HooptraxWatermark } from "./brand.js";

const ICON = {
  live: '<path d="M2 12h3.5l2.5-6 4 12 3-9 2 3H22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  trade: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  draft: '<rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  awards: '<path d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M9.5 17h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  mcconnell: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>',
  teams: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/>',
};
const svg = (k, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
export const TABS = [
  ["live", "Live", "live.html"], ["trade", "Trade", "index.html"], ["draft", "Draft", "draft.html"],
  ["awards", "Awards", "awards.html"], ["mcconnell", "McConnell", "mcconnell.html"],
];
const ESPN_SLUG = { GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" };
const CODE_TO_ESPN = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" };
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const f1 = (x) => (x == null || !Number.isFinite(+x) ? "—" : Number(x).toFixed(1));

let instance = null;
export function mountShell({ active = "live" } = {}) {
  if (instance) return instance;
  const sheet = createSheet();
  // The LiveWire ticker lives on the Live tab only; elsewhere a quiet dot on that tab says updates are streaming.
  const hasWire = active === "live";
  const tabLink = ([k, label, href]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ""}${k === "live" && !hasWire ? ' class="tab-live" aria-label="Live (updates streaming)"' : ""}>${svg(k)}<span>${label}</span></a>`;
  const bar = document.getElementById("bar") || document.body.insertBefore(document.createElement("header"), document.body.firstChild);
  bar.id = "bar"; bar.className = "bar app-bar";
  bar.innerHTML = `<div class="bar-inner">
      <a class="brand-link" href="./" aria-label="Hooptrax home">${logoMark("brand-mark")}${wordmark()}</a>
      <nav class="topnav" aria-label="Tools">${TABS.map(tabLink).join("")}</nav>
      <div class="bar-right">
        <button class="status-pill" type="button" id="statusPill" aria-label="${hasWire ? "Live data status. Open LiveWire." : "Live data status. Go to Live."}"><span class="pulse" id="pulse"></span><span id="sync">Live Sync</span></button>
        <button class="teams-btn" type="button" id="teamsBtn" aria-haspopup="dialog">${svg("teams")}<span>30 Teams</span></button>
      </div>
    </div>`;
  scrollEdge(bar);

  const tabbar = document.createElement("nav");
  tabbar.className = "tabbar"; tabbar.setAttribute("aria-label", "Tools");
  tabbar.innerHTML = TABS.map(tabLink).join("");
  document.body.append(tabbar);
  // App footer: brand watermark so screenshots carry it
  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.innerHTML = `${HooptraxWatermark()}<span class="app-footer-note">Live NBA data from ESPN's public feeds. Not affiliated with the NBA or ESPN.</span>`;
  (document.querySelector("main") || document.body).after(footer);
  document.body.classList.add("has-shell");

  /* ---------- LiveWire: right rail on wide screens, slide-up drawer otherwise ---------- */
  const rail = document.createElement("aside"); rail.className = "wire-rail"; rail.setAttribute("aria-label", "LiveWire");
  const drawer = document.createElement("div"); drawer.className = "wire-drawer"; drawer.setAttribute("role", "dialog"); drawer.setAttribute("aria-label", "LiveWire");
  drawer.innerHTML = `<div class="wire-drawer-grab" aria-hidden="true"></div><div class="wire-drawer-body"></div>`;
  const drawerScrim = document.createElement("div"); drawerScrim.className = "scrim";
  if (hasWire) document.body.append(rail, drawerScrim, drawer);
  const wireEl = document.createElement("section");
  const wide = matchMedia("(min-width: 1100px)");
  let wire = null, wireHandler = null, client = null;
  const place = () => { (wide.matches ? rail : drawer.querySelector(".wire-drawer-body")).append(wireEl); document.body.classList.toggle("has-rail", wide.matches); if (wire) requestAnimationFrame(() => wire.remount()); };
  if (hasWire) { place(); wide.addEventListener?.("change", () => { closeDrawer(); place(); }); }

  const dSpring = new Spring(1, (y) => {
    drawer.style.transform = `translateY(${y * 100}%)`;
    drawerScrim.style.opacity = String(1 - Math.min(1, Math.max(0, y)));
  }, 0.001);
  let drawerOpen = false;
  function openDrawer() {
    if (!hasWire) { location.href = "live.html"; return; }
    if (wide.matches) { rail.querySelector(".wire-toggle")?.focus(); return; }
    drawerOpen = true; drawer.style.visibility = "visible"; drawerScrim.classList.add("on");
    if (reduceMotion.matches) dSpring.set(0); else dSpring.to(0, { damping: 1, response: 0.4 });
    requestAnimationFrame(() => wire && wire.remount());
  }
  function closeDrawer(v) {
    if (!drawerOpen) return; drawerOpen = false; drawerScrim.classList.remove("on");
    const done = () => { if (!drawerOpen) drawer.style.visibility = "hidden"; };
    if (reduceMotion.matches) { dSpring.set(1); done(); } else dSpring.to(1, { damping: 1, response: 0.35, velocity: v, onDone: done });
  }
  drawerScrim.addEventListener("pointerdown", () => closeDrawer());
  document.getElementById("statusPill").addEventListener("click", () => (drawerOpen ? closeDrawer() : openDrawer()));
  // drag the grabber to dismiss (momentum projection + rubber band, like the main sheet)
  (() => {
    const grab = drawer.querySelector(".wire-drawer-grab"); const vt = tracker(); let d = null;
    grab.addEventListener("pointerdown", (e) => { dSpring.stop(); d = { y: e.clientY, base: dSpring.x, id: e.pointerId }; grab.setPointerCapture(e.pointerId); vt.reset(); vt.push(e.clientY); });
    grab.addEventListener("pointermove", (e) => { if (!d) return; vt.push(e.clientY); const H = drawer.offsetHeight; let y = d.base * H + (e.clientY - d.y); if (y < 0) y = rubberband(y, H); dSpring.set(y / H); });
    const end = () => { if (!d) return; d = null; const H = drawer.offsetHeight; const v = vt.velocity(); if (dSpring.x * H + project(v) > H * 0.4) closeDrawer(v / H); else dSpring.to(0, { damping: 1, response: 0.3, velocity: v / H }); };
    grab.addEventListener("pointerup", end); grab.addEventListener("pointercancel", end);
  })();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerOpen) closeDrawer(); });

  createClient().then((c) => {
    client = c;
    if (hasWire) wire = mountLiveWire(wireEl, {
      client,
      onSelect(item) {
        if (wireHandler && wireHandler(item) !== false) return;
        if (item.kind === "game" && item.gameId) { location.href = `live.html?game=${encodeURIComponent(item.gameId)}#games`; return; }
        if (item.athlete?.id) { closeDrawer(); openPlayer(item.athlete.id, { fallback: { ...item.athlete, team: item.team } }); return; }
        if (item.team?.abbr) { closeDrawer(); openTeam(item.team.abbr); }
      },
    });
    const sp = document.getElementById("sync");
    if (sp && /Live Sync/.test(sp.textContent)) sp.textContent = client.mode === "service" ? "Live Sync" : "Live · ESPN";
    document.getElementById("pulse").className = "pulse on";
  });

  /* ---------- team + player data ---------- */
  let configP = null;
  const pickConfig = () => (configP ||= fetch("draft_picks_2027_2029.json").then((r) => r.json()).catch(() => ({ years: {} })));
  const teamLook = (code) => {
    const T = window.NBA_DATA?.teams?.[code];
    return { abbr: code, name: T ? T.name : code, city: T?.city || "", color: T?.color || "#8e8e93", espn: T?.espn, logo: `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_SLUG[code] || code.toLowerCase()}.png` };
  };
  const ensureData = () => (window.NBA_DATA ? Promise.resolve() : new Promise((res) => {
    const s = document.createElement("script"); s.src = "data.js"; s.onload = res; s.onerror = res; document.head.append(s);
  }));

  function teamsSheet() {
    ensureData().then(() => {
      const T = window.NBA_DATA.teams;
      const DIVS = { Atlantic: ["BOS", "BKN", "NYK", "PHI", "TOR"], Central: ["CHI", "CLE", "DET", "IND", "MIL"], Southeast: ["ATL", "CHA", "MIA", "ORL", "WAS"],
        Northwest: ["DEN", "MIN", "OKC", "POR", "UTA"], Pacific: ["GSW", "LAC", "LAL", "PHX", "SAC"], Southwest: ["DAL", "HOU", "MEM", "NOP", "SAS"] };
      sheet.open({
        title: "30 Teams", searchable: true, placeholder: "Search teams",
        render(body, q) {
          body.innerHTML = Object.entries(DIVS).map(([div, codes]) => {
            const list = codes.filter((c) => !q || `${T[c].city} ${T[c].name} ${c}`.toLowerCase().includes(q));
            if (!list.length) return "";
            return `<div class="sheet-sub">${div}</div><div class="hub-grid">${list.map((c) => `<button class="hub-team press" type="button" data-team-hub="${c}">${teamLogo(teamLook(c), { size: "2rem" })}<span><b>${esc(T[c].name)}</b><small>${esc(T[c].city)}</small></span></button>`).join("")}</div>`;
          }).join("") || `<div class="empty">No teams match.</div>`;
        },
      });
    });
  }
  document.getElementById("teamsBtn").addEventListener("click", teamsSheet);

  async function openTeam(input) {
    await ensureData();
    const code = toCode(input);
    const look = teamLook(code);
    let roster = null, standing = null, err = null, inv = null;
    sheet.open({
      title: `${look.city} ${look.name}`,
      render(body) {
        const st = standing;
        body.innerHTML = `<div class="hub-head" style="--c:${look.color}">${teamLogo(look, { size: "3.25rem" })}
            <div><div class="hub-name">${esc(look.city)} ${esc(look.name)}</div>
            <div class="hub-meta num">${st ? `${st.wins}-${st.losses} · ${st.seed ? `#${st.seed} in the ${st.conf}` : st.conf}${st.streak ? ` · ${esc(st.streak)}` : ""}` : roster?.team?.record ? esc(roster.team.record) : "Loading record…"}</div>
            ${roster?.coach ? `<div class="hub-meta">Coach ${esc(roster.coach)}</div>` : ""}</div></div>
          <div class="sheet-sub">2027–2029 first-round picks</div>
          ${inv ? `<div class="inv">${inv.map((y) => `<div class="inv-y"><b>${y.year}</b><ul>${y.items.map((i) => `<li class="inv-${i.kind}">${esc(i.text)}${i.verified ? "" : ' <span class="pill risk">unconfirmed</span>'}</li>`).join("")}</ul></div>`).join("")}</div>` : `<div class="skel-line"></div>`}
          <div class="sheet-sub">Roster${roster ? ` · ${roster.athletes.length}` : ""}</div>
          ${err ? `<div class="empty">Couldn’t load the roster: ${esc(err)}</div>` : !roster ? `<div class="skel-line"></div><div class="skel-line"></div>` :
            `<ul class="list">${[...roster.athletes].sort((a, b) => (b.salary || 0) - (a.salary || 0)).map((a) => `<li><button class="row" type="button" data-player="${esc(a.id)}">
              ${avatar(a, { size: "2.5rem", color: look.color })}
              <span class="meta"><span class="nm">${esc(a.name)}${a.injury ? ` <span class="pill ${/out/i.test(a.injury.status) ? "out" : "dtd"}">${esc(a.injury.status)}</span>` : ""}</span>
              <span class="sub num">${[a.position, a.jersey ? `#${a.jersey}` : "", a.height, a.age ? `${a.age} yrs` : ""].filter(Boolean).map(esc).join(" · ")}</span></span>
              <span class="sal num">${a.salary ? `$${(a.salary / 1e6).toFixed(1)}M` : ""}</span></button></li>`).join("")}</ul>`}
          <div class="hub-actions"><a class="btn press" href="index.html#t=${encodeURIComponent(code + ",_")}">Open in Trade Machine</a><a class="btn press" href="draft.html">Draft board</a></div>`;
      },
    });
    const refresh = () => sheet.isOpen && sheet.refresh();
    pickConfig().then((c) => { inv = pickInventory(code, c); refresh(); });
    const c = client || await createClient();
    c.get("roster", { team: look.espn || CODE_TO_ESPN[code] || code }).then(({ data }) => { roster = data; refresh(); }).catch((e) => { err = e.message; refresh(); });
    c.get("standings", {}).then(({ data }) => {
      for (const conf of data.conferences) for (const t of conf.teams) if (toCode(t.team.abbr) === code) standing = { wins: t.wins, losses: t.losses, seed: t.seed, conf: conf.abbr || conf.name, streak: t.streak };
      refresh();
    }).catch(() => {});
  }

  async function openPlayer(id, { fallback = null } = {}) {
    await ensureData();
    let p = null, inj = null, loading = true;
    const draw = (body) => {
      const base = p || fallback || {};
      const teamAbbr = p?.teamAbbr || base.team?.abbr || base.teamAbbr || "";
      const code = toCode(teamAbbr);
      const look = teamLook(code);
      const s = p?.stats;
      const tradeHref = code && window.NBA_DATA.teams[code] ? `index.html#t=${encodeURIComponent(code + ",_")}&a=${encodeURIComponent(`${code}:${slug(base.name || "")}>_`)}` : "index.html";
      body.innerHTML = `<div class="qv-head" style="--c:${look.color}">${avatar(base, { size: "5.5rem", color: look.color, full: true })}
          <div><div class="qv-name">${esc(base.name || "Player")}</div>
          <div class="qv-sub">${code ? `<button class="qv-team" type="button" data-team-hub="${code}">${teamLogo(look, { size: "1.25rem" })}${esc(look.city)} ${esc(look.name)}</button>` : ""}</div>
          <div class="qv-sub num">${[base.position, base.jersey ? `#${base.jersey}` : "", base.height, base.age ? `${base.age} yrs` : (p?.age ? `${p.age} yrs` : "")].filter(Boolean).map(esc).join(" · ")}</div>
          ${inj ? `<div class="qv-sub"><span class="pill ${inj.status === "Out" ? "out" : "dtd"}">${esc(inj.status)}</span> ${esc(inj.injury || "")}</div>` : ""}</div></div>
        <div class="sheet-sub">2026–27 season</div>
        ${s ? `<div class="qv-stats">${[["PPG", f1(s.pts)], ["RPG", f1(s.reb)], ["APG", f1(s.ast)], ["FG%", f1(s.fgPct)], ["3P%", f1(s.threePct)], ["MIN", f1(s.min)]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v num">${v}</div></div>`).join("")}</div>
          <p class="qv-note num">${s.gp} games · ${f1(s.stl)} STL · ${f1(s.blk)} BLK · FT ${f1(s.ftPct)}%</p>`
          : loading ? `<div class="skel-line"></div>` : `<div class="empty">No 2026–27 games yet.</div>`}
        <div class="hub-actions"><a class="btn primary press" href="${tradeHref}">Open in Trade Machine</a>${code ? `<button class="btn press" type="button" data-team-hub="${code}">Team Hub</button>` : ""}</div>`;
    };
    sheet.open({ title: "Player", render: draw });
    const c = client || await createClient();
    const [pl, ij] = await Promise.allSettled([c.get("players", {}), c.get("injuries", {})]);
    if (pl.status === "fulfilled") p = pl.value.data.players.find((x) => x.id === String(id)) || null;
    if (ij.status === "fulfilled") inj = ij.value.data.find((x) => x.athlete?.id === String(id)) || null;
    loading = false;
    if (sheet.isOpen) sheet.refresh();
  }

  // Global delegation: any [data-team-hub] badge or [data-player] row anywhere in the app.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-team-hub]");
    if (t && t.dataset.teamHub) { e.preventDefault(); e.stopPropagation(); openTeam(t.dataset.teamHub); return; }
    const p = e.target.closest("[data-player]");
    if (p && p.dataset.player) { e.preventDefault(); e.stopPropagation(); openPlayer(p.dataset.player); }
  }, true);

  instance = {
    openTeam, openPlayer, openDrawer, closeDrawer,
    setWireHandler(fn) { wireHandler = fn; },
    get wire() { return wire; },
    setStatus(kind, text) {
      const d = document.getElementById("pulse"), s = document.getElementById("sync");
      if (d) d.className = `pulse ${kind || ""}`; if (s && text != null) s.textContent = text;
    },
  };
  window.courtside = instance;          // handy for debugging and tests
  return instance;
}
