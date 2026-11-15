// Ask Hooptrax: slide-over NBA chat panel. Answers come from /api/nba-chat (Gemini grounded in live data,
// or the built-in local data engine). Player/team names in answers become chips that open Quick-View / Team Vault
// through the shell's global [data-player] / [data-team-hub] delegation.
import { esc } from "./avatar.js";
import { reduceMotion } from "./motion.js";

const KEY = "chat:v1";
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; } };
const save = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-30))); } catch {} };

/** Tiny, safe markdown: **bold**, bullets, numbered lines; then names → chips. */
function render(text, chips = []) {
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
  return h.split(/\n{2,}/).map((para) => {
    const lines = para.split("\n");
    if (lines.every((l) => /^\s*([•*-]|\d+\.)\s+/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      return `<${ordered ? "ol" : "ul"}>${lines.map((l) => `<li>${l.replace(/^\s*([•*-]|\d+\.)\s+/, "")}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
    }
    return `<p>${lines.join("<br>")}</p>`;
  }).join("");
}

export function mountChat({ getClient }) {
  const panel = document.createElement("aside");
  panel.className = "chat"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Ask Hooptrax"); panel.hidden = true;
  panel.innerHTML = `<div class="chat-head">
      <div class="chat-title"><span class="spark" aria-hidden="true">✦</span><div><b>Ask Hooptrax</b><span class="chat-badge"><i></i>Grounded in Live ESPN &amp; Hooptrax Data</span></div></div>
      <button class="icon-btn press chat-clear" type="button" aria-label="Clear conversation" title="Clear">⟲</button>
      <button class="icon-btn press" type="button" data-chat-close aria-label="Close chat"><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </div>
    <div class="chat-log" aria-live="polite"></div>
    <div class="chat-starters"></div>
    <form class="chat-form" autocomplete="off"><input class="chat-input" name="q" type="text" maxlength="500" placeholder="Ask about any NBA player, team or stat…" aria-label="Ask an NBA question" />
      <button class="chat-send" type="submit" aria-label="Send">↑</button></form>
    <p class="chat-foot">NBA questions only. Answers can be wrong; check key facts.</p>`;
  const scrim = document.createElement("div"); scrim.className = "chat-scrim";
  document.body.append(scrim, panel);
  const log = panel.querySelector(".chat-log"), form = panel.querySelector(".chat-form"), input = panel.querySelector(".chat-input"), starters = panel.querySelector(".chat-starters");
  let msgs = load(), busy = false;

  function paint() {
    log.innerHTML = msgs.length ? msgs.map((m) => m.role === "user"
      ? `<div class="msg user">${esc(m.text)}</div>`
      : `<div class="msg bot">${render(m.text, m.chips)}<span class="msg-src">${m.source?.startsWith("gemini") ? "Gemini · grounded in live data" : "Live Hooptrax data engine"}${m.note ? ` · ${esc(m.note)}` : ""}</span></div>`).join("")
      : `<div class="chat-hello"><b>Ask me anything NBA.</b><span>Scores, standings, injuries, the 3-2-1 lottery, prospects, 2K27 ratings, contracts, retired numbers, champions and award history.</span></div>`;
    if (busy) log.insertAdjacentHTML("beforeend", `<div class="msg bot typing"><i></i><i></i><i></i></div>`);
    starters.hidden = msgs.length > 0;
    log.scrollTop = log.scrollHeight;
  }
  async function paintStarters() {
    const base = ["Who are the top 2027 draft prospects?", "Which franchise has the most championships?", "Who leads the 3-2-1 lottery odds right now?", "Who has the most career assists?"];
    const out = [...base];
    try {
      const c = await getClient();
      const [sb, pl] = await Promise.allSettled([c.get("scoreboard", {}), c.get("players", {})]);
      const g = sb.status === "fulfilled" ? sb.value.data.games.find((x) => x.status.state === "in") || sb.value.data.games[0] : null;
      if (g) out[0] = g.status.state === "pre" ? `Preview tonight's ${g.away.name} at ${g.home.name} game` : `How's the ${g.away.name} vs ${g.home.name} game going?`;
      const top = pl.status === "fulfilled" ? pl.value.data.players.filter((p) => p.stats.gp >= 3).sort((a, b) => b.stats.pts - a.stats.pts)[0] : null;
      if (top) out[2] = `What's ${top.name}'s 2K27 rating and salary?`;
    } catch {}
    starters.innerHTML = out.map((q) => `<button type="button" class="starter">${esc(q)}</button>`).join("");
  }
  async function ask(q) {
    q = q.trim(); if (!q || busy) return;
    msgs.push({ role: "user", text: q }); busy = true; paint();
    try {
      const r = await fetch("/api/nba-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history: msgs.slice(-7, -1).map(({ role, text }) => ({ role, text })) }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || r.status);
      msgs.push({ role: "assistant", text: b.data.answer, chips: b.data.chips, source: b.data.source, note: b.data.note });
    } catch {
      msgs.push({ role: "assistant", text: "I couldn't reach the Hooptrax service. Check your connection and try again.", chips: [], source: "local" });
    }
    busy = false; save(msgs); paint();
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); });
  starters.addEventListener("click", (e) => { const b = e.target.closest(".starter"); if (b) ask(b.textContent); });
  panel.querySelector(".chat-clear").addEventListener("click", () => { msgs = []; save(msgs); paint(); paintStarters(); });
  panel.querySelector("[data-chat-close]").addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden && !document.querySelector(".sheet[style*='visible']")) close(); });

  function open() {
    panel.hidden = false; scrim.classList.add("on");
    requestAnimationFrame(() => panel.classList.add("in"));
    paint(); paintStarters();
    if (matchMedia("(pointer: fine)").matches) setTimeout(() => input.focus(), reduceMotion.matches ? 0 : 220);
  }
  function close() {
    panel.classList.remove("in"); scrim.classList.remove("on");
    setTimeout(() => { if (!panel.classList.contains("in")) panel.hidden = true; }, reduceMotion.matches ? 0 : 260);
  }
  return { open, close, ask, get isOpen() { return !panel.hidden; } };
}
