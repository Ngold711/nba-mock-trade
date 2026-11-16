// Hooptrax accounts on the client: welcome gate (sign in / sign up vs. Continue as Guest), header account pill,
// sign-in / sign-up sheet, profile sheet (Public Posts | 🔒 Private Vault, item detail with visibility toggle,
// delete and Load into Sandbox), and the save flow used by the Trade Machine and Mock Draft.
//
// Sessions live in an HTTP-only cookie the page can't read; localStorage "htx:acct" only mirrors "someone is
// signed in" so the guest clean-up script in each page's <head> knows not to wipe a member's work.
import { createSheet, createToast, dismissOnBackdrop } from "./motion.js";
import { esc } from "./avatar.js";
import { currentUid, adoptGuestWork, clearUserCache, resetGuestMemory } from "./scoped.js";

export const TEAM_NAMES = {
  ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets", CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards",
};
const SLUG = { GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" };
export const logoUrl = (code) => (code ? `https://a.espncdn.com/i/teamlogos/nba/500/${SLUG[code] || code.toLowerCase()}.png` : "");
export const logoImg = (code, size = "1.25rem") => (code ? `<img class="acct-logo" src="${esc(logoUrl(code))}" alt="" width="20" height="20" style="width:${size};height:${size}" loading="lazy" referrerpolicy="no-referrer">` : "");
export const ago = (iso, now = Date.now()) => {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const GUEST_MSG = "Create a free Hooptrax account to save privately or post to the community";
// Session hints for synchronous start-up (written only after the server confirms the session): "htx:uid" picks the
// per-user storage scope in ui/scoped.js; "htx:acct" is the display name.
const flag = {
  set(u) {
    try {
      if (u) { localStorage.setItem("htx:acct", u.username); localStorage.setItem("htx:uid", u.id); }
      else { localStorage.removeItem("htx:acct"); localStorage.removeItem("htx:uid"); }
    } catch {}
  },
};
/** The page loaded with one identity's data but the server says another (expired session, other tab logged in/out):
 *  fix the hint and reload once so nothing from the wrong scope stays on screen. */
function syncScope(user) {
  const want = user?.id || null, had = currentUid();
  if (want === had) { try { sessionStorage.removeItem("htx:sync"); } catch {} return false; }
  flag.set(user);
  let tried = null; try { tried = sessionStorage.getItem("htx:sync"); sessionStorage.setItem("htx:sync", String(want)); } catch {}
  if (tried === String(want)) return false;              // storage blocked: don't loop
  location.reload(); return true;
}

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; e.fields = j.fields; throw e; }
  return j.data;
}

/* ---------- item breakdown (shared by the profile vault and the community feed) ---------- */
export function itemBody(it, { full = false } = {}) {
  const p = it.payloadJson || {};
  if (it.type === "trade") {
    const lines = (p.lines || []).map((l) => `<li>${logoImg(l.team)}<b>${esc(l.team)}</b> gets <span>${esc((l.gets || []).join(", ") || "—")}</span></li>`).join("");
    return `<div class="it-trade"><ul class="it-lines">${lines}</ul>${p.verdict?.head ? `<span class="it-verdict ${esc(p.verdict.kind || "")}">${esc(p.verdict.head)}</span>` : ""}</div>`;
  }
  if (it.type === "tierlist") {
    const TIERS = ["S", "A", "B", "C", "D", "F"];
    const rows = TIERS.filter((k) => (p.tiers?.[k] || []).length);
    const show = full ? rows : rows.slice(0, 4);
    return `<div class="it-tiers"><span class="it-sub">${esc(p.category || "Tier list")} · ${TIERS.reduce((n, k) => n + (p.tiers?.[k] || []).length, 0)} ranked</span>${show.map((k) => `<div class="it-tier"><span class="tl-badge t-${k}">${k}</span><span>${(p.tiers[k] || []).slice(0, full ? 60 : 6).map((x) => esc(x.n)).join(", ")}${!full && p.tiers[k].length > 6 ? ` +${p.tiers[k].length - 6}` : ""}</span></div>`).join("")}</div>`;
  }
  const board = p.board || [];
  const show = full ? board : board.slice(0, 5);
  return `<div class="it-draft"><span class="it-sub">${esc(p.year)} mock draft · ${board.length} pick${board.length === 1 ? "" : "s"}${p.formatLabel ? ` · ${esc(p.formatLabel)}` : ""}</span>
    <ol class="it-picks">${show.map((b) => `<li><span class="num">${b.pick}</span>${logoImg(b.team)}<b>${esc(b.name)}</b><small>${esc([b.pos, b.school].filter(Boolean).join(" · "))}</small></li>`).join("")}</ol>
    ${!full && board.length > show.length ? `<span class="it-more">+${board.length - show.length} more picks</span>` : ""}</div>`;
}
export const openHref = (it) => (it.type === "trade" ? `index.html?trade=${encodeURIComponent(it.payloadJson?.trade || "")}` : it.type === "tierlist" ? `tierlist.html?item=${encodeURIComponent(it.id)}` : `draft.html?item=${encodeURIComponent(it.id)}`);
export const openLabel = (it) => (it.type === "trade" ? "Open in Trade Machine" : it.type === "tierlist" ? "Open Tier List" : "Open in Mock Draft");

/* ---------- module state ---------- */
let me = null, counts = null, loaded = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(me); } catch {} });
let readyP = null;
export function refreshMe() {
  readyP = api("/api/auth/me").then((d) => { me = d.user; counts = d.counts; if (syncScope(me)) return me; loaded = true; emit(); return me; })
    .catch(() => { loaded = true; emit(); return me; });
  return readyP;
}

export const account = {
  get user() { return me; },
  get loaded() { return loaded; },
  ready: () => readyP || refreshMe(),
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Run `action` now if signed in; otherwise ask the guest to sign up, then run it (their work stays in memory). */
  requireAuth(action, message = GUEST_MSG) { if (me) return action(); openAuth({ mode: "signup", message, then: action }); },
  save, openAuth, openProfile, saveFlow,
};

/* ---------- sheet + toast (shared singletons) ---------- */
let sheet = null, toast = null;
const S = () => (sheet ||= createSheet());
const T = (...a) => (toast ||= createToast())(...a);

/* ---------- sign in / sign up ---------- */
function teamOptions(sel) {
  return `<option value="">Favorite team (optional)</option>${Object.entries(TEAM_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => `<option value="${c}"${c === sel ? " selected" : ""}>${esc(n)}</option>`).join("")}`;
}
export function openAuth({ mode = "signup", message = "", then = null } = {}) {
  let m = mode, mounted = false;
  S().open({
    title: m === "signup" ? "Create your free account" : "Log in",
    render(body) {
      if (mounted) return; mounted = true;          // the host page may call sheet.refresh(); never wipe a half-typed form
      const draw = () => {
        S().setTitle(m === "signup" ? "Create your free account" : "Log in");
        body.innerHTML = `${message ? `<p class="auth-msg">${esc(message)}</p>` : ""}
          <div class="auth-seg seg2" role="tablist"><button type="button" role="tab" data-mode="signup" aria-selected="${m === "signup"}">Create account</button><button type="button" role="tab" data-mode="login" aria-selected="${m === "login"}">Log in</button></div>
          <form class="auth-form" novalidate autocomplete="on">
            ${m === "signup" ? `
              <label>Email<input name="email" type="email" inputmode="email" autocomplete="email" required maxlength="254" /></label>
              <label>Username<span class="at-wrap"><span>@</span><input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" /></span></label>
              <label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72" /><small>At least 8 characters</small></label>
              <label>Favorite team<select name="favoriteTeam">${teamOptions("")}</select></label>`
            : `<label>Email or @username<input name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>`}
            <p class="auth-err" role="alert" hidden></p>
            <button class="btn primary auth-go press" type="submit">${m === "signup" ? "Create Free Account" : "Log In"}</button>
            <p class="auth-fine">${m === "signup" ? "Free forever. Your email is never shown to other users. Passwords are stored as bcrypt hashes." : "Signed in for 30 days on this device."}</p>
          </form>`;
        body.querySelector("input")?.focus({ preventScroll: true });
      };
      draw();
      body.onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b && b.dataset.mode !== m) { m = b.dataset.mode; draw(); } };
      body.onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target, err = body.querySelector(".auth-err"), go = body.querySelector(".auth-go");
        const data = Object.fromEntries(new FormData(f).entries());
        err.hidden = true; go.disabled = true; go.textContent = m === "signup" ? "Creating…" : "Logging in…";
        try {
          const d = await api(`/api/auth/${m}`, { method: "POST", body: data });
          me = d.user; counts = d.counts; flag.set(me);
          const carried = adoptGuestWork(me.id);   // the guest's in-progress trade / draft / ballot moves into this account
          if (!carried && !then) { try { sessionStorage.setItem("htx:gate", "member"); } catch {} location.reload(); return; }   // load this account's own work
          emit();
          sessionStorage.setItem("htx:gate", "member");
          closeGate(); S().close();
          T(m === "signup" ? `Welcome to Hooptrax, @${me.username}` : `Signed in as @${me.username}`);
          if (then) setTimeout(() => then(), 60);
        } catch (x) {
          err.textContent = x.message; err.hidden = false;
          go.disabled = false; go.textContent = m === "signup" ? "Create Free Account" : "Log In";
          const bad = x.fields && Object.keys(x.fields)[0]; if (bad) f.elements[bad]?.focus();
        }
      };
    },
    onClose() { if (sheet) { sheet.body.onclick = null; sheet.body.onsubmit = null; } },
  });
}

/* ---------- save ---------- */
async function save({ type, title, payload, visibility }) {
  const d = await api("/api/items", { method: "POST", body: { type, title, payload, visibility } });
  if (counts) counts[visibility] = (counts[visibility] || 0) + 1;
  return d.item;
}
/**
 * The two buttons: 🔒 Save Privately saves at once; 🌎 Save & Post asks for an optional headline first.
 * `build()` returns { title, payload } from the tool's current state (called after sign-in, so guest work survives).
 */
export function saveFlow({ type, visibility, build }) {
  account.requireAuth(() => {
    const got = build(); if (!got) return;
    if (visibility === "private") {
      save({ type, title: got.title, payload: got.payload, visibility: "private" })
        .then(() => T("🔒 Saved to your Private Vault", { label: "View", run: () => openProfile({ tab: "private" }) }))
        .catch((e) => T(e.message));
      return;
    }
    let mounted = false;
    S().open({
      title: "Post to the Community",
      render(body) {
        if (mounted) return; mounted = true;
        body.innerHTML = `<form class="auth-form post-form">
            <label>Headline (optional)<input name="title" type="text" maxlength="140" value="${esc(got.title || "")}" placeholder="${type === "tierlist" ? "e.g. My point guard tiers" : type === "trade" ? "e.g. Lakers go all in" : "e.g. My 2027 mock: Wizards land the #1 pick"}" /></label>
            <div class="post-preview">${itemBody({ type, payloadJson: got.payload })}</div>
            <p class="auth-err" role="alert" hidden></p>
            <button class="btn primary auth-go press" type="submit">🌎 Save &amp; Post</button>
            <p class="auth-fine">Posted as @${esc(me.username)}. You can make it private or delete it any time from your profile.</p></form>`;
        body.onsubmit = async (e) => {
          e.preventDefault();
          const go = body.querySelector(".auth-go"), err = body.querySelector(".auth-err");
          go.disabled = true; go.textContent = "Posting…";
          try {
            await save({ type, title: new FormData(e.target).get("title") || got.title, payload: got.payload, visibility: "public" });
            S().close(); T("🌎 Posted to the Community Feed", { label: "Open Feed", run: () => { location.href = "live.html#feed"; } });
          } catch (x) { err.textContent = x.message; err.hidden = false; go.disabled = false; go.textContent = "🌎 Save & Post"; }
        };
      },
      onClose() { if (sheet) sheet.body.onsubmit = null; },
    });
  });
}

/* ---------- profile ---------- */
export function openProfile({ tab = "public" } = {}) {
  if (!me) return openAuth({ mode: "login" });
  let view = tab, items = null, detail = null, armed = null;
  const load = async () => { items = null; draw(); try { items = (await api(`/api/me/items/${view}`)).items; } catch (e) { items = []; T(e.message); } draw(); };
  let body = null;
  const draw = () => {
    if (!body) return;
    if (detail) {
      const it = detail;
      body.innerHTML = `<button class="link-back press" type="button" data-back>‹ Back</button>
        <div class="it-detail"><div class="it-head"><span class="it-type ${it.type}">${it.type === "trade" ? "Trade" : it.type === "tierlist" ? "Tier List" : "Mock Draft"}</span><span class="it-vis">${it.visibility === "public" ? "🌎 Public" : "🔒 Private"}</span><small>${esc(ago(it.createdAt))}${it.visibility === "public" ? ` · ▲ ${it.likesCount}` : ""}</small></div>
          <h4 class="it-title">${esc(it.title || (it.type === "trade" ? "Untitled trade" : it.type === "tierlist" ? "Untitled tier list" : "Untitled mock draft"))}</h4>
          ${itemBody(it, { full: true })}
          <div class="it-acts">
            <a class="btn primary press" href="${esc(openHref(it))}">Load into Sandbox</a>
            <button class="btn ghost press" type="button" data-vis>${it.visibility === "public" ? "🔒 Make Private" : "🌎 Make Public"}</button>
            <button class="btn ghost danger press" type="button" data-del>${armed === it.id ? "Tap again to delete" : "Delete"}</button>
          </div></div>`;
      return;
    }
    const n = counts || { public: 0, private: 0 };
    body.innerHTML = `<div class="prof-head">${me.favoriteTeam ? logoImg(me.favoriteTeam, "2.6rem") : `<span class="prof-ph">@</span>`}
        <div class="prof-id"><b>@${esc(me.username)}</b><small>${n.public} post${n.public === 1 ? "" : "s"} · ${n.private} private save${n.private === 1 ? "" : "s"}</small></div>
        <button class="btn ghost press" type="button" data-logout>Log Out</button></div>
      <label class="prof-team">Favorite team<select data-team>${teamOptions(me.favoriteTeam || "")}</select></label>
      <div class="auth-seg seg2" role="tablist"><button type="button" role="tab" data-tab="public" aria-selected="${view === "public"}">Public Posts</button><button type="button" role="tab" data-tab="private" aria-selected="${view === "private"}">🔒 Private Vault</button></div>
      <div class="prof-list">${items == null ? `<div class="empty">Loading…</div>` : items.length ? items.map((it) => `<button class="it-row press" type="button" data-item="${esc(it.id)}">
          <span class="it-type ${it.type}">${it.type === "trade" ? "Trade" : it.type === "tierlist" ? "Tiers" : "Draft"}</span><span class="it-t"><b>${esc(it.title || (it.type === "trade" ? (it.payloadJson?.teams || []).join(" ⇄ ") : `${it.payloadJson?.year} mock draft`))}</b><small>${esc(ago(it.createdAt))}${it.visibility === "public" ? ` · ▲ ${it.likesCount}` : ""}</small></span><span aria-hidden="true">›</span></button>`).join("")
        : `<div class="empty">${view === "public" ? "Nothing posted yet. Use 🌎 Save &amp; Post in the Trade Machine or Mock Draft." : "Nothing saved yet. Use 🔒 Save Privately in the Trade Machine or Mock Draft."}</div>`}</div>`;
  };
  S().open({
    title: "Your Profile",
    render(b) {
      if (body === b) { draw(); return; }           // a host refresh: repaint, don't reload or rebind
      body = b; draw();
      b.onclick = async (e) => {
        const t = e.target;
        if (t.closest("[data-logout]")) { await logout(); return; }
        const tb = t.closest("[data-tab]"); if (tb && tb.dataset.tab !== view) { view = tb.dataset.tab; load(); return; }
        const row = t.closest("[data-item]"); if (row) { detail = items.find((x) => x.id === row.dataset.item); armed = null; draw(); b.scrollTop = 0; return; }
        if (t.closest("[data-back]")) { detail = null; draw(); return; }
        if (t.closest("[data-vis]") && detail) {
          const next = detail.visibility === "public" ? "private" : "public";
          try { const d = await api(`/api/items/${detail.id}/update`, { method: "POST", body: { visibility: next } }); counts[detail.visibility]--; counts[next]++; items = items.filter((x) => x.id !== detail.id); detail = d.item; draw(); T(next === "public" ? "🌎 Now public in the Community Feed" : "🔒 Moved to your Private Vault"); } catch (x) { T(x.message); }
          return;
        }
        if (t.closest("[data-del]") && detail) {
          if (armed !== detail.id) { armed = detail.id; draw(); return; }
          try { await api(`/api/items/${detail.id}/delete`, { method: "POST", body: {} }); counts[detail.visibility]--; items = items.filter((x) => x.id !== detail.id); detail = null; armed = null; draw(); T("Deleted"); } catch (x) { T(x.message); }
        }
      };
      b.onchange = async (e) => {
        if (!e.target.matches("[data-team]")) return;
        try { const d = await api("/api/me", { method: "POST", body: { favoriteTeam: e.target.value || null } }); me = d.user; emit(); draw(); } catch (x) { T(x.message); }
      };
      load();
    },
    onClose() { if (sheet) { sheet.body.onclick = null; sheet.body.onchange = null; } body = null; },
  });
}

/** Log out: end the session, remove this user's cached work from the device, and restart the page clean. */
export async function logout() {
  const id = me?.id;
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  if (id) clearUserCache(id);
  me = null; counts = null; flag.set(null); resetGuestMemory();
  try { sessionStorage.setItem("htx:gate", "guest"); } catch {}
  location.reload();
}
account.logout = logout;

/* ---------- welcome gate ---------- */
let gate = null;
function closeGate() { if (!gate) return; gate.classList.remove("in"); const g = gate; gate = null; setTimeout(() => g.remove(), 220); }
function showGate() {
  if (gate) return;
  gate = document.createElement("div");
  gate.className = "gate"; gate.setAttribute("role", "dialog"); gate.setAttribute("aria-modal", "true"); gate.setAttribute("aria-labelledby", "gateTitle");
  gate.innerHTML = `<div class="gate-card">
      <button class="gate-x press" type="button" data-gate="guest" aria-label="Close and continue as guest">✕</button>
      <span class="gate-ball" aria-hidden="true">🏀</span>
      <h3 id="gateTitle">Welcome to Hooptrax</h3>
      <p>Save trades and mock drafts to your private vault, post them to the community, and upvote the best.</p>
      <button class="btn primary press gate-go" type="button" data-gate="account">Create Free Account / Log In</button>
      <button class="btn ghost press" type="button" data-gate="guest">Continue as Guest</button>
      <small>Guests get every tool, but nothing is saved: AI chats, trades, drafts and ballots clear when you refresh or leave.</small></div>`;
  document.body.append(gate);
  requestAnimationFrame(() => gate?.classList.add("in"));
  const guest = () => {
    try { sessionStorage.setItem("htx:gate", "guest"); } catch {}
    resetGuestMemory(); dispatchEvent(new CustomEvent("htx:reset"));   // start the guest session with nothing kept
    closeGate();
  };
  dismissOnBackdrop(gate, guest, { isOpen: () => !!gate });
  gate.addEventListener("click", (e) => {
    const b = e.target.closest("[data-gate]"); if (!b) return;
    if (b.dataset.gate === "guest") guest();
    else { closeGate(); openAuth({ mode: "signup" }); }
  });
  document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape" && gate) { guest(); document.removeEventListener("keydown", esc1); } });
  setTimeout(() => gate?.querySelector(".gate-go")?.focus({ preventScroll: true }), 80);
}

/* ---------- header pill ---------- */
export function mountAccount({ slot }) {
  const pill = document.createElement("button");
  pill.type = "button"; pill.className = "acct-pill press"; pill.id = "acctPill";
  const paint = () => {
    if (me) { pill.innerHTML = `${me.favoriteTeam ? logoImg(me.favoriteTeam, "1.25rem") : '<span class="acct-dot">@</span>'}<span class="acct-name">@${esc(me.username)}</span>`; pill.setAttribute("aria-label", `Your profile, @${me.username}`); pill.classList.add("in"); }
    else { pill.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="acct-name">Sign in</span>`; pill.setAttribute("aria-label", "Sign in or create a free account"); pill.classList.remove("in"); }
  };
  paint();
  slot.before(pill);
  pill.addEventListener("click", () => (me ? openProfile() : openAuth({ mode: "login" })));
  account.onChange(paint);
  account.ready().then(() => {
    let seen = null; try { seen = sessionStorage.getItem("htx:gate"); } catch {}
    if (!me && !seen) setTimeout(showGate, 350);
  });
  return pill;
}
