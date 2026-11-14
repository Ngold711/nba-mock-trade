// LiveWireTicker: an NYSE-tape style vertical feed that scrolls upward continuously.
//
//   const wire = mountLiveWire(el, { client, onSelect(item) {} });
//
// - Polls news, transactions, injuries and the scoreboard every 60s (the service caches each).
// - New items are inserted at the top; the scroll offset is compensated so nothing jumps, then
//   the tape glides back to the top on a spring so the NEW rows come into view.
// - Pauses on hover, keyboard focus, touch, and hidden tabs. Reduced motion → a normal scroll list.
import { buildWire, relativeTime, WIRE_FILTERS } from "../service/wire.js";
import { teamLogo, esc } from "./avatar.js";
import { Spring, reduceMotion } from "./motion.js";

const POLL_MS = 60_000;
const SPEED = 24;               // px per second
const FLASH_MS = 8000;

const CSS = `
.wire { --w-bg:#0a0d12; --w-panel:#0f141b; --w-line:rgba(255,255,255,.07); --w-text:#e6edf3; --w-dim:#8b97a7; --w-faint:#5b6675;
  --w-green:#22c55e; --w-red:#f87171; --w-amber:#fbbf24; --w-blue:#60a5fa; --w-slate:#94a3b8;
  background: var(--w-bg); color: var(--w-text); border-radius: 1.1rem; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 10px 30px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.05); min-width: 0; color-scheme: dark; }
.wire .mono { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.wire-head { display: flex; align-items: center; gap: .5rem; padding: .7rem .85rem .55rem; border-bottom: 1px solid var(--w-line); }
.wire-title { font-weight: 800; letter-spacing: .14em; font-size: .75rem; display: flex; align-items: center; gap: .45rem; flex: 1; }
.wire-title i { width: .45rem; height: .45rem; border-radius: 99px; background: var(--w-green); box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
.wire-title i.err { background: var(--w-amber); box-shadow: 0 0 0 3px rgba(251,191,36,.18); }
.wire-clock { font-size: .6875rem; color: var(--w-dim); }
.wire-filters { display: flex; gap: .3rem; padding: .5rem .6rem; border-bottom: 1px solid var(--w-line); background: var(--w-panel); }
.wire-filters button { all: unset; cursor: pointer; font: 700 .625rem/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .08em; padding: .35rem .55rem; border-radius: .4rem; color: var(--w-dim); }
.wire-filters button:hover { color: var(--w-text); background: rgba(255,255,255,.05); }
.wire-filters button[aria-pressed="true"] { color: #0a0d12; background: var(--w-text); }
.wire-filters button:focus-visible { outline: 2px solid var(--w-blue); }
.wire-view { position: relative; overflow: hidden; flex: 1; min-height: 0; outline: none; }
.wire-view::before, .wire-view::after { content: ""; position: absolute; left: 0; right: 0; height: 1.25rem; z-index: 2; pointer-events: none; }
.wire-view::before { top: 0; background: linear-gradient(var(--w-bg), rgba(10,13,18,0)); }
.wire-view::after { bottom: 0; background: linear-gradient(rgba(10,13,18,0), var(--w-bg)); }
.wire-view.static { overflow-y: auto; }
.wire-track { will-change: transform; }
.wire-list { list-style: none; margin: 0; padding: 0; }
.wire-row { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: auto auto minmax(0,1fr); gap: .55rem; align-items: start;
  width: 100%; padding: .6rem .8rem; border-bottom: 1px solid var(--w-line); transition: background-color .15s ease; }
.wire-row:hover { background: rgba(255,255,255,.035); }
.wire-row:focus-visible { outline: 2px solid var(--w-blue); outline-offset: -2px; }
.wire-row.flash { animation: wireflash 2.4s ease-out 2; }
@keyframes wireflash { 0% { background: rgba(250,204,21,.18); } 100% { background: transparent; } }
.wire-tag { font: 800 .5625rem/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .08em; padding: .28rem .38rem; border-radius: .3rem; min-width: 3.4rem; text-align: center; margin-top: .05rem; }
.wire-tag.green { color: var(--w-green); background: rgba(34,197,94,.13); } .wire-tag.red { color: var(--w-red); background: rgba(248,113,113,.13); }
.wire-tag.amber { color: var(--w-amber); background: rgba(251,191,36,.13); } .wire-tag.blue { color: var(--w-blue); background: rgba(96,165,250,.13); }
.wire-tag.slate { color: var(--w-slate); background: rgba(148,163,184,.12); }
.wire-team { width: 1.35rem; height: 1.35rem; display: grid; place-items: center; margin-top: -.05rem; }
.wire-team .avatar { --s: 1.35rem !important; }
.wire-team .none { width: 1.35rem; height: 1.35rem; border-radius: .35rem; background: rgba(255,255,255,.06); color: var(--w-faint); font: 700 .5rem/1.35rem ui-monospace, monospace; text-align: center; }
.wire-body { min-width: 0; }
.wire-hl { font-size: .8125rem; line-height: 1.35; font-weight: 550; letter-spacing: -.003em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wire-meta { display: flex; gap: .5rem; margin-top: .2rem; font-size: .625rem; color: var(--w-faint); letter-spacing: .04em; }
.wire-new-chip { font: 700 .5625rem/1 ui-monospace, monospace; color: #0a0d12; background: var(--w-amber); padding: .2rem .35rem; border-radius: .25rem; letter-spacing: .08em; }
.wire-more { position: absolute; top: .45rem; left: 50%; transform: translateX(-50%); z-index: 3; border: 0; cursor: pointer; font: 700 .625rem/1 ui-monospace, monospace; letter-spacing: .06em;
  color: #0a0d12; background: var(--w-amber); padding: .4rem .65rem; border-radius: 99px; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
.wire-empty { color: var(--w-dim); font-size: .8125rem; padding: 1rem; text-align: center; }
.wire-foot { font: 600 .5625rem/1 ui-monospace, monospace; letter-spacing: .08em; color: var(--w-faint); padding: .5rem .8rem; border-top: 1px solid var(--w-line); display: flex; justify-content: space-between; }
@media (prefers-reduced-motion: reduce) { .wire-row.flash { animation: none; background: rgba(250,204,21,.12); } }
`;

export function mountLiveWire(root, { client, onSelect = () => {} } = {}) {
  if (!document.getElementById("livewire-css")) {
    const s = document.createElement("style"); s.id = "livewire-css"; s.textContent = CSS; document.head.append(s);
  }
  root.classList.add("wire");
  root.setAttribute("aria-label", "LiveWire news and transactions ticker");
  root.innerHTML = `
    <header class="wire-head"><span class="wire-title"><i></i>LIVEWIRE</span><span class="wire-clock mono"></span></header>
    <div class="wire-filters" role="group" aria-label="Filter">
      ${["all", "moves", "injuries", "scores"].map((f, i) => `<button type="button" data-f="${f}" aria-pressed="${i === 0}">${f.toUpperCase()}</button>`).join("")}
    </div>
    <div class="wire-view" tabindex="0" role="region" aria-label="Ticker items">
      <button class="wire-more" type="button" hidden></button>
      <div class="wire-track"><ul class="wire-list"></ul><ul class="wire-list" aria-hidden="true" data-clone></ul></div>
    </div>
    <div class="wire-foot"><span class="wire-status">CONNECTING…</span><span>${matchMedia("(hover: hover)").matches ? "HOVER" : "TOUCH"} TO PAUSE</span></div>`;
  const view = root.querySelector(".wire-view"), track = root.querySelector(".wire-track");
  const list = root.querySelector(".wire-list"), clone = root.querySelector("[data-clone]");
  const more = root.querySelector(".wire-more"), status = root.querySelector(".wire-status");
  const statusDot = root.querySelector(".wire-title i"), clock = root.querySelector(".wire-clock");

  let items = [], filter = "all", firstLoad = true, pendingNew = 0;
  const seen = new Set(), flashUntil = new Map();
  let offset = 0, v = 0, looping = false, last = performance.now(), raf = 0, gliding = false;
  const pauses = new Set();
  const still = () => reduceMotion.matches;

  /* ---------- render ---------- */
  const rowHTML = (it, isClone) => {
    const t = it.team && it.team.abbr && it.team.abbr !== "—" ? teamLogo(it.team, { size: "1.35rem" }) : `<span class="none">NBA</span>`;
    const fresh = (flashUntil.get(it.id) || 0) > Date.now();
    const inner = `<span class="wire-tag ${it.tone}">${it.tag}</span><span class="wire-team">${t}</span>
      <span class="wire-body"><span class="wire-hl">${esc(it.headline)}</span>
      <span class="wire-meta mono">${fresh ? `<span class="wire-new-chip">NEW</span>` : ""}<span class="wire-time" data-ts="${it.time}">${relativeTime(it.time)}</span>${it.team?.abbr && it.team.abbr !== "—" ? `<span>${esc(it.team.abbr)}</span>` : ""}</span></span>`;
    const attrs = `class="wire-row${fresh ? " flash" : ""}" data-id="${esc(it.id)}"${isClone ? ' tabindex="-1"' : ""}`;
    return `<li>${it.url ? `<a ${attrs} href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<button type="button" ${attrs}>${inner}</button>`}</li>`;
  };
  function render() {
    const shown = items.filter(WIRE_FILTERS[filter]);
    list.innerHTML = shown.length ? shown.map((i) => rowHTML(i, false)).join("") : `<li class="wire-empty">Nothing here right now.</li>`;
    looping = !still() && list.offsetHeight > view.clientHeight + 8;
    clone.innerHTML = looping ? shown.map((i) => rowHTML(i, true)).join("") : "";
    view.classList.toggle("static", still());
    if (!looping) { offset = 0; apply(); }
  }
  const apply = () => { track.style.transform = offset ? `translate3d(0, ${-offset}px, 0)` : ""; };

  /* ---------- continuous marquee (rAF, so the offset can be adjusted without jumps) ---------- */
  const glide = new Spring(0, (x) => { offset = x; apply(); }, 0.5);
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (looping && !gliding) {
      const target = pauses.size ? 0 : SPEED;
      v += (target - v) * Math.min(1, dt * 5);          // ease into / out of pause instead of a hard stop
      if (target === 0 && v < 0.5) v = 0;               // then come to a true rest
      offset += v * dt;
      const H = list.offsetHeight;
      if (H > 0) { while (offset >= H) offset -= H; while (offset < 0) offset += H; }
      apply();
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  const pause = (k) => pauses.add(k), resume = (k) => pauses.delete(k);
  view.addEventListener("mouseenter", () => pause("hover"));
  view.addEventListener("mouseleave", () => resume("hover"));
  root.addEventListener("focusin", () => pause("focus"));
  root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget)) resume("focus"); });
  let touchTimer = 0;
  view.addEventListener("touchstart", () => { clearTimeout(touchTimer); pause("touch"); }, { passive: true });
  view.addEventListener("touchend", () => { touchTimer = setTimeout(() => resume("touch"), 3000); }, { passive: true });
  const vis = () => (document.hidden ? pause("hidden") : resume("hidden"));
  document.addEventListener("visibilitychange", vis);

  /* ---------- new items: insert at top, keep position, then glide up ---------- */
  function showNew() {
    more.hidden = true; pendingNew = 0;
    if (!looping) { view.scrollTop = 0; return; }
    gliding = true;
    glide.set(offset);
    glide.to(0, { damping: 1, response: 0.9, onDone: () => { gliding = false; } });
  }
  more.addEventListener("click", showNew);

  function ingest(next) {
    const fresh = firstLoad ? [] : next.filter((i) => !seen.has(i.id));
    next.forEach((i) => seen.add(i.id));
    fresh.forEach((i) => flashUntil.set(i.id, Date.now() + FLASH_MS));
    // Anchor on the row at the top of the window so it stays exactly where it is after re-render,
    // whatever was added above it or dropped elsewhere.
    let anchor = null;
    if (looping) {
      for (const row of list.querySelectorAll(".wire-row")) {
        if (row.offsetTop + row.offsetHeight > offset) { anchor = { id: row.dataset.id, delta: row.offsetTop - offset }; break; }
      }
    }
    items = next;
    render();
    if (fresh.length && looping) {
      const row = anchor && [...list.querySelectorAll(".wire-row")].find((r) => r.dataset.id === anchor.id);
      if (row) offset = row.offsetTop - anchor.delta;
      const H = list.offsetHeight; if (H > 0) { while (offset >= H) offset -= H; while (offset < 0) offset += H; }
      apply();
      const visibleFresh = fresh.filter(WIRE_FILTERS[filter]).length;
      if (visibleFresh) {
        if (pauses.size) { pendingNew += visibleFresh; more.textContent = `${pendingNew} NEW ↑`; more.hidden = false; }
        else showNew();
      }
    }
    firstLoad = false;
  }

  /* ---------- polling ---------- */
  let timer = 0, stopped = false;
  async function poll() {
    const names = ["news", "transactions", "injuries", "scoreboard"];
    const res = await Promise.allSettled(names.map((n) => client.get(n, {})));
    const feeds = {}; let failed = 0;
    res.forEach((r, i) => { if (r.status === "fulfilled") feeds[names[i]] = r.value.data; else failed++; });
    if (failed < names.length) ingest(buildWire(feeds));
    statusDot.classList.toggle("err", failed > 0);
    status.textContent = failed === names.length ? "FEED UNAVAILABLE · RETRYING" : `${items.length} ITEMS${failed ? ` · ${failed} FEED${failed > 1 ? "S" : ""} DOWN` : ""} · REFRESH 60S`;
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }
  poll();

  const clockTimer = setInterval(() => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    if (new Date().getSeconds() % 30 === 0) root.querySelectorAll(".wire-time").forEach((el) => { el.textContent = relativeTime(+el.dataset.ts); });
  }, 1000);

  /* ---------- interaction ---------- */
  root.querySelector(".wire-filters").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.f;
    root.querySelectorAll(".wire-filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    offset = 0; more.hidden = true; pendingNew = 0; render();
  });
  view.addEventListener("click", (e) => {
    const row = e.target.closest(".wire-row"); if (!row) return;
    const it = items.find((i) => i.id === row.dataset.id); if (!it) return;
    if (!it.url) { e.preventDefault(); onSelect(it); }
  });
  addEventListener("resize", () => render());

  return {
    refresh: poll,
    destroy() { stopped = true; clearTimeout(timer); clearInterval(clockTimer); cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis); },
    get items() { return items; },
  };
}
