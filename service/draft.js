// Draft lottery simulation + pick ownership engine. Pure and isomorphic.
//
//   const order = projectOrder(standings)          // 30 team codes, worst record first
//   const sim = simulateLottery(order)             // { order, lottery: [{team, seed, pick, moved}] }
//   const picks = resolvePickOwnership(sim.order, 2027, config)

// Chances of winning the #1 pick per lottery seed (2019 format), out of 1000 combinations.
// The same weights drive every draw; a team already drawn is skipped, as in the real lottery.
export const LOTTERY_WEIGHTS = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
export const LOTTERY_TEAMS = 14;
export const LOTTERY_DRAWS = 4;

// ESPN abbreviations → the codes used by data.js and the pick config.
export const ESPN_TO_CODE = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
export const toCode = (abbr) => ESPN_TO_CODE[String(abbr || "").toUpperCase()] || String(abbr || "").toUpperCase();

/**
 * Draft order from normalized standings (service/normalize.js shape).
 * Non-playoff teams (conference seeds 9–15, i.e. play-in losers approximated) form the
 * lottery, worst record first; the other 16 follow, worst record first.
 * Ties are broken with `rng` so repeated projections stay honest about coin flips.
 */
export function projectOrder(standings, rng = Math.random) {
  const all = [];
  for (const conf of (standings && standings.conferences) || []) {
    conf.teams.forEach((t, i) => all.push({
      team: toCode(t.team.abbr),
      pct: Number.isFinite(t.pct) ? t.pct : 0.5,
      seed: t.seed ?? i + 1,
      tie: rng(),
    }));
  }
  const byRecord = (a, b) => a.pct - b.pct || a.tie - b.tie;
  const lottery = all.filter((t) => t.seed > 8).sort(byRecord);
  const playoff = all.filter((t) => t.seed <= 8).sort(byRecord);
  return [...lottery, ...playoff].map((t) => t.team);
}

/** Run one lottery. Returns the full 30-team order and how each lottery team moved. */
export function simulateLottery(order, rng = Math.random) {
  const lotteryTeams = order.slice(0, LOTTERY_TEAMS);
  const winners = [];
  const remaining = lotteryTeams.map((team, i) => ({ team, seed: i + 1, w: LOTTERY_WEIGHTS[i] ?? 0 }));
  for (let d = 0; d < LOTTERY_DRAWS && remaining.length; d++) {
    const total = remaining.reduce((s, t) => s + t.w, 0);
    let x = rng() * total;
    let idx = remaining.findIndex((t) => (x -= t.w) < 0);
    if (idx < 0) idx = remaining.length - 1;
    winners.push(remaining.splice(idx, 1)[0]);
  }
  const lotteryOrder = [...winners, ...remaining.sort((a, b) => a.seed - b.seed)];
  const lottery = lotteryOrder.map((t, i) => ({ team: t.team, seed: t.seed, pick: i + 1, moved: t.seed - (i + 1) }));
  return { order: [...lotteryOrder.map((t) => t.team), ...order.slice(LOTTERY_TEAMS)], lottery };
}

/** Exact odds table (seed × pick) by enumerating every draw sequence. Useful for tooltips. */
export function lotteryOdds() {
  const n = LOTTERY_TEAMS;
  const odds = Array.from({ length: n }, () => Array(n).fill(0));
  const walk = (drawn, p) => {
    if (drawn.length === LOTTERY_DRAWS) {
      const rest = [...Array(n).keys()].filter((s) => !drawn.includes(s));
      drawn.forEach((s, i) => { odds[s][i] += p; });
      rest.forEach((s, i) => { odds[s][LOTTERY_DRAWS + i] += p; });
      return;
    }
    const left = [...Array(n).keys()].filter((s) => !drawn.includes(s));
    const total = left.reduce((sum, s) => sum + LOTTERY_WEIGHTS[s], 0);
    for (const s of left) walk([...drawn, s], p * LOTTERY_WEIGHTS[s] / total);
  };
  walk([], 1);
  return odds;   // odds[seed-1][pick-1]
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
