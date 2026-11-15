// App shell shared by every tool: header + navigation, live status, 30 Teams switcher, LiveWire
// rail/drawer, and the global Team Hub + Player Quick-View. Tools keep their own state; the shell
// only reads shared live data and never touches a tool's saved sandbox.
//
//   const shell = mountShell({ active: "draft" });
//   shell.setWireHandler((item) => …)   // optional: a page can take over ticker clicks
import { createClient } from "./client.js";
import { avatar, teamLogo, esc } from "./avatar.js";
import { Spring, createSheet, createToast, scrollEdge, reduceMotion, project, tracker, rubberband } from "./motion.js";
import { mountLiveWire } from "./ticker.js";
import { pickInventory, toCode } from "../service/draft.js";
import { logoMark, wordmark, HooptraxWatermark } from "./brand.js";
import { mountVault } from "./vault.js";
import { mountChat } from "./chat.js";

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
  // A shared trade link always opens on the Trade tab, whichever page it was pasted onto.
  if (active !== "trade" && new URLSearchParams(location.search).has("trade")) { location.replace(`index.html${location.search}`); }
  const sheet = createSheet();
  let toaster = null; const toastFn = (m) => (toaster ||= createToast())(m);
  // The LiveWire ticker lives on the Live tab only; elsewhere a quiet dot on that tab says updates are streaming.
  // The LED ticker board (ui/ledboard.js) lives on the Live tab itself; the old vertical rail is retired.
  const hasWire = false;
  const tabLink = ([k, label, href]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ""}${k === "live" && active !== "live" ? ' class="tab-live" aria-label="Live (updates streaming)"' : ""}>${svg(k)}<span>${label}</span></a>`;
  const bar = document.getElementById("bar") || document.body.insertBefore(document.createElement("header"), document.body.firstChild);
  bar.id = "bar"; bar.className = "bar app-bar";
  bar.innerHTML = `<div class="bar-inner">
      <a class="brand-link" href="./" aria-label="Hooptrax home">${logoMark("brand-mark")}${wordmark()}</a>
      <nav class="topnav" aria-label="Tools">${TABS.map(tabLink).join("")}</nav>
      <div class="bar-right">
        <button class="status-pill" type="button" id="statusPill" aria-label="${hasWire ? "Live data status. Open LiveWire." : "Live data status. Go to Live."}"><span class="pulse" id="pulse"></span><span id="sync">Live Sync</span></button>
        <button class="teams-btn" type="button" id="teamsBtn" aria-haspopup="dialog" aria-label="30 Teams">${svg("teams")}<span>30 Teams</span></button>
        <button class="theme-btn" type="button" id="themeBtn" aria-label="Switch to light mode"><svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
    </div>`;
  scrollEdge(bar);
  /* ---------- Light / dark theme ---------- */
  const themeBtn = document.getElementById("themeBtn");
  const paintTheme = () => { const light = document.documentElement.dataset.theme === "light"; themeBtn.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode"); themeBtn.title = light ? "Light mode" : "Dark mode"; };
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("htx:theme", next); } catch {}
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", next === "light" ? "#F8FAFC" : "#0B0E14"));
    paintTheme();
    window.dispatchEvent(new CustomEvent("htx:theme", { detail: next }));
  });
  paintTheme();

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
    if (!hasWire) { if (active === "live") document.querySelector(".led")?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" }); else location.href = "live.html"; return; }
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

  const vault = mountVault({ sheet, getClient: () => (client ? Promise.resolve(client) : createClient()), teamLook, ensureData, pickConfig, toast: (m) => toastFn(m) });
  const { openTeam, openPlayer, openCompare } = vault;
  const chat = mountChat({ getClient: () => (client ? Promise.resolve(client) : createClient()) });

  // Popovers (<details class="pop">): close on outside tap, Escape, or after choosing an item.
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.pop[open]").forEach((d) => { if (!d.contains(e.target) || e.target.closest(".pop-menu button")) d.removeAttribute("open"); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll("details.pop[open]").forEach((d) => d.removeAttribute("open")); });

  // Global delegation: any [data-team-hub] badge or [data-player] row anywhere in the app.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-team-hub]");
    if (t && t.dataset.teamHub) { e.preventDefault(); e.stopPropagation(); openTeam(t.dataset.teamHub); return; }
    const p = e.target.closest("[data-player]");
    if (p && p.dataset.player) { e.preventDefault(); e.stopPropagation(); openPlayer(p.dataset.player, p.dataset.name ? { fallback: { name: p.dataset.name, teamAbbr: p.dataset.team || "" } } : {}); }
  }, true);

  instance = {
    openTeam, openPlayer, openCompare, openDrawer, closeDrawer, chat,
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
