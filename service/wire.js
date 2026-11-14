// LiveWire: merges news, transactions, injuries and the scoreboard into one ticker tape. Pure.

export const WIRE_FILTERS = {
  all: () => true,
  moves: (i) => ["TRADE", "SIGNING", "MOVE"].includes(i.tag),
  injuries: (i) => i.tag === "INJURY",
  scores: (i) => ["LIVE", "FINAL"].includes(i.tag),
};

const TX_TAG = { trade: "TRADE", signing: "SIGNING", release: "MOVE", assignment: "MOVE", suspension: "MOVE", other: "MOVE" };

/**
 * @param {{news?, transactions?, injuries?, scoreboard?}} feeds  normalized service data
 * @param {{now?: number, limit?: number}} opts
 * @returns {Array<{id, tag, tone, team, headline, detail, time, url, gameId, kind}>} newest first
 */
export function buildWire({ news, transactions, injuries, scoreboard } = {}, { now = Date.now(), perKind = 25 } = {}) {
  const items = [];

  for (const g of scoreboard?.games || []) {
    const s = g.status || {};
    if (s.state !== "in" && s.state !== "post") continue;
    const a = g.away || {}, h = g.home || {};
    const line = `${a.abbr} ${a.score ?? ""} – ${h.abbr} ${h.score ?? ""}`;
    items.push({
      id: `game:${g.id}:${s.state}`, kind: "game", gameId: g.id,
      tag: s.state === "in" ? "LIVE" : "FINAL", tone: "green",
      team: (s.state === "post" && (a.score ?? 0) > (h.score ?? 0)) ? a : h,
      headline: s.state === "in" ? `${line} · ${s.shortDetail || `Q${s.period} ${s.clock}`}` : `${line} · ${s.shortDetail || "Final"}`,
      detail: g.name || "",
      // Live games stay pinned near the top; finals sort by tip-off time.
      time: s.state === "in" ? now : Date.parse(g.date) + 2.5 * 3600e3 || now,
      url: null,
    });
  }

  for (const t of transactions || []) {
    const tag = TX_TAG[t.kind] || "MOVE";
    items.push({
      id: `tx:${t.date}:${t.team?.abbr}:${t.description}`.slice(0, 200), kind: "transaction",
      tag, tone: tag === "TRADE" ? "blue" : tag === "SIGNING" ? "green" : "slate",
      team: t.team, headline: t.description, detail: t.team?.displayName || "",
      time: Date.parse(t.date) || 0, url: null,
    });
  }

  for (const i of injuries || []) {
    items.push({
      id: `inj:${i.id || i.athlete?.id}:${i.status}`, kind: "injury",
      tag: "INJURY", tone: i.status === "Out" ? "red" : "amber",
      team: i.team, athlete: i.athlete,
      headline: `${i.athlete?.name || "Player"} (${i.team?.abbr || "—"}) ${String(i.status || "").toLowerCase()}${i.injury ? ` · ${i.injury}` : ""}`,
      detail: i.comment || "", status: i.status, returnDate: i.returnDate,
      time: Date.parse(i.date) || 0, url: null,
    });
  }

  for (const n of news || []) {
    items.push({
      id: `news:${n.id}`, kind: "news", tag: "NEWS", tone: "blue",
      team: null, teamIds: n.teamIds || [],
      headline: n.headline, detail: n.description || "", byline: n.byline,
      time: Date.parse(n.published) || 0, url: n.url,
    });
  }

  // Cap each source separately so a busy news day can't push trades, injuries or scores off the tape.
  const seen = new Set();
  const byKind = {};
  for (const i of items.sort((a, b) => b.time - a.time)) {
    if (!i.headline || seen.has(i.id)) continue;
    seen.add(i.id);
    const k = (byKind[i.kind] ||= []);
    if (i.kind === "game" || k.length < perKind) k.push(i);
  }
  return Object.values(byKind).flat().sort((a, b) => b.time - a.time);
}

export function relativeTime(ts, now = Date.now()) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
