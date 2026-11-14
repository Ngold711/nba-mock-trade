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

/**
 * Preview sheet for an exported card: image, Download PNG, Copy Image, and the native share sheet
 * (iOS Safari → Messages, X, Photos) when the browser can share files.
 */
export async function openImageSheet(sheet, canvas, { title = "Share", filename = "hooptrax.png", text = "", toast = () => {} } = {}) {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const file = typeof File !== "undefined" ? new File([blob], filename, { type: "image/png" }) : null;
  const canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const canCopy = !!(navigator.clipboard && window.ClipboardItem);
  sheet.open({
    title,
    render(body) {
      body.innerHTML = `<img class="card-img" src="${url}" alt="${title}" style="width:100%;height:auto;border-radius:0.9rem;display:block;margin:0.25rem 0 0.9rem" />
        <div class="img-actions" style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <a class="btn primary press" href="${url}" download="${filename}" style="text-decoration:none;flex:1;text-align:center;min-height:44px;display:inline-flex;align-items:center;justify-content:center">Download PNG</a>
          ${canCopy ? `<button class="btn ghost press" type="button" data-copy-img style="flex:1;min-height:44px">Copy Image</button>` : ""}
          ${canShareFile ? `<button class="btn ghost press" type="button" data-share-img style="flex:1;min-height:44px">Share…</button>` : ""}
        </div>
        <p style="font-size:0.75rem;color:var(--label-3);margin:0.6rem 0 0">On iPhone you can also long-press the image to save it.</p>`;
      body.querySelector("[data-copy-img]")?.addEventListener("click", async () => {
        try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("✓ Image copied"); }
        catch { toast("Couldn't copy. Use Download instead."); }
      });
      body.querySelector("[data-share-img]")?.addEventListener("click", async () => {
        try { await navigator.share({ files: [file], title, text }); } catch (e) { if (e?.name !== "AbortError") toast("Sharing isn't available here"); }
      });
    },
  });
}
