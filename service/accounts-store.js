// Accounts + saved trades/drafts storage.
//   DATABASE_URL set  → PostgreSQL (free Supabase / Neon / Render Postgres), survives restarts and deploys.
//   otherwise         → JSON file (data/hooptrax_users.json) for local development. On hosts with an ephemeral
//                       disk (Render's free web service) that file is wiped on every deploy.
// Both adapters expose the same async API; ids are random 12-char strings.
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const newId = () => randomBytes(9).toString("base64url");
const lower = (s) => String(s || "").trim().toLowerCase();

/** Public shape of a saved item (never exposes who liked it, only whether *you* did). */
export function publicItem(it, viewerId = null) {
  if (!it) return null;
  const { likedByUserIds = [], ...rest } = it;
  return { ...rest, likedByMe: !!viewerId && likedByUserIds.includes(viewerId) };
}
export const publicUser = (u) => (u ? { id: u.id, username: u.username, favoriteTeam: u.favoriteTeam || null, bio: u.bio || "", createdAt: u.createdAt } : null);

export class TakenError extends Error { constructor(field) { super(`${field} taken`); this.code = "taken"; this.field = field; } }

/* ------------------------------------------------------------------ JSON file */
export function createJsonStore(file) {
  let db = { users: [], items: [], threads: [] }, loaded = null, timer = null, writing = Promise.resolve();
  const load = () => (loaded ||= readFile(file, "utf8").then((t) => { const j = JSON.parse(t); db = { users: j.users || [], items: j.items || [], threads: j.threads || [] }; }).catch(() => {}));
  const flush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const snapshot = JSON.stringify(db);
      writing = writing.then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, snapshot); await rename(tmp, file);       // atomic replace
      }).catch(() => {});
    }, 150);
    timer.unref?.();
  };
  const sortNew = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
  return {
    kind: "json",
    async init() { await load(); const r = await this.purgeOrphans(); if (r.items || r.threads) flush(); },
    /** Remove saved items / AI threads with no owner (pre-account data or deleted users). */
    async purgeOrphans() {
      await load();
      const ids = new Set(db.users.map((u) => u.id));
      const ni = db.items.length, nt = db.threads.length;
      db.items = db.items.filter((x) => x.userId && ids.has(x.userId));
      db.threads = db.threads.filter((x) => x.userId && ids.has(x.userId));
      return { items: ni - db.items.length, threads: nt - db.threads.length };
    },
    async listThreads(userId) { await load(); return db.threads.filter((t) => t.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50); },
    async upsertThread(userId, t) {
      await load();
      const ex = db.threads.find((x) => x.id === t.id);
      if (ex && ex.userId !== userId) return null;                      // someone else's id: never touch it
      const row = { id: t.id, userId, title: t.title, messages: t.messages, updatedAt: t.updatedAt || Date.now() };
      if (ex) Object.assign(ex, row); else db.threads.push(row);
      const mine = db.threads.filter((x) => x.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
      if (mine.length > 50) { const drop = new Set(mine.slice(50).map((x) => x.id)); db.threads = db.threads.filter((x) => !drop.has(x.id)); }
      flush(); return row;
    },
    async deleteThread(id, userId) { await load(); const n = db.threads.length; db.threads = db.threads.filter((x) => !(x.id === id && x.userId === userId)); if (n !== db.threads.length) flush(); return n !== db.threads.length; },
    async clearThreads(userId) { await load(); const n = db.threads.length; db.threads = db.threads.filter((x) => x.userId !== userId); flush(); return n - db.threads.length; },
    async flushNow() { clearTimeout(timer); const snapshot = JSON.stringify(db); await mkdir(dirname(file), { recursive: true }); await writeFile(file, snapshot); },
    async createUser({ username, email, passwordHash, favoriteTeam = null }) {
      await load();
      if (db.users.some((u) => lower(u.username) === lower(username))) throw new TakenError("username");
      if (db.users.some((u) => lower(u.email) === lower(email))) throw new TakenError("email");
      const u = { id: newId(), username, email: lower(email), passwordHash, favoriteTeam, bio: "", createdAt: new Date().toISOString() };
      db.users.push(u); flush(); return u;
    },
    async findUserByLogin(login) { await load(); const k = lower(login).replace(/^@/, ""); return db.users.find((u) => lower(u.username) === k || u.email === k) || null; },
    async getUser(id) { await load(); return db.users.find((u) => u.id === id) || null; },
    async updateUser(id, patch) {
      await load(); const u = db.users.find((x) => x.id === id); if (!u) return null;
      if ("favoriteTeam" in patch) { u.favoriteTeam = patch.favoriteTeam; db.items.forEach((it) => { if (it.userId === id) it.favoriteTeam = patch.favoriteTeam; }); }
      if ("bio" in patch) u.bio = patch.bio;
      flush(); return u;
    },
    async createItem(it) {
      await load();
      const row = { id: newId(), likesCount: 0, likedByUserIds: [], createdAt: new Date().toISOString(), ...it };
      db.items.push(row); flush(); return row;
    },
    async getItem(id) { await load(); return db.items.find((x) => x.id === id) || null; },
    async listItems({ userId, visibility = null, limit = 100 }) {
      await load();
      return db.items.filter((x) => x.userId === userId && (!visibility || x.visibility === visibility)).sort(sortNew).slice(0, limit);
    },
    async listFeed({ type = null, sort = "new", limit = 30, offset = 0 }) {
      await load();
      const rows = db.items.filter((x) => x.visibility === "public" && (!type || x.type === type));
      rows.sort(sort === "top" ? (a, b) => b.likesCount - a.likesCount || sortNew(a, b) : sortNew);
      return rows.slice(offset, offset + limit);
    },
    async updateItem(id, userId, patch) {
      await load(); const it = db.items.find((x) => x.id === id && x.userId === userId); if (!it) return null;
      if (patch.visibility) it.visibility = patch.visibility;
      if (typeof patch.title === "string") it.title = patch.title;
      flush(); return it;
    },
    async deleteItem(id, userId) {
      await load(); const n = db.items.length; db.items = db.items.filter((x) => !(x.id === id && x.userId === userId));
      if (db.items.length !== n) { flush(); return true; } return false;
    },
    async toggleLike(id, userId) {
      await load(); const it = db.items.find((x) => x.id === id && x.visibility === "public"); if (!it) return null;
      const i = it.likedByUserIds.indexOf(userId);
      if (i >= 0) it.likedByUserIds.splice(i, 1); else it.likedByUserIds.push(userId);
      it.likesCount = it.likedByUserIds.length; flush();
      return { liked: i < 0, likesCount: it.likesCount };
    },
    async counts(userId) {
      await load(); const mine = db.items.filter((x) => x.userId === userId);
      return { public: mine.filter((x) => x.visibility === "public").length, private: mine.filter((x) => x.visibility === "private").length };
    },
  };
}

/* ------------------------------------------------------------------ PostgreSQL */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  favorite_team text,
  bio text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
CREATE TABLE IF NOT EXISTS saved_items (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username text NOT NULL,
  favorite_team text,
  type text NOT NULL CHECK (type IN ('trade', 'draft', 'tierlist')),
  title text NOT NULL DEFAULT '',
  payload_json jsonb NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'public')),
  likes_count integer NOT NULL DEFAULT 0,
  liked_by_user_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- databases created before tier lists: widen the type check (idempotent)
ALTER TABLE saved_items DROP CONSTRAINT IF EXISTS saved_items_type_check;
ALTER TABLE saved_items ADD CONSTRAINT saved_items_type_check CHECK (type IN ('trade', 'draft', 'tierlist'));
CREATE INDEX IF NOT EXISTS saved_items_user ON saved_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_items_feed ON saved_items (visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_items_top ON saved_items (visibility, likes_count DESC, created_at DESC);
CREATE TABLE IF NOT EXISTS ai_threads (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  messages_json jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_threads_user ON ai_threads (user_id, updated_at DESC);
`;
const userRow = (r) => r && { id: r.id, username: r.username, email: r.email, passwordHash: r.password_hash, favoriteTeam: r.favorite_team, bio: r.bio, createdAt: new Date(r.created_at).toISOString() };
const itemRow = (r) => r && {
  id: r.id, userId: r.user_id, username: r.username, favoriteTeam: r.favorite_team, type: r.type, title: r.title,
  payloadJson: r.payload_json, visibility: r.visibility, likesCount: r.likes_count, likedByUserIds: r.liked_by_user_ids || [],
  createdAt: new Date(r.created_at).toISOString(),
};

export async function createPgStore(url, { Pool } = {}) {
  if (!Pool) ({ default: { Pool } } = await import("pg"));
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url) || /sslmode=disable/.test(url);
  // Supabase / Neon require TLS; their poolers use certificates Node can't always chain, so verify-less TLS
  // unless the URL asks for sslmode=verify-full.
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000, ssl: local ? false : /verify-full/.test(url) ? { rejectUnauthorized: true } : { rejectUnauthorized: false } });
  const q = (text, params) => pool.query(text, params);
  const taken = (e) => { if (e.code === "23505") throw new TakenError(/email/.test(e.constraint || "") ? "email" : "username"); throw e; };
  return {
    kind: "postgres",
    pool,
    async init() { await q(SCHEMA); await this.purgeOrphans(); },
    /** Remove saved items / AI threads with no owner (pre-account data). The FKs keep new orphans from appearing. */
    async purgeOrphans() {
      const a = await q("DELETE FROM saved_items WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users)");
      const b = await q("DELETE FROM ai_threads WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users)");
      return { items: a.rowCount, threads: b.rowCount };
    },
    async listThreads(userId) {
      const { rows } = await q("SELECT id, title, messages_json, updated_at FROM ai_threads WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50", [userId]);
      return rows.map((r) => ({ id: r.id, userId, title: r.title, messages: r.messages_json, updatedAt: new Date(r.updated_at).getTime() }));
    },
    async upsertThread(userId, t) {
      // ON CONFLICT … WHERE: an id that belongs to another user is never overwritten (returns no row)
      const { rows } = await q(`INSERT INTO ai_threads (id, user_id, title, messages_json, updated_at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, messages_json = EXCLUDED.messages_json, updated_at = EXCLUDED.updated_at
        WHERE ai_threads.user_id = EXCLUDED.user_id RETURNING id`, [t.id, userId, t.title, JSON.stringify(t.messages), t.updatedAt || Date.now()]);
      if (!rows[0]) return null;
      await q("DELETE FROM ai_threads WHERE user_id = $1 AND id NOT IN (SELECT id FROM ai_threads WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50)", [userId]);
      return { ...t, userId };
    },
    async deleteThread(id, userId) { const r = await q("DELETE FROM ai_threads WHERE id = $1 AND user_id = $2", [id, userId]); return r.rowCount > 0; },
    async clearThreads(userId) { const r = await q("DELETE FROM ai_threads WHERE user_id = $1", [userId]); return r.rowCount; },
    async flushNow() {},
    async close() { await pool.end(); },
    async createUser({ username, email, passwordHash, favoriteTeam = null }) {
      try {
        const { rows } = await q("INSERT INTO users (id, username, email, password_hash, favorite_team) VALUES ($1,$2,$3,$4,$5) RETURNING *", [newId(), username, lower(email), passwordHash, favoriteTeam]);
        return userRow(rows[0]);
      } catch (e) { return taken(e); }
    },
    async findUserByLogin(login) {
      const k = lower(login).replace(/^@/, "");
      const { rows } = await q("SELECT * FROM users WHERE lower(username) = $1 OR lower(email) = $1 LIMIT 1", [k]);
      return userRow(rows[0]) || null;
    },
    async getUser(id) { const { rows } = await q("SELECT * FROM users WHERE id = $1", [id]); return userRow(rows[0]) || null; },
    async updateUser(id, patch) {
      const sets = [], vals = [id];
      if ("favoriteTeam" in patch) { vals.push(patch.favoriteTeam); sets.push(`favorite_team = $${vals.length}`); }
      if ("bio" in patch) { vals.push(patch.bio); sets.push(`bio = $${vals.length}`); }
      if (!sets.length) return this.getUser(id);
      const { rows } = await q(`UPDATE users SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
      if ("favoriteTeam" in patch) await q("UPDATE saved_items SET favorite_team = $2 WHERE user_id = $1", [id, patch.favoriteTeam]);
      return userRow(rows[0]) || null;
    },
    async createItem(it) {
      const { rows } = await q(
        "INSERT INTO saved_items (id, user_id, username, favorite_team, type, title, payload_json, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [newId(), it.userId, it.username, it.favoriteTeam || null, it.type, it.title || "", JSON.stringify(it.payloadJson), it.visibility]);
      return itemRow(rows[0]);
    },
    async getItem(id) { const { rows } = await q("SELECT * FROM saved_items WHERE id = $1", [id]); return itemRow(rows[0]) || null; },
    async listItems({ userId, visibility = null, limit = 100 }) {
      const { rows } = await q(`SELECT * FROM saved_items WHERE user_id = $1 ${visibility ? "AND visibility = $3" : ""} ORDER BY created_at DESC LIMIT $2`, visibility ? [userId, limit, visibility] : [userId, limit]);
      return rows.map(itemRow);
    },
    async listFeed({ type = null, sort = "new", limit = 30, offset = 0 }) {
      const { rows } = await q(`SELECT * FROM saved_items WHERE visibility = 'public' ${type ? "AND type = $3" : ""}
        ORDER BY ${sort === "top" ? "likes_count DESC, created_at DESC" : "created_at DESC"} LIMIT $1 OFFSET $2`, type ? [limit, offset, type] : [limit, offset]);
      return rows.map(itemRow);
    },
    async updateItem(id, userId, patch) {
      const sets = [], vals = [id, userId];
      if (patch.visibility) { vals.push(patch.visibility); sets.push(`visibility = $${vals.length}`); }
      if (typeof patch.title === "string") { vals.push(patch.title); sets.push(`title = $${vals.length}`); }
      if (!sets.length) return null;
      const { rows } = await q(`UPDATE saved_items SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING *`, vals);
      return itemRow(rows[0]) || null;
    },
    async deleteItem(id, userId) { const r = await q("DELETE FROM saved_items WHERE id = $1 AND user_id = $2", [id, userId]); return r.rowCount > 0; },
    async toggleLike(id, userId) {
      // single statement: add or remove the id atomically, keep the count in step
      const { rows } = await q(`UPDATE saved_items SET
          liked_by_user_ids = CASE WHEN $2 = ANY(liked_by_user_ids) THEN array_remove(liked_by_user_ids, $2) ELSE array_append(liked_by_user_ids, $2) END,
          likes_count = CASE WHEN $2 = ANY(liked_by_user_ids) THEN likes_count - 1 ELSE likes_count + 1 END
        WHERE id = $1 AND visibility = 'public' RETURNING likes_count, $2 = ANY(liked_by_user_ids) AS liked`, [id, userId]);
      return rows[0] ? { liked: rows[0].liked, likesCount: rows[0].likes_count } : null;
    },
    async counts(userId) {
      const { rows } = await q("SELECT visibility, count(*)::int AS n FROM saved_items WHERE user_id = $1 GROUP BY visibility", [userId]);
      const m = Object.fromEntries(rows.map((r) => [r.visibility, r.n]));
      return { public: m.public || 0, private: m.private || 0 };
    },
  };
}

/** Pick the adapter from the environment. */
export async function openStore({ url = process.env.DATABASE_URL, file } = {}) {
  if (url) { const s = await createPgStore(url); await s.init(); return s; }
  const s = createJsonStore(file); await s.init(); return s;
}
