// Hooptrax AI: floating orb + full-height chat sheet with saved conversations.
// Answers stream from /api/nba-chat (Gemini grounded in a question-sliced view of the live cache, or the
// local data engine). Player/team names become chips and the server attaches compact stat cards; both open
// Quick-View / Team Vault through the shell's global [data-player] / [data-team-hub] delegation.
//
// Conversations [{ id, title, updatedAt, messages[] }], newest first, are private to whoever is using the app:
//   signed in → stored server-side per account (/api/ai-threads, filtered by the session user); nothing on disk here
//   guest     → kept in this page's memory only: a refresh, a new tab or "Continue as Guest" wipes them.
// Signing in, signing out or switching accounts resets the chat to that account's own history.
// Closing the sheet (✕, backdrop tap, swipe down) saves the conversation to History and resets: the next tap on
// the orb always opens a brand-new blank chat. An answer still streaming when the sheet closes finishes in the
// background and is saved to its own thread.
import { esc, avatar, teamLogo } from "./avatar.js";
import { reduceMotion, dismissOnBackdrop } from "./motion.js";
import { account } from "./account.js";

const MAX_THREADS = 50, MAX_MSGS = 80;

/** Thread repository for the current identity (an account, or the in-memory guest). */
function createRepo() {
  let list = [], owner, loading = null;
  const timers = new Map();
  const post = (path, body, keepalive = false) => fetch(path, { method: "POST", credentials: "same-origin", keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  const send = (th) => { timers.delete(th.id); if (account.user && account.user.id === owner) post("/api/ai-threads", th); };
  return {
    get list() { return [...list].sort((a, b) => b.updatedAt - a.updatedAt); },
    get owner() { return owner; },
    /** Load the signed-in user's threads (guests: start empty). Re-runs only when the identity changes. */
    ensure() {
      const id = account.user?.id || null;
      if (owner === id && loading) return loading;
      if (owner === id) return Promise.resolve();
      owner = id; list = [];
      loading = !id ? Promise.resolve() : fetch("/api/ai-threads", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j && owner === id) list = j.data.threads || []; }).catch(() => {});
      return loading;
    },
    put(th) {
      list = [th, ...list.filter((t) => t.id !== th.id)].slice(0, MAX_THREADS);
      if (!account.user || account.user.id !== owner) return;                   // guest: memory only
      clearTimeout(timers.get(th.id)); timers.set(th.id, setTimeout(() => send(th), 400));
    },
    flush() { for (const [id, t] of timers) { clearTimeout(t); const th = list.find((x) => x.id === id); if (th && account.user?.id === owner) post("/api/ai-threads", th, true); } timers.clear(); },
    remove(id) { list = list.filter((t) => t.id !== id); clearTimeout(timers.get(id)); timers.delete(id); if (account.user && account.user.id === owner) post(`/api/ai-threads/${encodeURIComponent(id)}/delete`, {}); },
    clear() { list = []; timers.forEach(clearTimeout); timers.clear(); if (account.user && account.user.id === owner) post("/api/ai-threads/clear", {}); },
    reset() { list = []; owner = undefined; loading = null; timers.forEach(clearTimeout); timers.clear(); },
  };
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const titleOf = (q) => { const t = String(q).replace(/\s+/g, " ").trim().replace(/[?.!]+$/, ""); return t.length > 48 ? t.slice(0, 46).replace(/\s+\S*$/, "") + "…" : t || "New chat"; };
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ORB_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="14" cy="17" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M4 17h20M14 7v20M7 10c3 3 3 11 0 14M21 10c-3 3-3 11 0 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path class="orb-spark" d="M26 2.5l1.2 3.3 3.3 1.2-3.3 1.2L26 11.5l-1.2-3.3L21.5 7l3.3-1.2z" fill="currentColor"/></svg>`;
const X_SVG = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

/** Tiny, safe markdown: **bold**, bullets, numbered lines; then names → chips. */
export function render(text, chips = []) {
  // 1) swap names for placeholders (longest first, max 2 links per name), 2) escape + format, 3) restore as chips
  const sorted = [...chips].sort((a, b) => b.label.length - a.label.length);
  const tokens = [];
  let t = String(text);
  for (const c of sorted) {
    const re = new RegExp(`(^|[^\\w])(${c.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?!\\w)`, "g");
    let n = 0;
    t = t.replace(re, (m, pre, name) => { if (n++ >= 2) return m; tokens.push({ c, name }); return `${pre}\u0000${tokens.length - 1}\u0000`; });
  }
  let h = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/\u0000(\d+)\u0000/g, (m, i) => {
    const { c, name } = tokens[+i];
    const attr = c.type === "player" ? `data-player="${esc(c.id)}" data-name="${esc(c.label)}"` : `data-team-hub="${esc(c.id)}"`;
    return `<button class="chat-chip ${c.type}" type="button" ${attr}>${esc(name)}</button>`;
  });
  const BUL = /^\s*([•*-]|\d+\.)\s+/;
  return h.split(/\n{2,}/).map((para) => {
    const lines = para.split("\n").filter((l) => l.trim());
    if (!lines.length) return "";
    // a lead line followed by bullets → paragraph + list
    const firstBul = lines.findIndex((l) => BUL.test(l));
    if (firstBul > 0 && lines.slice(firstBul).every((l) => BUL.test(l))) return `<p>${lines.slice(0, firstBul).join("<br>")}</p>${list(lines.slice(firstBul))}`;
    if (lines.every((l) => BUL.test(l))) return list(lines);
    return `<p>${lines.join("<br>")}</p>`;
  }).join("");
  function list(lines) {
    const ordered = /^\s*\d+\./.test(lines[0]);
    return `<${ordered ? "ol" : "ul"}>${lines.map((l) => `<li>${l.replace(BUL, "")}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
  }
}

const CODE_OF = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
/** Compact inline stat cards (player / game). */
export function renderCards(cards = []) {
  if (!cards.length) return "";
  return `<div class="ai-cards">${cards.map((c) => {
    if (c.type === "player") {
      const l = c.line;
      return `<button class="ai-card pc press" type="button" data-player="${esc(c.id)}" data-name="${esc(c.name)}" style="--c:${esc(c.team?.color || "#64748b")}">
        <span class="pc-top">${avatar({ name: c.name, headshot: c.headshot }, { size: "2.6rem", color: c.team?.color || "#64748b" })}
          <span class="pc-id"><b>${esc(c.name)}</b><small>${c.team?.logo ? `<img src="${esc(c.team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}${esc(c.sub || "")}</small></span>
          ${c.ovr ? `<span class="pc-ovr" title="2K27 OVR">${c.ovr}</span>` : ""}</span>
        ${l ? `<span class="pc-line"><span><b>${l.ppg}</b>PPG</span><span><b>${l.rpg}</b>RPG</span><span><b>${l.apg}</b>APG</span><em>${esc(l.label)}</em></span>` : ""}
      </button>`;
    }
    const side = (s) => `<span class="gc-team" data-team-hub="${esc(CODE_OF[s.abbr] || s.abbr)}" role="button" tabindex="0">${teamLogo(s, { size: "1.6rem" })}<b>${esc(s.abbr)}</b>${c.state !== "pre" && s.score != null ? `<span class="gc-score">${s.score}</span>` : ""}</span>`;
    const won = (s, o) => c.state === "post" && s.score > o.score;
    return `<div class="ai-card gc ${c.state}">
      <span class="gc-row${won(c.away, c.home) ? " w" : ""}">${side(c.away)}</span>
      <span class="gc-row${won(c.home, c.away) ? " w" : ""}">${side(c.home)}</span>
      <span class="gc-pill">${c.state === "in" ? '<i class="gc-live"></i>' : ""}${esc(c.day)} · ${esc(c.detail)}</span>
    </div>`;
  }).join("")}</div>`;
}

export function mountChat({ getClient }) {
  /* ---------- floating orb ---------- */
  const orb = document.createElement("button");
  orb.type = "button"; orb.className = "ai-orb press"; orb.id = "aiOrb";
  orb.setAttribute("aria-haspopup", "dialog"); orb.setAttribute("aria-label", "Ask Hooptrax, the NBA AI assistant");
  orb.innerHTML = `<span class="orb-spark-txt" aria-hidden="true">✦</span><span class="orb-l">Ask Hooptrax</span>`;

  /* ---------- sheet ---------- */
  const panel = document.createElement("section");
  panel.className = "chat"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Hooptrax AI"); panel.hidden = true;
  panel.innerHTML = `<div class="chat-grab" aria-hidden="true"></div>
    <div class="chat-head">
      <button class="chat-tb press" type="button" data-hist aria-label="Conversation history" aria-expanded="false"><span aria-hidden="true">🕒</span> History</button>
      <div class="chat-title"><span class="orb-mini" aria-hidden="true">${ORB_SVG}</span><b>Hooptrax AI</b></div>
      <button class="chat-tb press" type="button" data-new aria-label="New chat">＋ New Chat</button>
      <button class="icon-btn press chat-x" type="button" data-chat-close aria-label="Close">${X_SVG}</button>
    </div>
    <div class="chat-body">
      <div class="chat-log" aria-live="polite"></div>
      <div class="chat-starters"></div>
      <aside class="chat-hist" hidden aria-label="Saved conversations">
        <div class="hist-head"><b>History</b><button class="chat-tb press" type="button" data-hist-close>Done</button></div>
        <div class="hist-list"></div>
        <div class="hist-foot"><button class="hist-clear press" type="button" data-clear-all>Clear All History</button></div>
      </aside>
    </div>
    <form class="chat-form" autocomplete="off"><textarea class="chat-input" name="q" rows="1" maxlength="500" placeholder="Ask anything NBA…" aria-label="Ask an NBA question" enterkeyhint="send"></textarea>
      <button class="chat-send" type="submit" aria-label="Send"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.8 7.5 8 3.3l4.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>
    <p class="chat-foot"><i></i>Live ESPN &amp; Hooptrax data · NBA only · can make mistakes</p>`;
  const scrim = document.createElement("div"); scrim.className = "chat-scrim";
  document.body.append(orb, scrim, panel);
  document.body.classList.add("has-orb");

  const $ = (s) => panel.querySelector(s);
  const log = $(".chat-log"), form = $(".chat-form"), input = $(".chat-input"), starters = $(".chat-starters");
  const hist = $(".chat-hist"), histList = $(".hist-list");

  /* ---------- threads ---------- */
  const repo = createRepo();
  let cur = null;                           // the open thread { id, title, updatedAt, messages }
  const pending = new Set();                // ids of threads with an answer still streaming
  const deleted = new Set();
  const busyHere = () => !!cur && pending.has(cur.id);
  const blank = () => ({ id: uid(), title: "New chat", updatedAt: Date.now(), messages: [] });
  function persist(th = cur) {
    if (!th?.messages.length || deleted.has(th.id)) return;
    th.updatedAt = Date.now();
    th.messages = th.messages.slice(-MAX_MSGS);
    repo.put(th);
  }
  addEventListener("pagehide", () => repo.flush());
  /** Identity changed (sign in, sign out, switch account, Continue as Guest): drop everything in memory. */
  function resetAll() {
    repo.reset(); pending.clear(); deleted.clear(); cur = null;
    if (!panel.hidden) { cur = blank(); showHist(false); paint(); paintStarters(); repo.ensure(); }
  }
  let lastUser = account.user?.id || null;
  account.onChange((u) => { const id = u?.id || null; if (id !== lastUser) { lastUser = id; resetAll(); } });
  addEventListener("htx:reset", resetAll);

  /* ---------- paint ---------- */
  const srcLabel = (m) => (m.source?.startsWith("gemini") ? "Hooptrax AI · live data" : "Hooptrax data engine") + (m.note ? ` · ${m.note}` : "");
  const botHtml = (m) => `${render(m.text, m.chips)}${renderCards(m.cards)}<span class="msg-src">${esc(srcLabel(m))}</span>`;
  function paint() {
    const msgs = cur.messages;
    log.innerHTML = msgs.length
      ? msgs.map((m) => (m.role === "user" ? `<div class="msg user">${esc(m.text)}</div>` : `<div class="msg bot">${botHtml(m)}</div>`)).join("")
      : `<div class="chat-hello"><span class="hello-orb" aria-hidden="true">${ORB_SVG}</span><b>What do you want to know?</b><span>Tonight's games and the next 14 days of schedules, live stats, injuries, standings, trades and the cap, the draft, 2K27 ratings, and every era of NBA history.</span></div>`;
    if (busyHere()) log.insertAdjacentHTML("beforeend", `<div class="msg bot typing" aria-label="Thinking"><i></i><i></i><i></i></div>`);
    starters.hidden = msgs.length > 0;
    scrollDown(true);
  }
  let stick = true;
  log.addEventListener("scroll", () => { stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60; }, { passive: true });
  const scrollDown = (force) => { if (force || stick) log.scrollTop = log.scrollHeight; };

  async function paintStarters() {
    const out = ["Who plays tomorrow?", "Who won MVP in 1996?", "Who leads the 3-2-1 lottery odds right now?", "Top 2027 draft prospects?"];
    starters.innerHTML = out.map((q) => `<button type="button" class="starter press">${esc(q)}</button>`).join("");
    try {
      const c = await getClient();
      const [sb, pl] = await Promise.allSettled([c.get("scoreboard", {}), c.get("players", {})]);
      const games = sb.status === "fulfilled" ? sb.value.data.games : [];
      const g = games.find((x) => x.status.state === "in") || games.find((x) => x.status.state === "pre");
      if (g) out[0] = g.status.state === "in" ? `How's ${g.away.name} vs ${g.home.name} going?` : `Preview ${g.away.name} at ${g.home.name}`;
      const top = pl.status === "fulfilled" ? pl.value.data.players.filter((p) => p.stats.gp >= 3).sort((a, b) => b.stats.pts - a.stats.pts)[0] : null;
      if (top) out[2] = `How is ${top.name} doing this season?`;
      starters.innerHTML = out.map((q) => `<button type="button" class="starter press">${esc(q)}</button>`).join("");
    } catch {}
  }

  /* ---------- history drawer ---------- */
  function paintHist() {
    const threads = repo.list;
    histList.innerHTML = threads.length
      ? threads.map((t) => `<div class="hist-row${cur && t.id === cur.id ? " cur" : ""}">
          <button class="hist-open press" type="button" data-open="${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc(ago(t.updatedAt))} · ${t.messages.length} message${t.messages.length === 1 ? "" : "s"}</small></button>
          <button class="hist-del press" type="button" data-del="${esc(t.id)}" aria-label="Delete “${esc(t.title)}”">🗑</button></div>`).join("")
      : `<div class="hist-empty">${account.user ? "No saved conversations yet." : "Guest chats aren't saved. Sign in to keep your conversations."}</div>`;
    $("[data-clear-all]").hidden = !threads.length;
    $("[data-clear-all]").textContent = "Clear All History"; delete $("[data-clear-all]").dataset.armed;
  }
  function showHist(on) {
    hist.hidden = !on; $("[data-hist]").setAttribute("aria-expanded", String(on));
    if (on) { paintHist(); repo.ensure().then(() => { if (!hist.hidden) paintHist(); }); requestAnimationFrame(() => hist.classList.add("in")); } else hist.classList.remove("in");
  }
  histList.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]"), d = e.target.closest("[data-del]");
    if (o) { const t = repo.list.find((x) => x.id === o.dataset.open); if (t) { cur = t; showHist(false); paint(); } }
    if (d) {
      const id = d.dataset.del;
      deleted.add(id); repo.remove(id);
      if (cur?.id === id) { cur = blank(); paint(); paintStarters(); }
      paintHist();
    }
  });
  $("[data-clear-all]").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete all"; setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "Clear All History"; } }, 3000); return; }
    repo.list.forEach((t) => deleted.add(t.id)); pending.forEach((id) => deleted.add(id));
    repo.clear(); cur = blank(); paintHist(); paint(); paintStarters(); showHist(false);
  });
  $("[data-hist]").addEventListener("click", () => showHist(hist.hidden));
  $("[data-hist-close]").addEventListener("click", () => showHist(false));
  $("[data-new]").addEventListener("click", () => { persist(); cur = blank(); showHist(false); paint(); paintStarters(); input.focus({ preventScroll: true }); });

  /* ---------- ask (streamed) ---------- */
  async function ask(q) {
    q = String(q || "").trim(); if (!q || busyHere()) return;
    const th = cur;                         // the answer always lands in this thread, even if the sheet closes
    const asker = account.user?.id || null; // …and only for the identity that asked
    if (!th.messages.length) th.title = titleOf(q);
    const history = th.messages.slice(-6).map(({ role, text }) => ({ role, text }));
    th.messages.push({ role: "user", text: q }); pending.add(th.id); persist(th); paint();
    const msg = { role: "assistant", text: "", chips: [], cards: [], source: "local" };
    let el = null, raf = 0;
    const visible = () => cur === th && !panel.hidden;
    const ensureEl = () => {
      if (el && el.isConnected) return el;
      log.querySelector(".typing")?.remove();
      el = document.createElement("div"); el.className = "msg bot streaming"; log.append(el); return el;
    };
    const flush = () => { raf = 0; if (!visible()) return; ensureEl().innerHTML = `${render(msg.text, [])}${renderCards(msg.cards)}<span class="caret" aria-hidden="true"></span>`; scrollDown(); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };
    try {
      let r, tries = 0;
      for (;;) {
        try { r = await fetch("/api/nba-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history, stream: true }) }); break; }
        catch (e) { if (++tries > 1) throw e; await new Promise((res) => setTimeout(res, 600)); }
      }
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const o = JSON.parse(line);
          if (o.t === "meta") { msg.cards = o.cards || []; if (msg.cards.length) schedule(); }
          else if (o.t === "delta") { msg.text = o.replace ? o.text : msg.text + o.text; schedule(); }
          else if (o.t === "done") Object.assign(msg, { text: o.answer, chips: o.chips || [], source: o.source, note: o.note || "" });
        }
        if (done) break;
      }
      if (!msg.text) throw new Error("empty");
    } catch {
      msg.text = navigator.onLine === false
        ? "You're offline, so I can't pull live NBA data right now. Reconnect and ask again."
        : "That one didn't come through. Tap a suggestion or ask again.";
      msg.source = "local"; msg.cards = msg.cards || [];
    }
    cancelAnimationFrame(raf);
    if ((account.user?.id || null) !== asker) return;                       // signed in/out meanwhile: drop it
    th.messages.push(msg); pending.delete(th.id); persist(th);
    if (visible()) { const node = ensureEl(); node.classList.remove("streaming"); node.innerHTML = botHtml(msg); scrollDown(); }
  }

  /* ---------- input ---------- */
  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; grow(); ask(q); });
  starters.addEventListener("click", (e) => { const b = e.target.closest(".starter"); if (b) ask(b.textContent); });
  log.addEventListener("keydown", (e) => { const t = e.target.closest(".gc-team"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); } });

  /* ---------- open / close ---------- */
  $("[data-chat-close]").addEventListener("click", close);
  dismissOnBackdrop(scrim, () => close(), { isOpen: () => isOpen() });
  orb.addEventListener("click", () => (isOpen() ? close() : open()));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || panel.hidden || document.querySelector(".sheet[style*='visible']")) return;
    if (!hist.hidden) showHist(false); else close();
  });
  const isOpen = () => !panel.hidden;

  /* swipe down on the grabber / top bar to dismiss */
  let drag = null;
  const grabZone = (e) => e.target.closest(".chat-grab, .chat-head") && !e.target.closest("button");
  panel.addEventListener("pointerdown", (e) => {
    if (!grabZone(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    panel.setPointerCapture?.(e.pointerId); panel.style.transition = "none";
  });
  panel.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    panel.style.transform = `translateY(${drag.dy}px)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const v = drag.dy / Math.max(1, performance.now() - drag.t);       // px/ms
    const dismiss = drag.dy > 110 || (drag.dy > 30 && v > 0.6);
    drag = null; panel.style.transition = "";
    if (dismiss) close(); else panel.style.transform = "";
  };
  panel.addEventListener("pointerup", endDrag); panel.addEventListener("pointercancel", endDrag);
  let lastFocus = null;
  function open() {
    cur ||= blank();
    repo.ensure();
    lastFocus = document.activeElement;
    panel.hidden = false; scrim.classList.add("on"); orb.classList.add("hide"); document.documentElement.classList.add("chat-open");
    requestAnimationFrame(() => panel.classList.add("in"));
    showHist(false); paint(); if (!cur.messages.length) paintStarters();
    if (matchMedia("(pointer: fine)").matches) setTimeout(() => input.focus({ preventScroll: true }), reduceMotion.matches ? 0 : 240);
    else $("[data-chat-close]").focus({ preventScroll: true });
  }
  function close() {
    if (panel.hidden) return;
    panel.classList.remove("in"); scrim.classList.remove("on"); orb.classList.remove("hide"); document.documentElement.classList.remove("chat-open");
    panel.style.transform = "";
    persist(); cur = null;                  // saved to History; the next open starts a brand-new chat
    showHist(false);
    setTimeout(() => { if (!panel.classList.contains("in")) panel.hidden = true; }, reduceMotion.matches ? 0 : 300);
    lastFocus?.focus?.({ preventScroll: true });
  }
  return { open, close, ask, get isOpen() { return isOpen(); }, get thread() { return cur; } };
}
