// Hooptrax Trade Receipt Card: a 1080px-wide PNG rendered at 2x on a canvas.
//   const canvas = await renderReceipt({ teams, status, date })
// teams: [{ abbr, name, color, logo, net, receives: [{ kind, name, salary, headshot, initials, year, round, origin }] }]
// status: "legal" | "sandbox"
import { loadImage, roundRect, drawAvatar, fitText, fontsReady } from "./card.js";
import { money } from "../service/trade.js";

const W = 1080, SCALE = 2;
const C = { bg: "#0B0E14", card: "#151B26", card2: "#1A2130", hair: "rgba(255,255,255,0.07)", text: "#E8ECF3", sub: "rgba(203,213,225,0.74)", dim: "rgba(148,163,184,0.62)",
  amber: "#F59E0B", green: "#10B981", red: "#EF4444" };
const SANS = '"Plus Jakarta Sans", -apple-system, system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

export async function renderReceipt({ teams, status = "legal", date = new Date() }) {
  await fontsReady();
  const cols = teams.length <= 2 ? teams.length : 2;
  const rows = Math.ceil(teams.length / cols);
  const ROW_H = 92, PAD = 48, GAP = 24;
  const colW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const cardH = teams.map((t) => 150 + Math.max(1, t.receives.length) * ROW_H + 92);
  const rowHeights = [];
  for (let r = 0; r < rows; r++) rowHeights.push(Math.max(...cardH.slice(r * cols, r * cols + cols)));
  const HEAD = 236, FOOT = 120;
  const H = HEAD + rowHeights.reduce((a, b) => a + b, 0) + GAP * (rows - 1) + FOOT;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const x = canvas.getContext("2d");
  x.scale(SCALE, SCALE);

  // images in parallel
  const imgs = new Map();
  const want = [["logo", "public/logo.svg"]];
  teams.forEach((t) => { want.push([`team:${t.abbr}`, t.logo]); t.receives.forEach((a, i) => a.kind === "player" && want.push([`p:${t.abbr}:${i}`, a.headshot])); });
  await Promise.all(want.map(async ([k, src]) => imgs.set(k, await loadImage(src))));

  // canvas
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W * 0.8, -60, 10, W * 0.8, -60, 700);
  glow.addColorStop(0, "rgba(245,158,11,0.16)"); glow.addColorStop(1, "rgba(245,158,11,0)");
  x.fillStyle = glow; x.fillRect(0, 0, W, 520);

  // header: logo + wordmark
  const logo = imgs.get("logo");
  if (logo) x.drawImage(logo, PAD, 44, 64, 64);
  x.font = `800 46px ${SANS}`; x.textBaseline = "alphabetic";
  x.fillStyle = "#FFFFFF"; x.fillText("Hoop", PAD + 80, 92);
  const hw = x.measureText("Hoop").width;
  x.fillStyle = C.amber; x.fillText("trax", PAD + 80 + hw, 92);
  // date stamp
  x.font = `600 22px ${MONO}`; x.fillStyle = C.sub; x.textAlign = "right";
  x.fillText(date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase(), W - PAD, 84);
  x.textAlign = "left";
  // title + status badge
  x.font = `800 52px ${SANS}`; x.fillStyle = C.text;
  x.fillText("Trade Receipt", PAD, 176);
  const legal = status === "legal";
  const label = legal ? "✓ OFFICIAL NBA LEGAL TRADE" : "⚡ SANDBOX TRADE";
  x.font = `800 20px ${MONO}`;
  const bw = x.measureText(label).width + 36;
  const bx = W - PAD - bw;
  roundRect(x, bx, 146, bw, 44, 22);
  x.fillStyle = legal ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)"; x.fill();
  x.lineWidth = 1.5; x.strokeStyle = legal ? C.green : C.amber; x.stroke();
  x.fillStyle = legal ? C.green : C.amber; x.fillText(label, bx + 18, 175);
  if (!legal) { x.font = `600 18px ${SANS}`; x.fillStyle = C.amber; x.textAlign = "right"; x.fillText("CBA rules overridden", W - PAD, 214); x.textAlign = "left"; }

  // team cards
  let y = HEAD;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = teams[r * cols + c]; if (!t) continue;
      const X = PAD + c * (colW + GAP), Y = y, Hc = rowHeights[r];
      roundRect(x, X, Y, colW, Hc, 24); x.fillStyle = C.card; x.fill();
      x.lineWidth = 1; x.strokeStyle = C.hair; x.stroke();
      // team color strip
      x.save(); roundRect(x, X, Y, colW, Hc, 24); x.clip(); x.fillStyle = t.color || C.amber; x.fillRect(X, Y, colW, 6); x.restore();
      const tl = imgs.get(`team:${t.abbr}`);
      if (tl) x.drawImage(tl, X + 24, Y + 30, 64, 64);
      else { roundRect(x, X + 24, Y + 30, 64, 64, 14); x.fillStyle = t.color || "#334155"; x.fill(); x.fillStyle = "#fff"; x.font = `800 20px ${SANS}`; x.fillText(t.abbr, X + 32, Y + 70); }
      x.fillStyle = C.text; x.font = `750 30px ${SANS}`; fitText(x, t.name, X + 104, Y + 62, colW - 128);
      x.fillStyle = C.dim; x.font = `700 16px ${MONO}`; x.fillText("RECEIVES", X + 104, Y + 92);
      let ry = Y + 130;
      if (!t.receives.length) { x.fillStyle = C.dim; x.font = `500 22px ${SANS}`; x.fillText("Nothing", X + 24, ry + 40); }
      t.receives.forEach((a, i) => {
        const cy = ry + ROW_H / 2;
        if (a.kind === "player") drawAvatar(x, imgs.get(`p:${t.abbr}:${i}`), X + 56, cy, 32, { initials: a.initials, tint: a.color || t.color });
        else {
          roundRect(x, X + 24, cy - 30, 64, 60, 14); x.fillStyle = "rgba(245,158,11,0.14)"; x.fill();
          x.fillStyle = C.amber; x.font = `800 22px ${MONO}`; x.textAlign = "center"; x.fillText(`'${String(a.year).slice(2)}`, X + 56, cy + 2); x.font = `700 13px ${MONO}`; x.fillText(a.round === 1 ? "1ST" : "2ND", X + 56, cy + 20); x.textAlign = "left";
        }
        x.fillStyle = C.text; x.font = `700 24px ${SANS}`;
        const sal = a.kind === "player" ? money(a.salary) : "";
        x.font = `600 21px ${MONO}`; const sw = sal ? x.measureText(sal).width : 0;
        x.font = `700 24px ${SANS}`; fitText(x, a.name, X + 104, cy - 4, colW - 140 - sw);
        x.fillStyle = C.sub; x.font = `500 17px ${SANS}`;
        fitText(x, a.kind === "player" ? `${a.position || ""}${a.fromName ? ` · from ${a.fromName}` : ""}` : `Draft pick${a.fromName ? ` · from ${a.fromName}` : ""}`, X + 104, cy + 22, colW - 140 - sw);
        if (sal) { x.fillStyle = C.text; x.font = `600 21px ${MONO}`; x.textAlign = "right"; x.fillText(sal, X + colW - 24, cy + 6); x.textAlign = "left"; }
        if (i < t.receives.length - 1) { x.fillStyle = C.hair; x.fillRect(X + 104, ry + ROW_H - 1, colW - 128, 1); }
        ry += ROW_H;
      });
      // net payroll delta
      const fy = Y + Hc - 70;
      x.fillStyle = C.hair; x.fillRect(X + 24, fy - 16, colW - 48, 1);
      x.fillStyle = C.dim; x.font = `700 16px ${MONO}`; x.fillText("NET PAYROLL", X + 24, fy + 22);
      const pos = t.net > 1e-6, neg = t.net < -1e-6;
      x.fillStyle = pos ? C.red : neg ? C.green : C.sub; x.font = `800 32px ${MONO}`; x.textAlign = "right";
      x.fillText(money(t.net, { sign: true }), X + colW - 24, fy + 30); x.textAlign = "left";
    }
    y += rowHeights[r] + GAP;
  }

  // footer watermark
  const fy = H - FOOT + 40;
  x.fillStyle = C.hair; x.fillRect(PAD, fy - 24, W - PAD * 2, 1);
  if (logo) x.drawImage(logo, PAD, fy - 4, 40, 40);
  x.font = `600 22px ${SANS}`; x.fillStyle = C.sub;
  x.fillText("Built on Hooptrax.com • Live NBA Trade Machine & Draft Hub", PAD + 56, fy + 24);
  x.font = `500 16px ${MONO}`; x.fillStyle = C.dim; x.textAlign = "right"; x.fillText("2026–27 · salaries: ESPN", W - PAD, fy + 24); x.textAlign = "left";
  return canvas;
}
