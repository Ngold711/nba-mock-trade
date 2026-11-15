// Coaches, executives and owners (nba_people.json) + current front offices, joined with live ESPN data:
// each team's current head coach comes from the ESPN roster feed, a current coach's season record from
// ESPN standings. Pure functions; the server loads the data.
import { norm } from "./player.js";

const ESPN_OF = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" };
const CODE_OF = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
export const ROLE_LABEL = { player: "Player Career", coach: "Coaching Career", exec: "Front Office / GM", owner: "Ownership" };
export const ROLES = ["player", "coach", "exec", "owner"];

const yrs = (s) => (s.from == null ? (s.to == null ? "Current" : `–${s.to}`) : s.to == null ? `${s.from}–present` : s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`);
export const stintYears = yrs;

/** Search people by name (optionally one role). */
export function searchPeople(q, people, { role = null, limit = 12 } = {}) {
  const k = norm(q); if (k.length < 2) return [];
  const score = (name) => { const n = norm(name); const last = n.split(" ").slice(-1)[0]; return n === k ? 100 : n.startsWith(k) ? 80 : last.startsWith(k) ? 78 : n.split(" ").some((w) => w.startsWith(k)) ? 60 : n.includes(k) ? 40 : 0; };
  return people.filter((p) => !role || p.roles.includes(role)).map((p) => ({ p, s: score(p.name) })).filter((x) => x.s)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, limit).map(({ p, s }) => ({ ...summary(p), score: s + 6 }));
}
export function summary(p) {
  const team = p.coach?.current || p.exec?.stints?.find((x) => x.to == null)?.team || p.owner?.teams?.find((x) => x.to == null)?.team || "";
  return { kind: "person", id: p.id, name: p.name, roles: p.roles, playerId: p.playerId || null, team, years: "", ...(p.meta?.verified === false ? { unverified: true } : {}) };
}

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
/**
 * The full people directory: the editorial archive plus a generated profile for every current head coach
 * (live from ESPN rosters), president/GM and owner who has no editorial entry, so all 30 teams × 3 roles are
 * searchable and tappable. Current coaching jobs are re-derived from ESPN when the feed has coaches.
 * Returns { people, link } where link[code] = { coach, president, gm, owner } person ids.
 */
export function directory(data, league = null) {
  const base = data?.people || [];
  const espnCoach = (code) => league?.teams?.[ESPN_OF[code] || code]?.coach || "";
  const live = Object.keys(data?.teams || {}).some((c) => espnCoach(c));
  const people = base.map((p) => (p.coach && live ? { ...p, coach: { ...p.coach, current: null } } : p));
  const byName = new Map(people.map((p, i) => [norm(p.name), i]));
  const ids = new Set(people.map((p) => p.id));
  const fresh = (name, code) => { let id = slug(name) || `person-${code.toLowerCase()}`; if (ids.has(id)) id = `${id}-${code.toLowerCase()}`.slice(0, 40); ids.add(id); return id; };
  const link = {};
  for (const [code, t] of Object.entries(data?.teams || {})) {
    const L = (link[code] = { coach: null, president: null, gm: null, owner: null });
    const cn = espnCoach(code);
    if (cn) {
      const i = byName.get(norm(cn));
      if (i != null && people[i].coach) { people[i] = { ...people[i], coach: { ...people[i].coach, current: code } }; L.coach = people[i].id; }
      else if (i != null) { people[i] = { ...people[i], roles: [...people[i].roles, "coach"], coach: { stints: [{ team: code, from: null, to: null }], titles: [], current: code } }; L.coach = people[i].id; }
      else {
        const p = { id: fresh(cn, code), name: cn, roles: ["coach"], coach: { stints: [{ team: code, from: null, to: null }], titles: [], current: code }, meta: { generated: true, verified: true, source: "ESPN (live)" } };
        people.push(p); byName.set(norm(cn), people.length - 1); L.coach = p.id;
      }
    }
    for (const r of ["president", "gm", "owner"]) {
      const x = t[r]; if (!x?.name) continue;
      if (x.person && ids.has(x.person)) { L[r] = x.person; continue; }
      const i = byName.get(norm(x.name));
      if (i != null) { L[r] = people[i].id; continue; }
      const meta = { generated: true, verified: !!x.verified, source: x.source || "", note: x.note || "" };
      const p = r === "owner"
        ? { id: fresh(x.name, code), name: x.name, roles: ["owner"], owner: { teams: [{ team: code, from: x.since ?? null, to: null, note: x.note || "" }], titles: [] }, meta }
        : { id: fresh(x.name, code), name: x.name, roles: ["exec"], exec: { stints: [{ team: code, title: x.title || (r === "gm" ? "General Manager" : "Basketball Operations"), from: x.since ?? null, to: null }], titles: [] }, meta };
      people.push(p); byName.set(norm(x.name), people.length - 1); L[r] = p.id;
    }
  }
  return { people, link };
}

/** Index: playerId → person (for multi-role players opened from player search). */
export const byPlayerId = (people) => new Map(people.filter((p) => p.playerId).map((p) => [String(p.playerId), p]));

/** Full person profile for the encyclopedia. */
export function personProfile(p, { standings = null, league = null, history = null } = {}) {
  if (!p) return null;
  const teamName = (code) => league?.teams?.[ESPN_OF[code] || code]?.displayName || code;
  const logo = (code) => league?.teams?.[ESPN_OF[code] || code]?.logo || `https://a.espncdn.com/i/teamlogos/nba/500/${(ESPN_OF[code] || code).toLowerCase()}.png`;
  const team = (code, label) => ({ code, name: label || teamName(code), logo: logo(code) });
  let current = null;
  if (p.coach?.current && standings) {
    for (const c of standings.conferences || []) for (const t of c.teams || []) {
      if (t.team?.abbr === (ESPN_OF[p.coach.current] || p.coach.current)) current = { team: p.coach.current, w: t.wins, l: t.losses, seed: t.seed, conf: c.abbr || c.name };
    }
  }
  const coach = p.coach ? {
    stints: p.coach.stints.map((s) => ({ ...team(s.team, s.label), years: yrs(s), note: s.note || "" })),
    record: p.coach.record ? { ...p.coach.record, pct: Math.round((p.coach.record.w / (p.coach.record.w + p.coach.record.l)) * 1000) / 1000, playoffPct: p.coach.record.pw != null ? Math.round((p.coach.record.pw / (p.coach.record.pw + p.coach.record.pl)) * 1000) / 1000 : null } : null,
    titles: p.coach.titles || [], coy: p.coach.coy || [], notes: p.coach.notes || [], current,
  } : null;
  const exec = p.exec ? { stints: p.exec.stints.map((s) => ({ ...team(s.team), title: s.title, years: yrs(s) })), titles: p.exec.titles || [], eoy: p.exec.eoy || [], notes: p.exec.notes || [] } : null;
  const owner = p.owner ? { teams: p.owner.teams.map((s) => ({ ...team(s.team), years: yrs(s), price: s.price || "", note: s.note || "" })), titles: p.owner.titles || [] } : null;
  const leg = p.legendId ? history?.legends?.find((l) => l.id === p.legendId) : null;
  const player = p.roles.includes("player") ? { playerId: p.playerId || null, span: p.player?.span || "", note: p.player?.note || "", career: leg ? { gp: leg.gp, pts: leg.pts, reb: leg.reb, ast: leg.ast, totals: leg.totals } : null } : null;
  const coy = p.coach?.coy?.length ? p.coach.coy : (history?.awards?.coy || []).filter((a) => norm(a.name) === norm(p.name)).map((a) => a.year);
  if (coach && !coach.coy.length && coy.length) coach.coy = coy;
  return { id: p.id, name: p.name, roles: p.roles, meta: p.meta || null, headshot: p.playerId ? `https://a.espncdn.com/i/headshots/nba/players/full/${p.playerId}.png` : null, player, coach, exec, owner };
}

/** The 30 current front offices: head coach from ESPN (live), president/GM/owner from nba_people.json; every name links to a profile. */
export function frontOffices(data, league, standings = null) {
  const dir = directory(data, league);
  const rec = {};
  for (const c of standings?.conferences || []) for (const t of c.teams || []) if (t.team?.abbr) rec[CODE_OF[t.team.abbr] || t.team.abbr] = { w: t.wins, l: t.losses, seed: t.seed, conf: c.abbr || c.name };
  return Object.entries(data?.teams || {}).map(([code, t]) => {
    const espn = league?.teams?.[ESPN_OF[code] || code];
    const coachName = espn?.coach || "";
    const L = dir.link[code] || {};
    const role = (x, r) => (x ? { name: x.name, title: x.title || "", verified: !!x.verified, source: x.source || "", note: x.note || "", since: x.since ?? null, person: L[r] || null } : null);
    return {
      team: code, name: espn?.displayName || code, logo: espn?.logo || null, color: espn?.color || null, record: rec[code] || null,
      coach: coachName ? { name: coachName, verified: true, source: "ESPN (live)", person: L.coach || null } : null,
      president: role(t.president, "president"), gm: role(t.gm, "gm"), owner: role(t.owner, "owner"),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export { CODE_OF };
