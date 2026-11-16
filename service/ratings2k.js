// Official NBA 2K27 ratings sync: the single source of truth behind /api/2k27-ratings (GM Lab 2K27 tab, LED movers
// ticker, Higher or Lower, Tier List Maker, Trade Machine badges, Ask Hooptrax).
//
// Hooptrax never estimates or simulates 2K ratings. Every OVR it shows comes from an official source:
//   1. RATINGS_FEED_URL   — primary official feed (JSON; see service/ratings-feed.js for accepted shapes)
//   2. RATINGS_FEED_URL_2 — optional cross-check feed. It fills players the primary lacks and every disagreement
//                           is counted and logged (the primary always wins).
//   3. data/ratings-feed.json — the last verified sync, kept on disk so a failed upstream fetch never blanks the
//                           ratings or swaps in made-up numbers.
//   4. ratings_2k27.json  — the bundled official snapshot (used only before the first successful sync).
// Synced every 30 minutes by default (RATINGS_TTL_MIN), at server start-up and after games go final.
import { parseRatingsFeed, fetchRatingsFeed } from "./ratings-feed.js";

const key = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]+/g, "");

let status = { syncedAt: null, source: null, live: false, players: 0, conflicts: 0, crossChecked: 0, error: null, lastAttemptAt: null };
export const ratingsSyncStatus = () => status;

/**
 * Merge the primary feed with an optional cross-check feed. Primary rows win; cross-check rows fill gaps.
 * Returns the merged feed plus the names where the two official sources disagree.
 */
export function mergeFeeds(primary, secondary) {
  if (!secondary?.players?.length) return { feed: primary, conflicts: [] , crossChecked: 0 };
  if (!primary?.players?.length) return { feed: secondary, conflicts: [], crossChecked: 0 };
  const by = new Map(primary.players.map((p) => [key(p.name), p]));
  const conflicts = [];
  let crossChecked = 0;
  const players = [...primary.players];
  for (const s of secondary.players) {
    const p = by.get(key(s.name));
    if (!p) { players.push(s); continue; }
    crossChecked++;
    if (p.ovr !== s.ovr) conflicts.push({ name: p.name, primary: p.ovr, secondary: s.ovr });
  }
  return { feed: { ...primary, players, teams: primary.teams?.length ? primary.teams : secondary.teams || [], source: [primary.source, secondary.source].filter(Boolean).join(" + cross-checked with ") }, conflicts, crossChecked };
}

/**
 * One sync pass. Never throws: returns the freshest verified official dataset available.
 * env: { RATINGS_FEED_URL, RATINGS_FEED_URL_2 }; io: { readFile, writeFile, mkdir } (node:fs/promises); files: URLs.
 */
export async function syncRatings({ env = {}, fetchImpl = globalThis.fetch, io, cacheFile, cacheDir, snapshotFile, log = () => {}, now = () => new Date() } = {}) {
  const urls = [env.RATINGS_FEED_URL, env.RATINGS_FEED_URL_2].filter(Boolean);
  status = { ...status, lastAttemptAt: now().toISOString() };
  if (urls.length) {
    const got = await Promise.allSettled(urls.map((u) => fetchRatingsFeed(u, { fetchImpl })));
    const [a, b] = got.map((r) => (r.status === "fulfilled" ? r.value : null));
    const errs = got.filter((r) => r.status === "rejected").map((r) => r.reason?.message || String(r.reason));
    if (a || b) {
      const { feed, conflicts, crossChecked } = mergeFeeds(a, b);
      if (conflicts.length) log(`[ratings] ${conflicts.length} OVR disagreement(s) between official feeds (primary kept): ${conflicts.slice(0, 5).map((c) => `${c.name} ${c.primary}/${c.secondary}`).join(", ")}`);
      const syncedAt = now().toISOString();
      await io?.mkdir(cacheDir, { recursive: true }).catch(() => {});
      await io?.writeFile(cacheFile, JSON.stringify({ ...feed, syncedAt })).catch(() => {});
      status = { ...status, syncedAt, source: feed.source || "official feed", live: true, players: feed.players.length, conflicts: conflicts.length, crossChecked, error: errs[0] || null };
      return { ...feed, live: true, syncedAt };
    }
    status = { ...status, error: errs.join("; ") };
    log(`[ratings] official feed unavailable (${status.error}); keeping the last verified sync`);
  }
  // last verified sync on disk
  const last = await io?.readFile(cacheFile, "utf8").then(JSON.parse).catch(() => null);
  if (last?.players?.length) {
    const feed = parseRatingsFeed(last);
    status = { ...status, syncedAt: last.syncedAt || last.fetchedAt || null, source: feed.source || "official feed", live: !!urls.length, players: feed.players.length };
    return { ...feed, live: status.live, syncedAt: status.syncedAt };
  }
  // bundled official snapshot
  const snap = parseRatingsFeed(JSON.parse(await io.readFile(snapshotFile, "utf8")));
  status = { ...status, syncedAt: snap.asOf ? new Date(`${snap.asOf}T12:00:00Z`).toISOString() : null, source: snap.source, live: false, players: snap.players.length };
  return { ...snap, live: false, syncedAt: status.syncedAt };
}
