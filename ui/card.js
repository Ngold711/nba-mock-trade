// Canvas helpers shared by the exported graphic cards (trade receipt, All-Star ballot).
// Images load with crossOrigin="anonymous"; if the CDN response can't be used on a canvas, the
// same image is fetched through the service's /api/proxy-image route (same origin, never taints).

const ESPN_IMG = /^https:\/\/a\.espncdn\.com\//;
let proxyOk = null;   // null = unknown; set false after the proxy fails once (static hosting)

function tryLoad(src, cors = true) {
  return new Promise((res) => {
    const i = new Image();
    if (cors) i.crossOrigin = "anonymous";
    i.decoding = "async";
    i.onload = () => res(i); i.onerror = () => res(null);
    i.src = src;
  });
}
/** True if drawing this image leaves the canvas exportable. */
function clean(img) {
  try { const c = document.createElement("canvas"); c.width = c.height = 2; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 2, 2); x.getImageData(0, 0, 1, 1); return true; }
  catch { return false; }
}
export async function loadImage(src) {
  if (!src) return null;
  const direct = await tryLoad(src);
  if (direct && clean(direct)) return direct;
  if (ESPN_IMG.test(src) && proxyOk !== false && location.protocol !== "file:") {
    const viaProxy = await tryLoad(`/api/proxy-image?url=${encodeURIComponent(src)}`);
    if (viaProxy) { proxyOk = true; return viaProxy; }
    proxyOk = false;
  }
  return null;     // caller draws the initials fallback
}

export function roundRect(x, X, Y, W, H, r) {
  x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}
/** Circular headshot (cover-cropped toward the face) or initials on a tinted disc. */
export function drawAvatar(x, img, cx, cy, r, { initials = "", tint = "#334155" } = {}) {
  x.save();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath();
  x.fillStyle = "#1E2533"; x.fill();
  x.clip();
  x.globalAlpha = 0.35; x.fillStyle = tint; x.fillRect(cx - r, cy - r, r * 2, r * 2); x.globalAlpha = 1;
  if (img) {
    const ar = img.width / img.height, d = r * 2;
    let w = d, h = d / ar;
    if (h < d) { h = d; w = d * ar; }
    x.drawImage(img, cx - w / 2, cy - r - (h - d) * 0.12, w, h);
  } else if (initials) {
    x.fillStyle = "#E8ECF3"; x.font = `700 ${Math.round(r * 0.8)}px "Plus Jakarta Sans", sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(initials, cx, cy + 1);
    x.textAlign = "left"; x.textBaseline = "alphabetic";
  }
  x.restore();
}
/** Draw text clipped with an ellipsis to maxW. */
export function fitText(x, text, X, Y, maxW) {
  let t = String(text);
  if (x.measureText(t).width <= maxW) { x.fillText(t, X, Y); return; }
  while (t.length > 1 && x.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  x.fillText(t + "…", X, Y);
}
export const canvasToBlob = (c) => new Promise((res) => c.toBlob((b) => res(b), "image/png"));
export const fontsReady = () => (document.fonts?.ready || Promise.resolve()).catch(() => {});
