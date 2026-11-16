// NBA 2K27 ratings feed: parse/validate a JSON ratings source so official OVRs flow in automatically when 2K ships
// roster updates. Two sources, newest wins:
//   1. RATINGS_FEED_URL — any JSON endpoint you control or subscribe to (re-fetched on the ratings cache cycle,
//      every 6 hours by default, RATINGS_TTL_MIN to change). The last good copy is kept on disk.
//   2. ratings_2k27.json — the bundled snapshot in this repo.
// Accepted shapes: { asOf, source, official, players: [ { name, ovr, delta?, team?, attributes? } ] } or a bare array;
// field aliases: player/fullName → name, overall/rating → ovr, change → delta.
const num = (v) => (v === "" || v == null ? null : Number(v));

export function parseRatingsFeed(json, { minPlayers = 1 } = {}) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.players) ? json.players : null;
  if (!rows) throw new Error("ratings feed: no players array");
  const players = [];
  for (const r of rows) {
    const name = String(r?.name ?? r?.player ?? r?.fullName ?? "").trim();
    const ovr = num(r?.ovr ?? r?.overall ?? r?.rating);
    if (!name || !Number.isFinite(ovr) || ovr < 40 || ovr > 99) continue;
    const delta = num(r?.delta ?? r?.change);
    players.push({ name, ovr: Math.round(ovr), delta: Number.isFinite(delta) ? Math.round(delta) : 0, team: r?.team ? String(r.team) : "", attributes: r?.attributes && typeof r.attributes === "object" ? r.attributes : null });
  }
  if (players.length < minPlayers) throw new Error(`ratings feed: ${players.length} valid players (need ${minPlayers})`);
  return { asOf: json?.asOf || null, source: json?.source || "", official: json?.official !== false, players };
}

/** Fetch + parse a feed URL. Throws on any failure (the caller keeps the last good copy). */
export async function fetchRatingsFeed(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "Hooptrax/1.0 (ratings sync)" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`ratings feed HTTP ${r.status}`);
  return parseRatingsFeed(await r.json(), { minPlayers: 10 });
}
