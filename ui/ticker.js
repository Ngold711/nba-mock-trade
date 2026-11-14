// LiveWireTicker: an NYSE-tape style vertical feed.
//
//   const wire = mountLiveWire(el, { client, onSelect(item) {} });
//
// Motion: a pure CSS @keyframes animation on the compositor (translate3d 0 → -50% over two copies
// of the list), duration = list height / 45 s, so speed is constant whatever the item count.
// Pausing: hover pauses only on devices with a real pointer; the header button pauses anywhere,
// and while paused the list scrolls by hand. Polls never re-mount the running list: new items are
// held behind an "↑ N New Updates" banner and applied on click or on resume. Text of items already
// on screen (live scores) is patched in place.
import { buildWire, relativeTime, WIRE_FILTERS } from "../service/wire.js";
import { teamLogo, esc } from "./avatar.js";
import { reduceMotion } from "./motion.js";

const POLL_MS = 60_000;
const PX_PER_SEC = 45;
const MAX_ITEMS = 25;
const FLASH_MS = 8000;

const CSS = `
.wire { --w-bg:#0a0d12; --w-panel:#0f141b; --w-line:rgba(255,255,255,.07); --w-text:#e6edf3; --w-dim:#8b97a7; --w-faint:#5b6675;
  --w-green:#22c55e; --w-red:#f87171; --w-amber:#fbbf24; --w-blue:#60a5fa; --w-slate:#94a3b8;
  background: var(--w-bg); color: var(--w-text); border-radius: var(--r-lg, 1.1rem); overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 10px 30px rgba(0,0,0,.18), inset 0 0 0 1px rgba(255,255,255,.05); min-width: 0; min-height: 0; color-scheme: dark; height: 100%; }
.wire .mono { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.wire-head { display: flex; align-items: center; gap: .5rem; padding: .6rem .7rem .5rem .85rem; border-bottom: 1px solid var(--w-line); }
.wire-title { font-weight: 800; letter-spacing: .14em; font-size: .75rem; display: flex; align-items: center; gap: .45rem; flex: 1; }
.wire-title i { width: .45rem; height: .45rem; border-radius: 99px; background: var(--w-green); box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
.wire-title i.err { background: var(--w-amber); box-shadow: 0 0 0 3px rgba(251,191,36,.18); }
.wire-title i.off { background: var(--w-faint); box-shadow: none; }
.wire-clock { font-size: .6875rem; color: var(--w-dim); }
.wire-toggle { all: unset; cursor: pointer; font: 700 .625rem/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .06em; padding: .4rem .55rem; border-radius: .45rem;
  color: var(--w-text); background: rgba(255,255,255,.08); min-height: 1.6rem; display: inline-flex; align-items: center; gap: .3rem; white-space: nowrap; }
.wire-toggle:hover { background: rgba(255,255,255,.14); }
.wire-toggle:focus-visible { outline: 2px solid var(--w-blue); }
.wire-toggle[aria-pressed="true"] { background: var(--w-green); color: #06210f; }
.wire-filters { display: flex; gap: .3rem; padding: .45rem .6rem; border-bottom: 1px solid var(--w-line); background: var(--w-panel); overflow-x: auto; scrollbar-width: none; }
.wire-filters::-webkit-scrollbar { display: none; }
.wire-filters button { all: unset; cursor: pointer; font: 700 .625rem/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .08em; padding: .4rem .55rem; border-radius: .4rem; color: var(--w-dim); white-space: nowrap; }
.wire-filters button:hover { color: var(--w-text); background: rgba(255,255,255,.05); }
.wire-filters button[aria-pressed="true"] { color: #0a0d12; background: var(--w-text); }
.wire-filters button:focus-visible { outline: 2px solid var(--w-blue); }
.wire-view { position: relative; overflow: hidden; flex: 1; min-height: 0; outline: none; }
.wire-view.manual { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.wire-view::before, .wire-view::after { content: ""; position: absolute; left: 0; right: 0; height: 1rem; z-index: 2; pointer-events: none; }
.wire-view::before { top: 0; background: linear-gradient(var(--w-bg), rgba(10,13,18,0)); }
.wire-view::after { bottom: 0; background: linear-gradient(rgba(10,13,18,0), var(--w-bg)); }
.wire-view.manual::before, .wire-view.manual::after { position: sticky; display: block; }
.wire-track { will-change: transform; transform: translate3d(0,0,0); }
.wire-track.run { animation: wire-scroll var(--wire-dur, 60s) linear infinite; }
.wire-track.hold { animation-play-state: paused; }
@keyframes wire-scroll { from { transform: translate3d(0,0,0); } to { transform: translate3d(0,-50%,0); } }
@media (hover: hover) and (pointer: fine) { .wire-view:hover .wire-track.run { animation-play-state: paused; } }
.wire-list { list-style: none; margin: 0; padding: 0; }
.wire-row { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: auto auto minmax(0,1fr); gap: .55rem; align-items: start;
  width: 100%; padding: .6rem .8rem; border-bottom: 1px solid var(--w-line); }
@media (hover: hover) { .wire-row:hover { background: rgba(255,255,255,.035); } }
.wire-row:focus-visible { outline: 2px solid var(--w-blue); outline-offset: -2px; }
.wire-row.flash { background: rgba(250,204,21,.12); }
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
.wire-banner { position: absolute; top: .45rem; left: 50%; transform: translateX(-50%); z-index: 3; border: 0; cursor: pointer; font: 700 .6875rem/1 ui-monospace, monospace; letter-spacing: .04em;
  color: #0a0d12; background: var(--w-amber); padding: .5rem .8rem; border-radius: 99px; box-shadow: 0 4px 14px rgba(0,0,0,.4); white-space: nowrap; min-height: 2rem; }
.wire-empty { color: var(--w-dim); font-size: .8125rem; padding: 1rem; text-align: center; }
.wire-foot { font: 600 .5625rem/1 ui-monospace, monospace; letter-spacing: .08em; color: var(--w-faint); padding: .5rem .8rem; border-top: 1px solid var(--w-line); }
@media (prefers-reduced-motion: reduce) { .wire-track.run { animation: none; } }
`;

export function mountLiveWire(root, { client, onSelect = () => {} } = {}) {
  if (!document.getElementById("livewire-css")) {
    const s = document.createElement("style"); s.id = "livewire-css"; s.textContent = CSS; document.head.append(s);
  }
  root.classList.add("wire");
  root.setAttribute("aria-label", "LiveWire news and transactions ticker");
  root.innerHTML = `
    <header class="wire-head"><span class="wire-title"><i></i>LIVEWIRE</span><span class="wire-clock mono"></span>
      <button class="wire-toggle" type="button" aria-pressed="false" aria-label="Pause ticker">⏸ Pause</button></header>
    <div class="wire-filters" role="group" aria-label="Filter">
      ${["all", "moves", "injuries", "scores"].map((f, i) => `<button type="button" data-f="${f}" aria-pressed="${i === 0}">${f.toUpperCase()}</button>`).join("")}
    </div>
    <div class="wire-view" role="region" aria-label="Ticker items" tabindex="0">
      <button class="wire-banner" type="button" hidden></button>
      <div class="wire-track"><ul class="wire-list"></ul><ul class="wire-list" aria-hidden="true" data-clone></ul></div>
    </div>
    <div class="wire-foot"><span class="wire-status">CONNECTING…</span></div>`;
  const view = root.querySelector(".wire-view"), track = root.querySelector(".wire-track");
  const list = root.querySelector(".wire-list"), clone = root.querySelector("[data-clone]");
  const banner = root.querySelector(".wire-banner"), status = root.querySelector(".wire-status");
  const dot = root.querySelector(".wire-title i"), clock = root.querySelector(".wire-clock");
  const toggle = root.querySelector(".wire-toggle");

  let all = [];             // everything from the last poll (all filters)
  let shown = [];           // what's mounted now
  let pending = null;       // newer list waiting to be applied
  let filter = "all", paused = false, first = true;
  const flashUntil = new Map();

  const take = (items) => items.filter(WIRE_FILTERS[filter]).slice(0, MAX_ITEMS);

  /* ---------- render (only on first load, filter change, or applying an update) ---------- */
  const rowHTML = (it, isClone) => {
    const t = it.team && it.team.abbr && it.team.abbr !== "—" ? teamLogo(it.team, { size: "1.35rem" }) : `<span class="none">NBA</span>`;
    const fresh = (flashUntil.get(it.id) || 0) > Date.now();
    const inner = `<span class="wire-tag ${it.tone}">${it.tag}</span><span class="wire-team">${t}</span>
      <span class="wire-body"><span class="wire-hl">${esc(it.headline)}</span>
      <span class="wire-meta mono">${fresh ? `<span class="wire-new-chip">NEW</span>` : ""}<span class="wire-time" data-ts="${it.time}">${relativeTime(it.time)}</span>${it.team?.abbr && it.team.abbr !== "—" ? `<span>${esc(it.team.abbr)}</span>` : ""}</span></span>`;
    const attrs = `class="wire-row${fresh ? " flash" : ""}" data-id="${esc(it.id)}"${isClone ? ' tabindex="-1"' : ""}`;
    return `<li>${it.url ? `<a ${attrs} href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<button type="button" ${attrs}>${inner}</button>`}</li>`;
  };
  function mount(items) {
    shown = items;
    list.innerHTML = items.length ? items.map((i) => rowHTML(i, false)).join("") : `<li class="wire-empty">Nothing here right now.</li>`;
    const loop = !reduceMotion.matches && list.offsetHeight > view.clientHeight + 8;
    clone.innerHTML = loop ? items.map((i) => rowHTML(i, true)).join("") : "";
    track.style.setProperty("--wire-dur", `${Math.max(8, list.offsetHeight / PX_PER_SEC).toFixed(2)}s`);
    track.classList.toggle("run", loop);
    track.style.animationDelay = "0s";
    if (paused) enterManual(0); else { view.classList.remove("manual"); view.scrollTop = 0; }
    banner.hidden = true; pending = null;
  }

  /* ---------- pause / resume with manual scrolling ---------- */
  function currentOffset() {
    const m = getComputedStyle(track).transform;
    if (!m || m === "none") return 0;
    const v = m.match(/matrix(3d)?\((.+)\)/); if (!v) return 0;
    const parts = v[2].split(",").map(Number);
    return -(v[1] ? parts[13] : parts[5]) || 0;
  }
  function enterManual(offset) {
    track.classList.remove("run");
    track.style.transform = "none";
    view.classList.add("manual");
    view.scrollTop = offset;
  }
  function setPaused(p) {
    paused = p;
    toggle.setAttribute("aria-pressed", String(!p ? false : true));
    toggle.textContent = p ? "▶ Live" : "⏸ Pause";
    toggle.setAttribute("aria-label", p ? "Resume ticker" : "Pause ticker");
    dot.classList.toggle("off", p);
    if (p) {
      enterManual(currentOffset());
    } else {
      if (pending) { mount(pending); return; }          // apply waiting updates on resume
      const H = list.offsetHeight || 1;
      const at = view.scrollTop % H;
      view.classList.remove("manual"); view.scrollTop = 0;
      track.style.transform = "";
      const loop = clone.innerHTML !== "";
      track.classList.toggle("run", loop);
      // continue from where the reader left off: a negative delay starts the loop mid-way
      track.style.animationDelay = loop ? `-${(at / PX_PER_SEC).toFixed(2)}s` : "0s";
    }
  }
  toggle.addEventListener("click", () => setPaused(!paused));
  banner.addEventListener("click", () => { if (pending) mount(pending); });

  /* ---------- polling ---------- */
  let timer = 0, stopped = false;
  async function poll() {
    const names = ["news", "transactions", "injuries", "scoreboard"];
    const res = await Promise.allSettled(names.map((n) => client.get(n, {})));
    const feeds = {}; let failed = 0;
    res.forEach((r, i) => { if (r.status === "fulfilled") feeds[names[i]] = r.value.data; else failed++; });
    if (failed < names.length) ingest(buildWire(feeds));
    dot.classList.toggle("err", failed > 0 && !paused);
    status.textContent = failed === names.length ? "FEED UNAVAILABLE · RETRYING" : `${shown.length} ITEMS${failed ? ` · ${failed} FEED${failed > 1 ? "S" : ""} DOWN` : ""} · REFRESH 60S`;
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }
  function ingest(next) {
    // dedupe by id (buildWire already does; keep this cheap and defensive)
    const seenIds = new Set(); next = next.filter((i) => !seenIds.has(i.id) && seenIds.add(i.id));
    all = next;
    const nextShown = take(next);
    if (first) { first = false; mount(nextShown); return; }
    const have = new Set(shown.map((i) => i.id));
    const fresh = nextShown.filter((i) => !have.has(i.id));
    // patch text of rows already on screen (live scores) without re-mounting
    const byId = new Map(next.map((i) => [i.id, i]));
    root.querySelectorAll(".wire-row").forEach((row) => {
      const it = byId.get(row.dataset.id); if (!it) return;
      const hl = row.querySelector(".wire-hl"); if (hl && hl.textContent !== it.headline) hl.textContent = it.headline;
    });
    if (!fresh.length) return;
    fresh.forEach((i) => flashUntil.set(i.id, Date.now() + FLASH_MS));
    pending = nextShown;
    banner.textContent = `↑ ${fresh.length} New Update${fresh.length > 1 ? "s" : ""}`;
    banner.hidden = false;
  }
  poll();

  const clockTimer = setInterval(() => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    if (new Date().getSeconds() % 30 === 0) root.querySelectorAll(".wire-time").forEach((el) => { el.textContent = relativeTime(+el.dataset.ts); });
  }, 1000);

  /* ---------- interaction ---------- */
  root.querySelector(".wire-filters").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.f;
    root.querySelectorAll(".wire-filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    mount(take(all));
  });
  view.addEventListener("click", (e) => {
    const row = e.target.closest(".wire-row"); if (!row) return;
    const it = all.find((i) => i.id === row.dataset.id) || shown.find((i) => i.id === row.dataset.id); if (!it) return;
    if (!it.url) { e.preventDefault(); onSelect(it); }
  });
  view.addEventListener("keydown", (e) => { if (e.key === " " && e.target === view) { e.preventDefault(); setPaused(!paused); } });
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (!paused && shown.length) mount(shown); }, 250); };
  addEventListener("resize", onResize);

  return {
    refresh: poll,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    remount: () => mount(shown),
    get paused() { return paused; },
    get items() { return shown; },
    get pendingCount() { return pending ? pending.filter((i) => !shown.some((s) => s.id === i.id)).length : 0; },
    destroy() { stopped = true; clearTimeout(timer); clearInterval(clockTimer); removeEventListener("resize", onResize); },
  };
}
