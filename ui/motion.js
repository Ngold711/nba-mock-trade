// Fluid motion primitives: interruptible springs, momentum projection, rubber-banding,
// and a draggable bottom sheet. Shared by the trade builder and the live hub.

import { HooptraxWatermark } from "./brand.js";

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** Spring using Apple's damping ratio + response. Retargeting keeps current value and velocity. */
export class Spring {
  constructor(value, onUpdate, precision = 0.1) {
    this.x = value; this.v = 0; this.target = value; this.onUpdate = onUpdate;
    this.precision = precision; this.raf = 0; this.onDone = null;
    this.tick = this.tick.bind(this);   // bound method rather than a class field, for older Safari
  }
  set(x) { this.stop(); this.x = this.target = x; this.v = 0; this.onUpdate(x); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  to(target, { damping = 1, response = 0.4, velocity, onDone } = {}) {
    this.target = target; this.onDone = onDone || null;
    if (velocity !== undefined) this.v = velocity;
    const w = (2 * Math.PI) / response;
    this.k = w * w; this.c = 4 * Math.PI * damping / response;
    if (reduceMotion.matches) { this.set(target); onDone && onDone(); return this; }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
    return this;
  }
  tick(now) {
    let dt = Math.min((now - this.last) / 1000, 1 / 30); this.last = now;
    const h = 1 / 240;
    while (dt > 1e-6) {
      const s = Math.min(h, dt);
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * s; this.x += this.v * s; dt -= s;
    }
    if (Math.abs(this.x - this.target) < this.precision && Math.abs(this.v) < this.precision * 10) {
      this.x = this.target; this.v = 0; this.raf = 0; this.onUpdate(this.x);
      const d = this.onDone; this.onDone = null; d && d();
      return;
    }
    this.onUpdate(this.x);
    this.raf = requestAnimationFrame(this.tick);
  }
}

/** Apple's momentum projection (Designing Fluid Interfaces sample code). */
export const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
export const rubberband = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o));

/** Velocity from the last ~100ms of pointer samples. */
export function tracker() {
  const pts = [];
  return {
    push(p) { const t = performance.now(); pts.push({ p, t }); while (pts.length > 2 && t - pts[0].t > 100) pts.shift(); },
    velocity() {
      if (pts.length < 2) return 0;
      const a = pts[0], b = pts[pts.length - 1], dt = (b.t - a.t) / 1000;
      return dt > 0 ? (b.p - a.p) / dt : 0;
    },
    reset() { pts.length = 0; },
  };
}

/** Spring a freshly rendered element in from 94% scale / transparent. */
export function springIn(el) {
  el.style.opacity = "0"; el.style.transform = "scale(0.94)";
  new Spring(0, (p) => { el.style.opacity = String(Math.min(1, p)); el.style.transform = `scale(${0.94 + 0.06 * p})`; }, 0.001)
    .to(1, { damping: 1, response: 0.35, onDone: () => { el.style.transform = ""; } });
}

/**
 * Draggable bottom sheet. Enters from and exits to the bottom edge, can be grabbed
 * mid-flight, flicked closed (momentum projection + velocity handoff), rubber-bands upward.
 * open({ title, searchable, placeholder, render(body, query), onClose })
 */
let sheetSingleton = null;
export function createSheet() {
  if (sheetSingleton) return sheetSingleton;   // one sheet per page, shared by the tool and the app shell
  sheetSingleton = buildSheet();
  return sheetSingleton;
}
function buildSheet() {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const sheet = document.createElement("div");
  sheet.className = "sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "sheetTitle");
  sheet.innerHTML = `<div class="sheet-head"><div class="grabber" aria-hidden="true"></div>
      <div class="sheet-title"><h4 id="sheetTitle"></h4><button class="btn press" type="button" data-done>Done</button></div>
      <input class="search" id="sheetSearch" type="search" placeholder="Search" autocomplete="off" hidden></div>
    <div class="sheet-body"></div>
    <div class="sheet-foot">${HooptraxWatermark()}</div>`;
  document.body.append(scrim, sheet);
  const head = sheet.querySelector(".sheet-head"), body = sheet.querySelector(".sheet-body");
  const title = sheet.querySelector("h4"), search = sheet.querySelector(".search"), done = sheet.querySelector("[data-done]");

  let ctx = null, lastFocus = null;
  const height = () => sheet.offsetHeight + 24;
  const spring = new Spring(0, (y) => {
    sheet.style.transform = `translateY(${y}px)`;
    scrim.style.opacity = String(1 - Math.min(1, Math.max(0, y / height())));
  }, 0.5);

  const api = {
    get isOpen() { return !!ctx; },
    body,
    refresh() { if (ctx) ctx.render(body, search.value.trim().toLowerCase()); },
    setTitle(t) { title.textContent = t; },
    open(next) {
      const wasOpen = !!ctx;
      if (wasOpen && ctx.onClose) ctx.onClose();
      ctx = next; if (!wasOpen) lastFocus = document.activeElement;
      title.textContent = next.title || "";
      search.value = ""; search.placeholder = next.placeholder || "Search"; search.hidden = !next.searchable;
      api.refresh(); body.scrollTop = 0;
      sheet.style.visibility = "visible"; scrim.classList.add("on"); document.body.style.overflow = "hidden";
      if (reduceMotion.matches) {
        spring.set(0);
        sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      } else {
        if (!wasOpen && spring.x === 0) spring.set(height());
        spring.to(0, { damping: 1, response: 0.4 });
      }
      setTimeout(() => (next.searchable && matchMedia("(pointer: fine)").matches ? search : done).focus({ preventScroll: true }), 50);
    },
    close(velocity) {
      if (!ctx) return;
      const c = ctx; ctx = null;
      c.onClose && c.onClose();
      scrim.classList.remove("on"); document.body.style.overflow = "";
      const hide = () => { if (!ctx) sheet.style.visibility = "hidden"; };
      if (reduceMotion.matches) {
        sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 }).onfinish = () => { spring.set(height()); hide(); };
      } else {
        spring.to(height(), { damping: 1, response: 0.35, velocity, onDone: hide });
      }
      lastFocus?.focus?.({ preventScroll: true });
    },
  };

  scrim.addEventListener("pointerdown", () => api.close());
  done.addEventListener("click", () => api.close());
  search.addEventListener("input", () => api.refresh());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ctx) api.close(); });

  const vt = tracker();
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, input")) return;
    spring.stop(); // interrupt: grab from the on-screen value
    drag = { y: e.clientY, base: spring.x, id: e.pointerId };
    head.setPointerCapture(e.pointerId); vt.reset(); vt.push(e.clientY);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    vt.push(e.clientY);
    let y = drag.base + (e.clientY - drag.y);
    if (y < 0) y = rubberband(y, sheet.offsetHeight);
    spring.set(y);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    const v = vt.velocity();
    if (spring.x + project(v) > sheet.offsetHeight * 0.5) api.close(v);
    else spring.to(0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v });
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
  return api;
}

/** Toast that materializes from above, optional action button. */
export function createToast() {
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status");
  document.body.append(el);
  let timer = 0;
  const spring = new Spring(0, (p) => {
    el.style.opacity = String(Math.max(0, Math.min(1, p)));
    el.style.transform = `translateX(-50%) translateY(${(1 - p) * -12}px) scale(${0.96 + 0.04 * p})`;
  }, 0.001);
  const hide = () => { el.style.pointerEvents = "none"; spring.to(0, { damping: 1, response: 0.3 }); };
  return function toast(text, action) {
    el.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.className = "btn press"; b.type = "button"; b.textContent = action.label;
      b.style.cssText = "margin-left:.5rem;padding:.2rem .7rem";
      b.onclick = () => { action.run(); hide(); };
      el.append(" ", b);
    }
    el.style.pointerEvents = action ? "auto" : "none";
    spring.to(1, { damping: 1, response: 0.3 });
    clearTimeout(timer);
    timer = setTimeout(hide, action ? 4000 : 1800);
  };
}

/** Hairline under the sticky header once content scrolls beneath it. */
export function scrollEdge(bar) {
  const f = () => bar.style.setProperty("--edge", scrollY > 4 ? "1" : "0");
  addEventListener("scroll", f, { passive: true }); f();
}
