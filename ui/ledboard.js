// Wall Street-style LED ticker board: three stacked horizontal tapes in a pitch-black bezel.
//
//   Row 1  Live scoreboard tape      BOS 118 ▲ +4  LAL 114 · F
//   Row 2  Player market + 2K27      L. DONCIC 38P/11A ▲ +5.4   ·   C. FLAGG 2K 90 ▲ +3
//   Row 3  Injury & transaction wire INJ: J. MORANT (OUT) ▼     ·   MOVE: MIN SIGNED C J. BROOME ▲
//
// Motion: one Web Animations API transform per row (translate3d 0 → −50% over two copies), so it runs on
// the compositor at 60fps. Speeds 55 / 65 / 50 px/s. No hover pausing (it traps iPhone Safari); a single
// ⏸ / ▶ button pauses and resumes all three rows. Content updates keep each row's scroll position.
// Taps: a game quote opens the Game Center (onGame), a player or injury quote opens Player Quick-View
// through the shell's global [data-player] delegation.
import { esc } from "./avatar.js";
import { reduceMotion } from "./motion.js";

const SPEEDS = [55, 65, 50];
const TICK = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
const tk = (abbr) => TICK[abbr] || String(abbr || "").toUpperCase();
const shortName = (n) => { const p = String(n || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").split(/\s+/); return (p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : p[0] || "").toUpperCase(); };
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const sign = (x, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;

const CSS = `
.led { position: relative; background: #05070A; border-radius: 0.9rem; overflow: hidden; color-scheme: dark; margin: 0.75rem 0 1rem;
  box-shadow: inset 0 0 0 1px #11161F, inset 0 1px 0 rgba(255,255,255,.04), 0 10px 30px rgba(0,0,0,.35); padding-right: 3rem; }
.led::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: radial-gradient(rgba(255,255,255,.035) 0.6px, transparent 0.7px) 0 0 / 3px 3px, repeating-linear-gradient(180deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px); }
.led::after { content: ""; position: absolute; top: 0; bottom: 0; right: 3rem; width: 2.5rem; pointer-events: none; z-index: 2; background: linear-gradient(90deg, transparent, #05070A); }
.led-row { position: relative; overflow: hidden; height: 1.95rem; display: flex; align-items: center; border-top: 1px solid #0E131B; }
.led-row:first-child { border-top: 0; }
.led-lab { position: relative; z-index: 3; flex: none; height: 100%; display: grid; place-items: center; padding: 0 0.55rem; background: #05070A; border-right: 1px solid #141A24;
  font: 800 0.5625rem/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.12em; color: #5B6577; }
.led-viewport { position: relative; flex: 1; min-width: 0; height: 100%; overflow: hidden; }
.led-track { position: absolute; left: 0; top: 0; height: 100%; display: flex; align-items: center; white-space: nowrap; will-change: transform; }
.led-q { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 0.45rem; padding: 0 1.1rem; height: 100%;
  font: 600 12.5px/1 "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; text-transform: uppercase;
  color: #DDE6F0; text-shadow: 0 0 6px rgba(221,230,240,.25); }
.led-q:focus-visible { outline: 1px solid #F59E0B; outline-offset: -3px; }
.led-q + .led-q { border-left: 1px solid #10151D; }
.led-q .sym { margin-right: 0.375rem; color: #F59E0B; text-shadow: 0 0 8px rgba(245,158,11,.55); font-weight: 800; }
.led-q .up { color: #00E676; text-shadow: 0 0 8px rgba(0,230,118,.55); }
.led-q .dn { color: #FF3B30; text-shadow: 0 0 8px rgba(255,59,48,.55); }
.led-q .dim { color: #7C8798; text-shadow: none; }
.led-q .live { color: #00E676; }
.led-btn { all: unset; position: absolute; z-index: 4; right: 0; top: 0; bottom: 0; width: 3rem; display: grid; place-items: center; cursor: pointer; background: #080B10;
  border-left: 1px solid #141A24; color: #F59E0B; font-size: 1rem; text-shadow: 0 0 8px rgba(245,158,11,.5); }
.led-btn:focus-visible { outline: 2px solid #F59E0B; outline-offset: -2px; }
.led-btn:active { background: #0D1118; }
.led.static .led-viewport { overflow-x: auto; scrollbar-width: none; } .led.static .led-viewport::-webkit-scrollbar { display: none; }
.led.static .led-track { position: static; }
@media (max-width: 34rem) { .led-lab { padding: 0 0.4rem; font-size: 0.5rem; } .led-q { font-size: 12px; padding: 0 0.85rem; } }
`;

export function mountLedBoard(el, { client, onGame = () => {} }) {
  if (!document.getElementById("led-css")) { const st = document.createElement("style"); st.id = "led-css"; st.textContent = CSS; document.head.append(st); }
  el.className = "led";
  el.setAttribute("role", "region"); el.setAttribute("aria-label", "Live market board: scores, player movers, injuries and moves");
  el.innerHTML = ["SCORES", "MOVERS", "WIRE"].map((l, i) => `<div class="led-row" data-row="${i}"><span class="led-lab" aria-hidden="true">${l}</span><div class="led-viewport"><div class="led-track"></div></div></div>`).join("")
    + `<button class="led-btn" type="button" aria-pressed="false" aria-label="Pause ticker">⏸</button>`;
  const rows = [...el.querySelectorAll(".led-row")].map((row, i) => ({ row, track: row.querySelector(".led-track"), anim: null, html: "", speed: SPEEDS[i] }));
  let paused = false;
  const btn = el.querySelector(".led-btn");
  const staticMode = () => reduceMotion.matches;

  function setRow(r, items) {
    const html = items.length ? items.join("") : `<span class="led-q"><span class="dim">— NO DATA YET —</span></span>`;
    if (html === r.html) return;
    r.html = html;
    const frac = r.anim && r.anim.effect ? ((r.anim.currentTime || 0) % r.anim.effect.getTiming().duration) / r.anim.effect.getTiming().duration : 0;
    r.anim?.cancel(); r.anim = null;
    r.track.innerHTML = html + (staticMode() ? "" : html);           // two copies → seamless loop at −50%
    el.classList.toggle("static", staticMode());
    if (staticMode()) return;
    requestAnimationFrame(() => {
      const w = r.track.scrollWidth / 2;
      if (!w) return;
      const duration = (w / r.speed) * 1000;
      r.anim = r.track.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(-50%,0,0)" }], { duration, iterations: Infinity, easing: "linear" });
      r.anim.currentTime = frac * duration;
      if (paused || document.hidden) r.anim.pause();
    });
  }
  btn.addEventListener("click", () => {
    paused = !paused;
    btn.textContent = paused ? "▶" : "⏸"; btn.setAttribute("aria-pressed", String(paused)); btn.setAttribute("aria-label", paused ? "Resume ticker" : "Pause ticker");
    rows.forEach((r) => (paused ? r.anim?.pause() : r.anim?.play()));
  });
  document.addEventListener("visibilitychange", () => rows.forEach((r) => (document.hidden || paused ? r.anim?.pause() : r.anim?.play())));
  reduceMotion.addEventListener?.("change", () => rows.forEach((r) => { r.html = ""; }));
  el.addEventListener("click", (e) => { const g = e.target.closest("[data-led-game]"); if (g) onGame(g.dataset.ledGame); });

  /* ---------- data ---------- */
  const S = { today: null, yesterday: null, season: new Map(), ratings: null, injuries: null, moves: null };
  const draw = () => { setRow(rows[0], scoresRow()); setRow(rows[1], moversRow()); setRow(rows[2], wireRow()); };

  function games() {
    const t = S.today?.games || [];
    const started = t.some((g) => g.status.state !== "pre");
    const y = !started ? (S.yesterday?.games || []).filter((g) => g.status.state === "post") : [];
    return { today: t, recent: y };
  }
  function quote(g, tag = "") {
    const a = g.away, h = g.home; if (!a || !h) return "";
    const st = g.status.state;
    if (st === "pre") {
      const time = new Date(g.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP])M/i, "$1");
      return `<button class="led-q" type="button" data-led-game="${esc(g.id)}"><span class="sym">${tk(a.abbr)}</span><span class="dim">@</span><span class="sym">${tk(h.abbr)}</span><span class="dim">${esc(time)}</span></button>`;
    }
    const lead = (a.score ?? 0) >= (h.score ?? 0) ? a : h, trail = lead === a ? h : a;
    const diff = (lead.score ?? 0) - (trail.score ?? 0);
    const clock = st === "in" ? `<span class="live">${esc(g.status.shortDetail || "LIVE")}</span>` : `<span class="dim">${tag || "F"}</span>`;
    return `<button class="led-q" type="button" data-led-game="${esc(g.id)}"><span class="sym">${tk(lead.abbr)}</span>${lead.score ?? 0}${diff ? `<span class="up">▲ +${diff}</span>` : `<span class="dim">=</span>`}<span class="sym">${tk(trail.abbr)}</span>${trail.score ?? 0}${clock}</button>`;
  }
  function scoresRow() {
    const { today, recent } = games();
    const order = { in: 0, post: 1, pre: 2 };
    return [...today.slice().sort((x, y) => order[x.status.state] - order[y.status.state]).map((g) => quote(g)), ...recent.map((g) => quote(g, "F · YDA"))];
  }
  function moversRow() {
    const out = [];
    const { today, recent } = games();
    const box = [...today, ...recent].filter((g) => g.status.state !== "pre");
    const perf = new Map();
    for (const g of box) for (const t of [g.away, g.home]) for (const l of t?.leaders || []) {
      const id = l.athlete?.id; if (!id) continue;
      const p = perf.get(id) || perf.set(id, { athlete: l.athlete, team: t.abbr }).get(id);
      const v = parseFloat(l.value); if (!Number.isFinite(v)) continue;
      if (/^PTS|POINTS/i.test(l.category)) p.pts = v; else if (/^REB/i.test(l.category)) p.reb = v; else if (/^AST/i.test(l.category)) p.ast = v;
    }
    const list = [...perf.values()].filter((p) => p.pts != null).sort((a, b) => b.pts - a.pts).slice(0, 12);
    for (const p of list) {
      const season = S.season.get(p.athlete.id);
      const delta = season?.pts != null ? p.pts - season.pts : null;
      const line = [p.pts != null ? `${p.pts}P` : "", p.reb != null ? `${p.reb}R` : "", p.ast != null ? `${p.ast}A` : ""].filter(Boolean).join("/");
      out.push(`<button class="led-q" type="button" data-player="${esc(p.athlete.id)}" data-name="${esc(p.athlete.name)}" data-team="${esc(p.team)}"><span class="sym">${esc(shortName(p.athlete.name))}</span>${line}${delta != null ? `<span class="${delta >= 0 ? "up" : "dn"}">${delta >= 0 ? "▲" : "▼"} ${sign(delta)}</span>` : ""}</button>`);
    }
    if (!list.length && S.season.size) {
      // nothing tipped yet: season scoring leaders as the opening tape
      for (const p of [...S.season.values()].filter((x) => x.gp >= 3).sort((a, b) => b.pts - a.pts).slice(0, 8)) {
        out.push(`<button class="led-q" type="button" data-player="${esc(p.id)}" data-name="${esc(p.name)}"><span class="sym">${esc(shortName(p.name))}</span>${p.pts.toFixed(1)} PPG<span class="dim">SEASON</span></button>`);
      }
    }
    const movers = (S.ratings?.players || []).filter((p) => p.delta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.ovr - a.ovr).slice(0, 10);
    for (const r of movers) out.push(`<button class="led-q" type="button" data-player="${esc(r.id)}" data-name="${esc(r.name)}" data-team="${esc(r.teamAbbr)}"><span class="sym">${esc(shortName(r.name))}</span>2K ${r.ovr}<span class="${r.delta > 0 ? "up" : "dn"}">${r.delta > 0 ? "▲" : "▼"} ${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}</span></button>`);
    return out;
  }
  function wireRow() {
    const out = [];
    const inj = (S.injuries || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 14);
    for (const i of inj) {
      const status = String(i.status || "").toUpperCase().replace("DAY-TO-DAY", "DTD");
      out.push(`<button class="led-q" type="button" data-player="${esc(i.athlete?.id || "")}" data-name="${esc(i.athlete?.name || "")}" data-team="${esc(i.team?.abbr || "")}"><span class="dim">INJ:</span><span class="sym">${esc(shortName(i.athlete?.name))}</span><span class="dim">${esc(tk(i.team?.abbr))}</span>(${esc(status)})<span class="dn">▼</span></button>`);
    }
    for (const m of (S.moves || []).slice(0, 10)) {
      const txt = String(m.description || "").replace(/\.$/, "").toUpperCase();
      out.push(`<span class="led-q"><span class="dim">MOVE:</span><span class="sym">${esc(tk(m.team?.abbr))}</span> ${esc(txt.length > 64 ? txt.slice(0, 62) + "…" : txt)}<span class="up">▲</span></span>`);
    }
    // interleave injuries and moves so neither dominates the tape
    const a = out.filter((h) => h.includes("INJ:")), b = out.filter((h) => !h.includes("INJ:"));
    const mixed = []; for (let k = 0; k < Math.max(a.length, b.length); k++) { if (a[k]) mixed.push(a[k]); if (b[k]) mixed.push(b[k]); }
    return mixed;
  }

  draw();
  const stops = [
    client.watch("scoreboard", {}, (d) => { S.today = d; draw(); }),
    client.watch("injuries", {}, (d) => { S.injuries = d; draw(); }),
    client.watch("transactions", {}, (d) => { S.moves = d; draw(); }),
  ];
  const y = new Date(); y.setDate(y.getDate() - 1);
  client.get("scoreboard", { date: ymd(y) }).then(({ data }) => { S.yesterday = data; draw(); }).catch(() => {});
  client.get("players", {}).then(({ data }) => { for (const p of data.players) S.season.set(p.id, { id: p.id, name: p.name, pts: p.stats.pts, gp: p.stats.gp }); draw(); }).catch(() => {});
  client.get("ratings", {}).then(({ data }) => { S.ratings = data; draw(); }).catch(() => {});
  return { destroy() { stops.forEach((s) => s?.()); rows.forEach((r) => r.anim?.cancel()); }, get paused() { return paused; } };
}
