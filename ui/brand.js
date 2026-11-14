// Hooptrax brand: logo mark, two-tone wordmark, and the HooptraxWatermark component
// ([icon] Hooptrax.com) used in the app footer, every sheet/modal, and share outputs.

export const SITE = "Hooptrax.com";
export const SITE_URL = "https://hooptrax.com";

const PATHS = `
  <path d="M12 36A20 20 0 0 1 48.5 21.5" style="stroke:var(--logo-hi,#F59E0B)" stroke-width="4" stroke-linecap="round"/>
  <path d="M23 14.5C21.5 20.5 21.5 26 23 31" style="stroke:var(--logo-hi,#F59E0B)" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M12.5 28H24.5" style="stroke:var(--logo-hi,#F59E0B)" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M35 13C34.5 18 35.5 22 38 25" style="stroke:var(--logo-hi,#F59E0B)" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M19 47.5A20 20 0 0 0 51.5 32" style="stroke:var(--logo-lo,#FFFFFF)" stroke-width="4" stroke-linecap="round"/>
  <path d="M32 42V51.5" style="stroke:var(--logo-lo,#FFFFFF)" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M40.5 39.5C42 43 44.5 45.5 47.5 46.5" style="stroke:var(--logo-lo,#FFFFFF)" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M11 47L26 32L34 38L51 21" style="stroke:var(--logo-hi,#F59E0B)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M42 20H52V30" style="stroke:var(--logo-hi,#F59E0B)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The geometric basketball-ticker mark (same artwork as public/logo.svg). */
export const logoMark = (cls = "htx-mark") => `<svg class="${cls}" viewBox="0 0 64 64" fill="none" aria-hidden="true">${PATHS}</svg>`;

/** Two-tone wordmark: Hoop (white in dark mode, deep slate in light) + trax (amber). */
export const wordmark = () => `<span class="htx-word"><span class="hoop">Hoop</span><span class="trax">trax</span></span>`;

/** <HooptraxWatermark /> — [Icon] Hooptrax.com */
export function HooptraxWatermark({ link = true } = {}) {
  const inner = `${logoMark("htx-wm-mark")}<span>${SITE}</span>`;
  return link
    ? `<a class="htx-wm" href="${SITE_URL}" target="_blank" rel="noopener" aria-label="Hooptrax.com">${inner}</a>`
    : `<span class="htx-wm">${inner}</span>`;
}

/** Path data for canvas renderers (share cards). */
export const LOGO_SVG_URL = "public/logo.svg";
