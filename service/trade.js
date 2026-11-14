// Trade legality engine for the 2026–27 season. Pure: shared by the Trade Machine page and the tests.
//
//   salaries      resolveSalary() → live ESPN contract → bundled ESPN contract snapshot → estimate (never $0)
//   cap status    teamTier()      → Under Cap / Over Cap / 1st Apron / 2nd Apron from team payroll
//   legality      validateTrade() → salary matching, apron limits, 2nd-apron aggregation ban,
//                                   Stepien Rule (2027–2029 firsts), roster-size warnings
//   share links   encodeTrade() / decodeTrade() → compact ?trade=… parameter
//
// All money here is in millions of dollars ($M).

export const STEPIEN_YEARS = [2027, 2028, 2029];
export const TIERS = { under: "Under Cap", over: "Over Cap", apron1: "1st Apron", apron2: "2nd Apron" };
const EPS = 1e-6;
const sum = (xs) => xs.reduce((s, x) => s + (x.salary || 0), 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);

export const money = (m, { sign = false } = {}) => {
  if (m == null || !Number.isFinite(m)) return "—";
  const s = sign ? (m > EPS ? "+" : m < -EPS ? "−" : "") : m < -EPS ? "−" : "";
  const a = Math.abs(m);
  const body = a >= 1 ? `${a.toFixed(a >= 100 ? 0 : 1).replace(/\.0$/, "")}M` : a > EPS ? `${Math.round(a * 1000)}K` : "0";
  return `${s}$${body}`;
};

/* ------------------------------------------------------------------ salaries */
/** Veteran minimum by years of experience (2026–27, $M, approximate). */
export function vetMinimum(exp, cba) {
  const t = cba?.minimumByExperience || [[0, 1.3], [1, 2.1], [2, 2.4], [3, 2.5], [4, 2.6], [5, 2.8], [7, 3.0], [10, 3.6]];
  let v = t[0][1];
  for (const [yrs, amt] of t) if ((exp ?? 0) >= yrs) v = amt;
  return v;
}

/**
 * Salary estimate for a player with no contract on file. Uses experience and production so no active
 * player shows $0: veteran minimum, rookie scale (~$3–12M), rotation (~$14–22M) or starter money.
 */
export function estimateSalary({ experience = null, age = null, stats = null, snapshotSalary = null } = {}, cba) {
  const exp = experience ?? (age ? Math.max(0, age - 21) : 3);
  const gp = stats?.gp || 0, pts = gp ? stats.pts || 0 : 0, min = gp ? stats.min || 0 : 0;
  const floor = vetMinimum(exp, cba);
  let est;
  if (!gp) {
    // No games yet: a continuing contract from last season's snapshot is the best guess, else the floor.
    est = snapshotSalary ? snapshotSalary * 1.05 : exp <= 3 ? Math.max(floor, 3) : floor;
  } else if (exp <= 3) {
    est = pts < 3 && min < 12 ? Math.max(floor, 2) : lerp(3, 12, (pts - 3) / 15);          // rookie scale
  } else if (pts >= 20) {
    est = lerp(28, 48, (pts - 20) / 10);                                                     // starter / max money
  } else if (pts >= 12 || min >= 26) {
    est = lerp(14, 22, (pts - 12) / 8);                                                      // rotation tier
  } else if (pts >= 6 || min >= 16) {
    est = exp >= 10 ? floor * 1.5 : lerp(4, 12, (pts - 6) / 6);                              // bench contract
  } else est = floor;
  return Math.round(Math.max(floor, est) * 100) / 100;
}

/**
 * Resolve a player's 2026–27 cap number.
 * @param {{id?, name, salary?, experience?, age?}} player  salary (dollars) is ESPN's live contract when present
 * @param {{ book?, stats?, snapshotSalary?, cba? }} ctx      book = salaries_2026_27.json
 * @returns {{ salary: number, source: "espn"|"book"|"estimate" }}
 */
export function resolveSalary(player, { book = null, stats = null, snapshotSalary = null, cba = book?.cba } = {}) {
  if (player?.salary > 0) return { salary: Math.round(player.salary / 1e4) / 100, source: "espn" };
  const hit = player?.id && book?.players?.[String(player.id)];
  if (hit && hit.salary > 0) return { salary: hit.salary, source: "book" };
  return { salary: estimateSalary({ experience: player?.experience, age: player?.age, stats, snapshotSalary }, cba), source: "estimate" };
}

/* --------------------------------------------------------------- cap status */
export function teamTier(payroll, cba) {
  if (payroll >= cba.secondApron - EPS) return "apron2";
  if (payroll >= cba.firstApron - EPS) return "apron1";
  if (payroll > cba.salaryCap + EPS) return "over";
  return "under";
}

/** Most incoming salary an over-the-cap team below the first apron may take back for `out`. */
export function matchingLimit(out, cba) {
  const m = cba.matching;
  if (out <= m.smallMax) return m.smallPct * out + m.cushion;      // small contracts: 200% + $250K
  if (out <= m.midMax) return out + m.midAdd;                       // middle band: outgoing + flat amount
  return m.largePct * out + m.cushion;                              // 125% + $250K
}

/* -------------------------------------------------------------- Stepien rule */
/**
 * First-round picks a team holds in each year, from the pick-obligation config (draft_picks_2027_2029.json).
 * `own` is false when the team's own pick is owed out (protected picks count as owed for Stepien purposes);
 * swap-pool members still end up with a first, so they keep it. `acquired` lists other teams' firsts it owns.
 */
export function firstRoundHoldings(code, config, years = STEPIEN_YEARS) {
  const out = {};
  for (const y of years) {
    const rules = config?.years?.[String(y)]?.rules || [];
    let own = true, owedTo = null;
    const acquired = [];
    for (const r of rules) {
      if (r.type === "unprotected" || r.type === "protected") {
        if (r.originalTeam === code) { own = false; owedTo = r.recipientTeam; }
        if (r.recipientTeam === code) acquired.push(r.originalTeam);
      } else if (r.type === "split_conveyance") {
        if (r.originalTeam === code) { own = false; owedTo = (r.routes || []).map((x) => x.team).filter((t) => t !== code).join("/") || null; }
      }
    }
    out[y] = { own, owedTo, acquired };
  }
  return out;
}

/* ------------------------------------------------------------------ legality */
/**
 * @param {Array<{ abbr, payroll, rosterCount?, holdings?, sends: Asset[], receives: Asset[] }>} teams
 *   Asset = { kind: "player"|"pick", name, salary ($M), year?, round?, origin? (original team of a pick) }
 * @param {{ cba, strict?: boolean }} opts
 */
export function validateTrade(teams, { cba, strict = true } = {}) {
  const active = teams.filter(Boolean);
  const results = active.map((t) => validateTeam(t, cba));
  const involved = results.filter((r) => r.sends.length || r.receives.length);
  const general = [];
  if (active.length < 2) general.push("Pick at least two teams.");
  else if (!involved.length) general.push("Add a player or pick to start.");
  else for (const r of results) if (!r.sends.length && !r.receives.length) general.push(`${r.abbr} isn't part of the deal yet.`);
  const reasons = [...general, ...results.flatMap((r) => r.errors.map((e) => `${r.abbr}: ${e}`))];
  const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.abbr}: ${w}`));
  const legal = !reasons.length;
  const ready = !general.length;
  return {
    legal, strict, ready,
    // Sandbox mode keeps all the math but lets any deal through to sharing and export.
    accepted: strict ? legal : ready,
    status: !ready ? "incomplete" : legal ? "legal" : strict ? "failed" : "sandbox",
    reasons, warnings, teams: results,
  };
}

export function validateTeam(t, cba) {
  const sends = t.sends || [], receives = t.receives || [];
  const out = sum(sends), inc = sum(receives);
  const pre = t.payroll ?? 0, post = pre - out + inc;
  const tierPre = teamTier(pre, cba), tierPost = teamTier(post, cba);
  const errors = [], warnings = [];
  let need = 0;               // $M of incoming salary to cut (or outgoing to add) to make this team legal
  let rule = "";

  if (inc > out + EPS) {
    const apronLimited = tierPre === "apron1" || tierPre === "apron2" || post > cba.firstApron + EPS;
    if (post <= cba.salaryCap + EPS) {
      rule = `Absorbs ${money(inc - out)} into cap space.`;
    } else if (apronLimited) {
      const which = tierPre === "apron2" || post > cba.secondApron + EPS ? "Second Apron" : "First Apron";
      rule = `${which} team: incoming salary is capped at 100% of outgoing (${money(out)}).`;
      need = inc - out;
      errors.push(`${which} team can't take back more salary than it sends. Incoming ${money(inc)} vs outgoing ${money(out)}; cut ${money(need)} of incoming salary or add it to the outgoing side.`);
    } else {
      const room = pre < cba.salaryCap ? cba.salaryCap - pre + out : 0;      // cap room route
      const allowed = Math.max(matchingLimit(out, cba), room);
      rule = `Over-cap matching: may take back up to ${money(allowed)} for ${money(out)} out.`;
      if (inc > allowed + EPS) {
        need = inc - allowed;
        errors.push(`Takes back ${money(inc)} but may only take back ${money(allowed)} for ${money(out)} outgoing. ${money(need)} over the limit.`);
      }
    }
  } else if (sends.length || receives.length) {
    rule = inc < out - EPS ? `Sends out ${money(out - inc)} more than it takes back.` : "Salaries match exactly.";
  }

  // Second-apron aggregation ban: can't combine two or more salaries to bring back a bigger one.
  if (tierPre === "apron2" || post > cba.secondApron + EPS) {
    const outPlayers = sends.filter((a) => a.kind === "player");
    const biggestOut = Math.max(0, ...outPlayers.map((a) => a.salary || 0));
    const bigger = receives.filter((a) => a.kind === "player" && (a.salary || 0) > biggestOut + EPS);
    if (outPlayers.length > 1 && bigger.length) {
      errors.push(`Second Apron teams can't aggregate salaries: ${outPlayers.length} outgoing contracts are combined to take in ${bigger.map((b) => b.name).join(", ")} (${money(bigger[0].salary)}), more than any single outgoing salary (${money(biggestOut)}).`);
    }
  }

  // Stepien Rule on 2027–2029 first-round picks.
  const stepien = stepienCheck(t);
  errors.push(...stepien.errors);

  // Roster size (ESPN rosters include two-way players, so only flag changes that create the problem).
  if (t.rosterCount != null) {
    const nOut = sends.filter((a) => a.kind === "player").length, nIn = receives.filter((a) => a.kind === "player").length;
    const after = t.rosterCount - nOut + nIn;
    if (after > 15 && nIn > nOut) warnings.push(`Roster goes to ${after} players (max 15 standard contracts); a waiver would be needed.`);
    if (after < 12 && nOut > nIn) warnings.push(`Roster drops to ${after} players (minimum 12); a signing would be needed.`);
  }

  return {
    abbr: t.abbr, sends, receives, out, inc, net: inc - out, pre, post, tierPre, tierPost,
    ok: !errors.length, errors, warnings, need, rule, firsts: stepien.after,
  };
}

/** First-round picks per year after the trade, and any Stepien / ownership violations. */
export function stepienCheck(t) {
  const errors = [];
  const h = t.holdings;
  if (!h) return { errors, after: null };
  const after = {};
  for (const y of STEPIEN_YEARS) {
    const base = h[y] || { own: true, acquired: [] };
    const sent = (t.sends || []).filter((a) => a.kind === "pick" && a.round === 1 && a.year === y);
    const got = (t.receives || []).filter((a) => a.kind === "pick" && a.round === 1 && a.year === y);
    for (const p of sent) {
      const origin = p.origin || t.abbr;
      if (origin === t.abbr && !base.own) errors.push(`Doesn't control its own ${y} 1st; it's already owed${base.owedTo ? ` to ${base.owedTo}` : ""}.`);
      if (origin !== t.abbr && !base.acquired.includes(origin)) errors.push(`Doesn't own ${origin}'s ${y} 1st.`);
    }
    after[y] = (base.own ? 1 : 0) + base.acquired.length - sent.length + got.length;
  }
  const tradesAFirst = (t.sends || []).some((a) => a.kind === "pick" && a.round === 1);
  if (tradesAFirst) {
    const gaps = [];
    for (let i = 0; i < STEPIEN_YEARS.length - 1; i++) {
      const a = STEPIEN_YEARS[i], b = STEPIEN_YEARS[i + 1];
      if (after[a] <= 0 && after[b] <= 0) gaps.push(`${a} & ${b}`);
    }
    if (gaps.length) errors.push(`Stepien Rule: would be left without a 1st-round pick in consecutive drafts (${gaps.join(", ")}).`);
  }
  return { errors, after };
}

/* --------------------------------------------------------------- share links */
// Compact, URL-safe: "v1~ATL.BOS.LAL~0p4065648>1,1k2027.1>0,1k2028.1.NYK>2"
//   asset = <fromIdx><type><ref>><toIdx>   type p = ESPN player id, s = snapshot name slug, k = pick (year.round[.origin])
export function encodeTrade({ teams, assets }) {
  const t = teams.map((x) => x || "_");
  const idx = (abbr) => t.indexOf(abbr);
  const parts = [];
  for (const a of assets) {
    const [from, ref] = a.id.split(":");
    const fi = idx(from), ti = a.to ? idx(a.to) : -1;
    if (fi < 0) continue;
    let enc;
    const pick = /^(\d{4})-(1|2)(?:@([A-Z]{2,4}))?$/.exec(ref);
    if (pick) enc = `k${pick[1]}.${pick[2]}${pick[3] ? "." + pick[3] : ""}`;
    else if (/^p\d+$/.test(ref)) enc = ref;
    else enc = `s${ref}`;
    parts.push(`${fi}${enc}${ti >= 0 ? `>${ti}` : ""}`);
  }
  const raw = `v1~${t.join(".")}~${parts.join(",")}`;
  return b64urlEncode(raw);
}
export function decodeTrade(param, validTeam = () => true) {
  let raw;
  try { raw = b64urlDecode(String(param || "")); } catch { return null; }
  const m = /^v1~([A-Z_.]+)~(.*)$/.exec(raw || "");
  if (!m) return null;
  const teams = m[1].split(".").slice(0, 4).map((x) => (x !== "_" && validTeam(x) ? x : null));
  while (teams.length < 2) teams.push(null);
  const assets = [];
  for (const part of m[2].split(",").filter(Boolean)) {
    const a = /^(\d)(p\d+|s[a-z0-9-]+|k(\d{4})\.(1|2)(?:\.([A-Z]{2,4}))?)(?:>(\d))?$/.exec(part);
    if (!a) continue;
    const from = teams[+a[1]];
    if (!from) continue;
    let ref = a[2];
    if (a[3]) ref = `${a[3]}-${a[4]}${a[5] ? "@" + a[5] : ""}`;
    else if (ref[0] === "s") ref = ref.slice(1);
    const to = a[6] != null ? teams[+a[6]] || null : null;
    const id = `${from}:${ref}`;
    if (!assets.some((x) => x.id === id)) assets.push({ id, to: to !== from ? to : null });
  }
  return { teams, assets };
}
function b64urlEncode(s) {
  const b = typeof Buffer !== "undefined" ? Buffer.from(s, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(s)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return typeof Buffer !== "undefined" ? Buffer.from(b, "base64").toString("utf8") : decodeURIComponent(escape(atob(b)));
}
