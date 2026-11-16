// Player headshots (and team logos) with a graceful fallback.
// The initials badge renders underneath; the photo fades in over it on load. If the
// image fails (ESPN has no headshot yet for many rookies / two-way / new signings,
// and their CDN answers 404), the onerror handler removes the <img> and the badge stays.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function initials(name) {
  const parts = String(name || "").replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** onError / onLoad for every avatar image — capture phase, because image events don't bubble.
 *  Installed once at import, before any avatar is rendered, so no early failure is missed. */
function onAvatarError(img) {
  const alt = img.dataset.alt;                       // NBA.com headshot first, ESPN second, then initials
  if (alt) { delete img.dataset.alt; img.src = alt; return; }
  img.remove();
}
function onAvatarLoad(img) { img.classList.add("loaded"); img.parentElement?.classList.add("has-photo"); }  // headshots are transparent cutouts: hide initials behind them
if (typeof document !== "undefined" && !window.__avatarFallback) {
  window.__avatarFallback = true;
  document.addEventListener("error", (e) => { if (e.target?.classList?.contains("avatar-img")) onAvatarError(e.target); }, true);
  document.addEventListener("load", (e) => { if (e.target?.classList?.contains("avatar-img")) onAvatarLoad(e.target); }, true);
}

/**
 * @param {{name?:string, initials?:string, headshot?:string|null, headshotSmall?:string|null, headshotAlt?:string|null}} p  (headshotAlt: tried if the first image fails)
 * @param {{size?:string, color?:string, full?:boolean, label?:boolean}} opts
 */
export function avatar(p, { size = "2.5rem", color = "#8e8e93", full = false, label = false } = {}) {
  const src = (full ? p?.headshot : p?.headshotSmall || p?.headshot) || "";
  const ini = p?.initials || initials(p?.name);
  const alt = label ? `${esc(p?.name)}` : "";
  return `<span class="avatar" style="--s:${size};--c:${esc(color)}"${label ? ` role="img" aria-label="${alt}"` : ' aria-hidden="true"'}>`
    + `<span class="avatar-initials">${esc(ini)}</span>`
    + (src ? `<img class="avatar-img" src="${esc(src)}"${p?.headshotAlt && p.headshotAlt !== src ? ` data-alt="${esc(p.headshotAlt)}"` : ""} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "")
    + `</span>`;
}

/** Team logo with the same fallback (abbreviation on team color). */
export function teamLogo(t, { size = "2rem" } = {}) {
  return `<span class="avatar logo" style="--s:${size};--c:${esc(t?.color || "#8e8e93")}" aria-hidden="true">`
    + `<span class="avatar-initials">${esc(t?.abbr || "?")}</span>`
    + (t?.logo ? `<img class="avatar-img" src="${esc(t.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "")
    + `</span>`;
}

export { esc, initials };
