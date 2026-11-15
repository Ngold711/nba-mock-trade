// Auth helpers: bcrypt password hashing, HS256 JWT in an HTTP-only cookie, input validation, rate limiting,
// and validation of saved trade / mock draft payloads. No framework; the server wires these into routes.
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export const COOKIE = "htx_session";
const SESSION_DAYS = 30;
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const b64json = (o) => b64(JSON.stringify(o));

/* ---------- passwords ---------- */
export const hashPassword = (pw) => bcrypt.hash(pw, 11);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash || "");
// Constant-time-ish path for unknown users, so login timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(12).toString("hex"), 11);
export const burnPasswordCheck = (pw) => bcrypt.compare(pw, DUMMY_HASH);

/* ---------- JWT (HS256) ---------- */
export function signJwt(payload, secret, { days = SESSION_DAYS } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64json({ alg: "HS256", typ: "JWT" });
  const body = b64json({ ...payload, iat: now, exp: now + days * 86400 });
  const sig = b64(createHmac("sha256", secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}
export function verifyJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  try {
    if (JSON.parse(Buffer.from(head, "base64url")).alg !== "HS256") return null;
    const want = createHmac("sha256", secret).update(`${head}.${body}`).digest();
    const got = Buffer.from(sig, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url"));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

/* ---------- cookies ---------- */
export function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || !!req.socket?.encrypted;
export function sessionCookie(req, token, { clear = false } = {}) {
  return [`${COOKIE}=${clear ? "" : encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`, ...(isHttps(req) ? ["Secure"] : [])].join("; ");
}

/* ---------- CSRF: state-changing requests must be same-origin JSON ---------- */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return false;
  if (!origin) return true;                         // same-origin fetch from older browsers / curl
  try {
    const o = new URL(origin);
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    return o.host === host;
  } catch { return false; }
}

/* ---------- validation ---------- */
export const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const RESERVED = new Set(["admin", "hooptrax", "support", "moderator", "root", "system", "guest", "null", "undefined"]);
export const TEAM_CODES = new Set(["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"]);
export function validateSignup({ email, username, password, favoriteTeam }) {
  const errors = {};
  const u = String(username || "").trim().replace(/^@/, "");
  if (!USERNAME.test(u)) errors.username = "3–20 letters, numbers or _";
  else if (RESERVED.has(u.toLowerCase())) errors.username = "That username is reserved";
  if (!EMAIL.test(String(email || "").trim())) errors.email = "Enter a valid email";
  const pw = String(password || "");
  if (pw.length < 8) errors.password = "At least 8 characters";
  else if (pw.length > 72) errors.password = "At most 72 characters";
  const team = favoriteTeam && TEAM_CODES.has(String(favoriteTeam)) ? String(favoriteTeam) : null;
  return { ok: !Object.keys(errors).length, errors, value: { username: u, email: String(email || "").trim().toLowerCase(), password: pw, favoriteTeam: team } };
}
const cleanText = (s, max) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export { cleanText };

/** Saved trade / mock draft payloads: shape-checked and size-limited; stored as JSON, rendered escaped. */
export function validateItem(body) {
  const type = body?.type === "draft" ? "draft" : body?.type === "trade" ? "trade" : null;
  if (!type) return { error: "type must be trade or draft" };
  const visibility = body?.visibility === "public" ? "public" : "private";
  const title = cleanText(body?.title, 140);
  const p = body?.payload;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { error: "payload required" };
  const size = JSON.stringify(p).length;
  if (size > 48 * 1024) return { error: "payload too large" };
  if (type === "trade") {
    if (typeof p.trade !== "string" || !/^[A-Za-z0-9._~-]{4,2000}$/.test(p.trade)) return { error: "trade link code missing" };
    if (!Array.isArray(p.teams) || p.teams.length < 2 || p.teams.length > 4 || !p.teams.every((t) => TEAM_CODES.has(t))) return { error: "2–4 teams" };
    if (!Array.isArray(p.assets) || p.assets.length < 1 || p.assets.length > 40) return { error: "1–40 assets" };
  } else {
    if (!/^20(2[6-9]|3\d)$/.test(String(p.year))) return { error: "draft year" };
    if (!p.picks || typeof p.picks !== "object") return { error: "picks required" };
    if (!Object.keys(p.picks).length) return { error: "Draft at least one pick first" };
  }
  return { value: { type, visibility, title, payload: p } };
}

/* ---------- rate limiting (in memory, per key) ---------- */
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      list.push(now); hits.set(key, list);
      if (hits.size > 20000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return list.length <= max;
    },
    count(key, now = Date.now()) { return (hits.get(key) || []).filter((t) => now - t < windowMs).length; },
    reset(key) { hits.delete(key); },
  };
}
