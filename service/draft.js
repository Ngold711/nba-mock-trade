// Draft lottery simulation + pick ownership engine. Pure and isomorphic.
//
//   const proj = projectLottery(standings, "321")   // { order, lottery: [{team, seed, balls, tie, ...}] }
//   const sim  = simulateLottery(proj.order, rng, { format: "321", balls: proj.balls, restricted: ["WAS"] })
//   const odds = lotteryTable("321", { balls: proj.balls, restricted: ["WAS"] })   // #1 %, top-4 %, floor
//   const picks = resolvePickOwnership(sim.order, 2027, config)

/**
 * Lottery formats. `balls` is per lottery seed (worst record first); every drawing uses the same
 * weights, skipping teams already drawn. Teams not drawn are ordered by `orderRest`:
 *   "seed"  — worst record first (the 2019 format)
 *   "balls" — most balls first, then worst record; this is what "relegates" the 2-ball bottom seeds
 *             behind the 3-ball group in the 3-2-1 format.
 */
export const LOTTERY_FORMATS = {
  "2019": {
    key: "2019", label: "2019 format", short: "2019 · 14 teams",
    teams: 14, draws: 4, orderRest: "seed",
    balls: [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5], unit: "combos",
    relegated: [],
  },
  "321": {
    key: "321", label: "3-2-1 format", short: "3-2-1 · 16 teams",
    teams: 16, draws: 4, orderRest: "balls",
    // seeds 1–3: 2 balls (relegated) · 4–10: 3 · 11–14: 2 · 15–16: 1  → 37 balls
    balls: [2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1], unit: "balls",
    relegated: [1, 2, 3],
  },
};
export const DEFAULT_FORMAT = "321";

// Back-compat exports (2019 format)
export const LOTTERY_WEIGHTS = LOTTERY_FORMATS["2019"].balls;
export const LOTTERY_TEAMS = 14;
export const LOTTERY_DRAWS = 4;

// ESPN abbreviations → the codes used by data.js and the pick config.
export const ESPN_TO_CODE = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
export const toCode = (abbr) => ESPN_TO_CODE[String(abbr || "").toUpperCase()] || String(abbr || "").toUpperCase();
const fmt = (f) => (typeof f === "string" ? LOTTERY_FORMATS[f] : f) || LOTTERY_FORMATS[DEFAULT_FORMAT];

/**
 * Project the lottery from normalized standings. The lottery is every team outside each
 * conference's top (15 − teams/2) seeds — 14 teams (seeds 9–15) for 2019, 16 (seeds 8–15) for 3-2-1 —
 * worst record first; the rest follow, worst record first.
 * Teams with identical records split their seeds' combined balls evenly (ball-splitting);
 * their order is a coin flip (`rng`).
 */
export function projectLottery(standings, format = DEFAULT_FORMAT, rng = Math.random) {
  const F = fmt(format);
  const cutoff = 15 - F.teams / 2;
  const all = [];
  for (const conf of (standings && standings.conferences) || []) {
    conf.teams.forEach((t, i) => all.push({
      team: toCode(t.team.abbr), pct: Number.isFinite(t.pct) ? t.pct : 0.5,
      wins: t.wins ?? null, losses: t.losses ?? null, confSeed: t.seed ?? i + 1, flip: rng(),
    }));
  }
  const byRecord = (a, b) => a.pct - b.pct || a.flip - b.flip;
  const lottery = all.filter((t) => t.confSeed > cutoff).sort(byRecord);
  const rest = all.filter((t) => t.confSeed <= cutoff).sort(byRecord);
  const balls = splitTies(lottery.map((t) => t.pct), F.balls);
  const tie = tieGroups(lottery.map((t) => t.pct));
  return {
    format: F.key,
    order: [...lottery, ...rest].map((t) => t.team),
    balls,
    lottery: lottery.map((t, i) => ({ ...t, seed: i + 1, balls: balls[i], baseBalls: F.balls[i], tie: tie[i] })),
  };
}
/** Back-compat: just the 30-team order (2019 format by default). */
export function projectOrder(standings, rng = Math.random, format = "2019") {
  return projectLottery(standings, format, rng).order;
}

/** Group ids for runs of identical records (null when a team isn't tied). */
export function tieGroups(pcts) {
  const ids = pcts.map(() => null);
  let g = 0;
  for (let i = 0; i < pcts.length;) {
    let j = i; while (j + 1 < pcts.length && Math.abs(pcts[j + 1] - pcts[i]) < 1e-9) j++;
    if (j > i) { g++; for (let k = i; k <= j; k++) ids[k] = g; }
    i = j + 1;
  }
  return ids;
}
/** Tied teams share their seeds' balls evenly (fractional), as the NBA splits combinations. */
export function splitTies(pcts, base) {
  const out = base.slice(0, pcts.length);
  const ids = tieGroups(pcts);
  const groups = {};
  ids.forEach((g, i) => { if (g) (groups[g] ||= []).push(i); });
  for (const idx of Object.values(groups)) {
    const avg = idx.reduce((s, i) => s + base[i], 0) / idx.length;
    idx.forEach((i) => { out[i] = avg; });
  }
  return out;
}

/** Order of the teams not drawn: by balls (3-2-1) or by seed (2019); worse record first within a tier. */
function restOrder(F, seeds, balls) {
  return [...seeds].sort((a, b) => (F.orderRest === "balls" ? balls[b] - balls[a] : 0) || a - b);
}

/**
 * Run one lottery.
 * opts.format, opts.balls (per seed, after tie-splitting), opts.restricted (team codes barred from #1)
 */
export function simulateLottery(order, rng = Math.random, opts = {}) {
  const F = fmt(opts.format || "2019");
  const n = Math.min(F.teams, order.length);
  const balls = opts.balls && opts.balls.length >= n ? opts.balls : F.balls;
  const restricted = new Set(opts.restricted || []);
  const pool = [...Array(n).keys()];
  const winners = [];
  for (let d = 0; d < F.draws && pool.length; d++) {
    const w = pool.map((s) => (d === 0 && restricted.has(order[s]) ? 0 : balls[s]));
    const total = w.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let x = rng() * total, k = w.findIndex((wi) => (x -= wi) < 0);
    if (k < 0) k = w.length - 1;
    winners.push(pool.splice(k, 1)[0]);
  }
  const rest = restOrder(F, pool, balls);
  const lotteryOrder = [...winners, ...rest];
  const lottery = lotteryOrder.map((s, i) => ({ team: order[s], seed: s + 1, pick: i + 1, moved: s - i, balls: balls[s] }));
  return { format: F.key, order: [...lotteryOrder.map((s) => order[s]), ...order.slice(n)], lottery };
}

/**
 * Exact odds by enumerating every drawing sequence.
 * Returns odds[seed-1][pick-1]. Teams tied on balls/record that fall to the non-drawn order
 * have their positions spread evenly across their block (coin flip).
 */
export function lotteryOdds(format = "2019", { balls: ballsIn, restricted = [], order = null, ties = null } = {}) {
  const F = fmt(format);
  const n = F.teams;
  const balls = ballsIn && ballsIn.length >= n ? ballsIn : F.balls;
  const barred = new Set(order ? order.slice(0, n).map((t, i) => (restricted.includes(t) ? i : -1)).filter((i) => i >= 0) : []);
  const tie = ties || Array(n).fill(null);
  const odds = Array.from({ length: n }, () => Array(n).fill(0));
  const walk = (drawn, p) => {
    if (drawn.length === F.draws) {
      drawn.forEach((s, i) => { odds[s][i] += p; });
      const rest = restOrder(F, [...Array(n).keys()].filter((s) => !drawn.includes(s)), balls);
      for (let i = 0; i < rest.length;) {
        let j = i;
        while (j + 1 < rest.length && tie[rest[i]] != null && tie[rest[j + 1]] === tie[rest[i]] && balls[rest[j + 1]] === balls[rest[i]]) j++;
        const size = j - i + 1;
        for (let a = i; a <= j; a++) for (let b = i; b <= j; b++) odds[rest[a]][F.draws + b] += p / size;
        i = j + 1;
      }
      return;
    }
    const left = [...Array(n).keys()].filter((s) => !drawn.includes(s));
    const w = left.map((s) => (drawn.length === 0 && barred.has(s) ? 0 : balls[s]));
    const total = w.reduce((a, b) => a + b, 0);
    if (total <= 0) { walk([...drawn, ...left].slice(0, F.draws), p); return; }
    left.forEach((s, k) => { if (w[k] > 0) walk([...drawn, s], (p * w[k]) / total); });
  };
  walk([], 1);
  return odds;
}

/** Per-seed summary for the odds panel: balls, #1 %, top-4 %, floor, expected pick. */
export function lotteryTable(format = DEFAULT_FORMAT, opts = {}) {
  const F = fmt(format);
  const odds = lotteryOdds(F, opts);
  const balls = opts.balls && opts.balls.length >= F.teams ? opts.balls : F.balls;
  const totalBalls = balls.slice(0, F.teams).reduce((a, b) => a + b, 0);
  return odds.map((row, i) => {
    const floor = row.reduce((m, p, k) => (p > 1e-12 ? k + 1 : m), 1);
    return {
      seed: i + 1,
      balls: balls[i],
      ballShare: balls[i] / totalBalls,
      p1: row[0],
      top4: row.slice(0, 4).reduce((a, b) => a + b, 0),
      floor,
      expected: row.reduce((s, p, k) => s + p * (k + 1), 0),
      relegated: F.relegated.includes(i + 1),
      row,
    };
  });
}

/* ------------------------------------------------------------- ownership */
const inRange = (pick, [lo, hi]) => pick >= lo && pick <= hi;
const rangeText = ([lo, hi]) => (lo === 1 ? `top-${hi}` : `${lo}–${hi}`);

/**
 * Apply a year's pick obligations to a simulated order.
 * @param {string[]} simulatedOrder 30 team codes, pick 1 first (original owners)
 * @param {number|string} draftYear
 * @param {object} config parsed draft_picks_2027_2029.json
 * @returns {{ picks: Pick[], warnings: string[] }}
 *   Pick = { pick, originalTeam, owner, status, ruleId, explanation, verified, tradeNote }
 *   status: "own" | "conveyed" | "protected_retained" | "swapped" | "swap_kept"
 */
export function resolvePickOwnership(simulatedOrder, draftYear, config) {
  const rules = (config && config.years && config.years[String(draftYear)] && config.years[String(draftYear)].rules) || [];
  const warnings = [];
  const picks = simulatedOrder.map((team, i) => ({
    pick: i + 1, originalTeam: team, owner: team, status: "own", ruleId: null, explanation: "", verified: true, tradeNote: "",
  }));
  const slotOf = (team) => picks.find((p) => p.originalTeam === team);
  const touched = new Map();
  const touch = (p, rule) => {
    if (touched.has(p.pick)) warnings.push(`Pick ${p.pick} (${p.originalTeam}) is affected by both ${touched.get(p.pick)} and ${rule.id}; applied in order.`);
    touched.set(p.pick, rule.id);
    p.ruleId = rule.id; p.tradeNote = rule.description || ""; p.verified = rule.verified !== false;
  };
  const missing = (team, rule) => { warnings.push(`${rule.id}: ${team} isn't in the draft order.`); };

  for (const rule of rules) {
    try {
      switch (rule.type) {
        case "unprotected": {
          const p = slotOf(rule.originalTeam); if (!p) { missing(rule.originalTeam, rule); break; }
          touch(p, rule);
          p.owner = rule.recipientTeam; p.status = "conveyed";
          p.explanation = `${rule.originalTeam}'s pick conveys to ${rule.recipientTeam}, unprotected (landed #${p.pick}).`;
          break;
        }
        case "protected": {
          const p = slotOf(rule.originalTeam); if (!p) { missing(rule.originalTeam, rule); break; }
          touch(p, rule);
          const range = rule.protectedRange || [1, 0];
          if (inRange(p.pick, range)) {
            p.status = "protected_retained";
            p.explanation = `${rangeText(range)} protected: landed #${p.pick}, so ${rule.originalTeam} keeps it and the obligation to ${rule.recipientTeam} carries forward.`;
          } else {
            p.owner = rule.recipientTeam; p.status = "conveyed";
            p.explanation = `Landed #${p.pick}, outside ${rule.originalTeam}'s ${rangeText(range)} protection, so it conveys to ${rule.recipientTeam}.`;
          }
          break;
        }
        case "split_conveyance": {
          const p = slotOf(rule.originalTeam); if (!p) { missing(rule.originalTeam, rule); break; }
          touch(p, rule);
          const route = (rule.routes || []).find((r) => inRange(p.pick, r.range));
          if (!route) { warnings.push(`${rule.id}: no route covers pick ${p.pick}.`); break; }
          p.owner = route.team; p.status = route.team === rule.originalTeam ? "own" : "conveyed";
          p.explanation = `${rule.originalTeam}'s pick landed #${p.pick}, inside ${route.range[0]}–${route.range[1]}, so it goes to ${route.team}. `
            + `(${(rule.routes || []).map((r) => `${r.range[0]}–${r.range[1]} → ${r.team}`).join(", ")})`;
          break;
        }
        case "swap_pool": {
          let pool = (rule.pool || []).map((t) => slotOf(t) || (missing(t, rule), null)).filter(Boolean);
          const excludedNotes = [];
          for (const ex of rule.exclude || []) {
            const p = pool.find((x) => x.originalTeam === ex.team);
            if (p && inRange(p.pick, ex.protectedRange)) {
              pool = pool.filter((x) => x !== p);
              touch(p, rule);
              p.status = "protected_retained";
              p.explanation = `${ex.team}'s pick landed #${p.pick}, inside its ${rangeText(ex.protectedRange)} protection, so it's excluded from the swap and ${ex.team} keeps it.`;
              excludedNotes.push(`${ex.team} excluded (${rangeText(ex.protectedRange)} protected, landed #${p.pick})`);
            }
          }
          if (!pool.length) break;
          const sorted = [...pool].sort((a, b) => a.pick - b.pick);
          const override = (rule.overrides || []).find((o) => o.if && o.if.allWithin && sorted.every((p) => inRange(p.pick, o.if.allWithin)));
          const assign = override ? override.assign : rule.assign || [];
          const owners = new Map(sorted.map((p) => [p, p.owner]));
          for (const a of assign) {
            const targets = a.rank === "all" ? sorted
              : a.rank === "most_favorable" ? [sorted[0]]
              : a.rank === "least_favorable" ? [sorted[sorted.length - 1]]
              : Number.isInteger(a.rank) ? [sorted[a.rank - 1]].filter(Boolean) : [];
            targets.forEach((p) => owners.set(p, a.team));
          }
          const poolText = sorted.map((p) => `${p.originalTeam} #${p.pick}`).join(", ");
          for (const p of sorted) {
            touch(p, rule);
            const newOwner = owners.get(p);
            const changed = newOwner !== p.owner;
            p.owner = newOwner;
            p.status = changed ? "swapped" : "swap_kept";
            const role = p === sorted[0] ? "most favorable" : p === sorted[sorted.length - 1] ? "least favorable" : `#${sorted.indexOf(p) + 1} of ${sorted.length}`;
            p.explanation = (override ? `${override.description || "Override applied."} ` : "")
              + `Swap pool ${poolText}: this is the ${role} pick, which goes to ${newOwner}.`
              + (excludedNotes.length ? ` ${excludedNotes.join("; ")}.` : "");
          }
          break;
        }
        default:
          warnings.push(`${rule.id}: unknown rule type "${rule.type}".`);
      }
    } catch (err) {
      warnings.push(`${rule.id}: ${err.message}`);
    }
  }
  return { picks, warnings };
}

/* ------------------------------------------------------------ pick inventory */
const rngTxt = (r) => (r[0] === 1 ? `top-${r[1]}` : `${r[0]}–${r[1]}`);
/**
 * A team's 2027–2029 first-round picture from the pick config: its own pick (and any obligation on it)
 * plus picks or swap rights it holds from other teams. Text only; the exact outcome depends on the lottery.
 * @returns {{year:string, items:{kind:"own"|"owes"|"owns"|"swap", text:string, verified:boolean}[]}[]}
 */
export function pickInventory(code, config, years = ["2027", "2028", "2029"]) {
  return years.map((year) => {
    const rules = config?.years?.[year]?.rules || [];
    const items = [];
    let ownTouched = false;
    for (const r of rules) {
      const v = r.verified !== false;
      if (r.type === "unprotected" || r.type === "protected") {
        const prot = r.type === "protected" ? `, ${rngTxt(r.protectedRange)} protected` : ", unprotected";
        if (r.originalTeam === code) { ownTouched = true; items.push({ kind: "owes", text: `Owes own 1st to ${r.recipientTeam}${prot}`, verified: v }); }
        if (r.recipientTeam === code) items.push({ kind: "owns", text: `Owns ${r.originalTeam}'s 1st${prot}`, verified: v });
      } else if (r.type === "split_conveyance") {
        const routes = (r.routes || []).map((x) => `${x.range[0]}–${x.range[1]} → ${x.team}`).join(", ");
        if (r.originalTeam === code) { ownTouched = true; items.push({ kind: "owes", text: `Own 1st conveys by slot (${routes})`, verified: v }); }
        else if ((r.routes || []).some((x) => x.team === code)) items.push({ kind: "owns", text: `Conditional rights to ${r.originalTeam}'s 1st (${routes})`, verified: v });
      } else if (r.type === "swap_pool") {
        const inPool = (r.pool || []).includes(code);
        const gets = (r.assign || []).filter((a) => a.team === code).map((a) => String(a.rank).replace("_", " "));
        if (inPool || gets.length) {
          if (inPool) ownTouched = true;
          items.push({ kind: "swap", text: `${inPool ? "Own 1st in swap pool" : "Swap rights"} (${(r.pool || []).join("/")})${gets.length ? `: gets ${gets.join(", ")}` : ""}`, verified: v });
        }
      }
    }
    if (!ownTouched) items.unshift({ kind: "own", text: "Owns its own 1st", verified: true });
    return { year, items };
  });
}

/* ----------------------------------------------------------- Monte Carlo */
/**
 * Run the lottery `runs` times and tabulate where each lottery team lands.
 * @returns {{ runs, rows: {team, seed, p1, top4, top10, mostLikely, avgPick, dist: number[]}[] }}
 */
export function monteCarlo(order, runs = 1000, { format = DEFAULT_FORMAT, balls, restricted, rng = Math.random } = {}) {
  const F = fmt(format);
  const n = Math.min(F.teams, order.length);
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let r = 0; r < runs; r++) {
    const { lottery } = simulateLottery(order, rng, { format, balls, restricted });
    for (const l of lottery) counts[l.seed - 1][l.pick - 1]++;
  }
  const rows = counts.map((c, s) => {
    const share = (k) => c.slice(0, k).reduce((a, b) => a + b, 0) / runs;
    let best = 0; c.forEach((v, i) => { if (v > c[best]) best = i; });
    return { team: order[s], seed: s + 1, p1: share(1), top4: share(4), top10: share(10), mostLikely: best + 1, avgPick: c.reduce((a, v, i) => a + v * (i + 1), 0) / runs, dist: c.map((v) => v / runs) };
  });
  return { runs, format: F.key, rows };
}

/* ------------------------------------------------------- pick ownership grid */
/**
 * Every team's own first in each year: "own" | "unprotected" (traded) | "protected" | "swap" | "split", plus who holds it
 * and the other teams' firsts it holds. Drives the 30-team Pick Grid.
 */
export function pickGrid(config, teams, years = ["2027", "2028", "2029"]) {
  const out = {};
  for (const code of teams) {
    out[code] = {};
    for (const y of years) {
      const rules = config?.years?.[y]?.rules || [];
      const cell = { status: "own", to: null, note: "Owns its own 1st", verified: true, holds: [] };
      for (const r of rules) {
        const v = r.verified !== false;
        if ((r.type === "unprotected" || r.type === "protected") && r.originalTeam === code) {
          Object.assign(cell, { status: r.type, to: r.recipientTeam, verified: v,
            note: r.type === "protected" ? `To ${r.recipientTeam} unless ${r.protectedRange[0] === 1 ? `top-${r.protectedRange[1]}` : `${r.protectedRange[0]}–${r.protectedRange[1]}`}` : `To ${r.recipientTeam}, unprotected` });
        } else if (r.type === "split_conveyance" && r.originalTeam === code) {
          Object.assign(cell, { status: "protected", to: (r.routes || []).map((x) => x.team).filter((t) => t !== code).join("/"), verified: v, note: `By slot: ${(r.routes || []).map((x) => `${x.range[0]}–${x.range[1]} → ${x.team}`).join(", ")}` });
        } else if (r.type === "swap_pool" && (r.pool || []).includes(code) && cell.status === "own") {
          Object.assign(cell, { status: "swap", to: null, verified: v, note: `Swap pool: ${(r.pool || []).join("/")}` });
        }
        if ((r.type === "unprotected" || r.type === "protected") && r.recipientTeam === code) cell.holds.push(r.originalTeam);
        if (r.type === "split_conveyance" && (r.routes || []).some((x) => x.team === code) && r.originalTeam !== code) cell.holds.push(`${r.originalTeam}*`);
      }
      out[code][y] = cell;
    }
  }
  return out;
}
