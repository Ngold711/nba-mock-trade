# NBA Mock Trade + Live

A trade builder and a live NBA hub backed by ESPN's public JSON feeds (no API key).

```
npm start          # http://127.0.0.1:8787  — trade builder at /, live hub at /live.html
npm test           # normalizers, cache/polling, and HTTP routes (Node 18+, no dependencies)
```

`PORT` and `HOST` are read from the environment. If your network only allows outbound
traffic through an HTTPS proxy, start with `NODE_USE_ENV_PROXY=1` (Node 22.21+) so Node's
`fetch` honors `HTTPS_PROXY`.

## Layout

| Path | What it does |
| --- | --- |
| `service/espn.js` | Endpoint URLs, `fetchJson` (10s timeout, one retry on network/5xx/429, JSON validation) |
| `service/normalize.js` | Pure normalizers for every feed, plus headshot helpers. Every field has a fallback |
| `service/store.js` | Cache + polling scheduler: per-resource freshness, in-flight dedupe, stale-on-error, backoff |
| `server.js` | Zero-dependency HTTP server: `/api/*` JSON + static UI. Keeps league feeds warm in the background |
| `ui/client.js` | Browser client. Uses the service when present; otherwise runs the same store in the browser against ESPN |
| `ui/avatar.js` | Headshot avatar with initials fallback (see below) |
| `ui/motion.js`, `ui/base.css` | Shared springs, bottom sheet, toast, design tokens |
| `index.html`, `live.html` | Trade builder and live hub |
| `data.js` | 2025–26 snapshot: fallback rosters, and trade-value ratings matched to live players by name |

## ESPN endpoints

| Resource | URL |
| --- | --- |
| Scoreboard | `site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard[?dates=YYYYMMDD]` |
| Game summary / box score / plays | `…/nba/summary?event={GAME_ID}` |
| Roster | `…/nba/teams/{TEAM_ID}/roster` |
| Injuries | `…/nba/injuries` |
| Standings | `site.api.espn.com/apis/v2/sports/basketball/nba/standings` (note: `/apis/v2`, not `/apis/site/v2`) |
| Transactions | `…/nba/transactions` |
| Teams (id ↔ abbreviation) | `…/nba/teams` |

Schema notes found while sampling the live feeds (Nov 2026):

- Scoreboard leaders carry `headshot` as a **string**; box scores, rosters and injuries use `headshot.href`.
- Injury entries have **no `athlete.id`**. The id is parsed from `headshot.href` or the player-card link.
- Rosters often omit `contract`; the current salary is in `contracts[]`, matched on `season.year`
  (2027 = the 2026–27 season). About half of a typical roster has no current-season row, so the UI
  falls back to the snapshot salary or shows "salary n/a".
- Standings stats are a list; they're looked up by `type`, since two entries share the name `differential`.
- ESPN uses `GS`, `NO`, `NY`, `SA`, `UTAH`, `WSH`. The API accepts those or `GSW`, `NOP`, `NYK`, `SAS`, `UTA`, `WAS`.

## Refresh policy

| Data | Fresh for |
| --- | --- |
| Scoreboard, a game is live | 20 s |
| Scoreboard, a game tips within 15 min (or is late starting) | 30 s |
| Scoreboard, next tip further out | until ~10 min before tip (max 15 min) |
| Scoreboard, nothing scheduled / all final | 15 min |
| Game summary | 20 s live · 2 min pregame · 60 min final |
| Injuries | 15 min |
| Standings, transactions | 30 min |
| Rosters | 60 min |

Intervals get ±10% jitter. On an ESPN failure the last good data keeps being served with
`meta.stale: true` and `meta.error`, and retries back off exponentially (capped at 5 min).
Clients poll the service at `meta.refreshInMs` and pause while the tab is hidden.

## API

All responses are `{ data, meta }`, where `meta` = `{ fetchedAt, stale, error, refreshInMs }`. A 502 is returned only if ESPN has never answered.

```
GET /api/scoreboard[?date=YYYYMMDD]
GET /api/games/{gameId}
GET /api/rosters/{teamIdOrAbbr}
GET /api/injuries[?team=ABBR]
GET /api/standings
GET /api/transactions
GET /api/teams
GET /api/health          # cache status per resource
```

## Headshots

Every normalized player has `id`, `headshot` (`https://a.espncdn.com/i/headshots/nba/players/full/{id}.png`),
`headshotSmall` (ESPN's resizer, about 8 KB instead of about 200 KB, used in lists) and `initials`.

`ui/avatar.js` renders the initials badge, in team color, underneath the photo. A capture-phase
`load` handler fades the photo in and hides the initials, since ESPN headshots are transparent cutouts.
A capture-phase `error` handler removes the `<img>` when the CDN returns 404, which happens for many
rookies, two-way players and new signings, so a broken-image icon never shows. Team logos use the same
fallback, with the abbreviation on the team color.

## Known limits

- Running without the service (static hosting) depends on ESPN allowing cross-origin browser requests.
  Most feeds send `Access-Control-Allow-Origin: *`, but `/teams` doesn't, and ESPN's CDN blocks some
  clients outright. The service is the reliable path.
- ESPN's feeds are undocumented and can change. The normalizers fall back field by field, and
  `npm test` includes malformed-payload cases.
- Salary matching is a simplified version of the CBA; see the note on the trade page.

## Mock Draft (`draft.html`)

Lottery simulator and mock draft for 2027–2029.

- **Lottery formats** (`LOTTERY_FORMATS` in `service/draft.js`, switchable in the UI):
  - **3-2-1 (default):** 16 teams (conference seeds 8–15), 37 balls. Seeds 1–3 get 2 balls and are marked
    "relegated", seeds 4–10 get 3, seeds 11–14 get 2, and seeds 15–16 get 1. Four drawings; the rest are
    ordered by balls, then worst record, so seeds 1–3 can fall to #12, #13 and #14.
  - **2019:** 14 teams, 1,000 combinations, four drawings.
- **Exact odds:** `lotteryTable()` enumerates every drawing sequence to give #1 %, top-4 % and floor for each seed.
- **Ties and restrictions:** tied records split their balls evenly, and their order is a coin flip. A team can be
  barred from #1 (the "Bar" toggle, per year), which removes its balls from the first drawing only.
- **Pick ownership:** `resolvePickOwnership(simulatedOrder, draftYear, config)` in `service/draft.js`
  applies `draft_picks_2027_2029.json` after every simulation and standings refresh. Rule types:
  `unprotected`, `protected` (`protectedRange`), `split_conveyance` (`routes`), and `swap_pool`
  (`assign` by `most_favorable` / `least_favorable` / numeric rank, conditional `overrides`, protected `exclude`).
  Rules marked `"verified": false` show "Terms unconfirmed" in the UI.
- **Prospects:** `prospects.json` holds 35 (2027), 30 (2028) and 30 (2029) players. College prospects are matched against
  ESPN's Division I rosters and carry `espnCollegeAthleteId` and
  `collegeTeamId`. `GET /api/college/{athleteId}?team={collegeTeamId}` returns live season averages,
  recent games and roster measurables, cached for 30 minutes. Headshots come from
  `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/{id}.png`, with the initials fallback.

## LiveWire ticker (`ui/ticker.js`, on `live.html`)

`mountLiveWire(el, { client, onSelect })` renders a market-tape rail that merges news, transactions,
injuries and the scoreboard (`service/wire.js` → `buildWire`, at most 25 items per source). It polls every
60 seconds. New items are inserted at the top while the row in view stays put, then the tape glides up with
a NEW flash; if you're hovering, a "N NEW" chip waits for you instead. The tape scrolls on
`requestAnimationFrame` and pauses on hover, focus, touch or a hidden tab. Reduced motion turns it into a
plain scroll list. Filters: ALL, MOVES, INJURIES, SCORES. Scores open the box score; trades and injuries
open a detail sheet; news links to ESPN.

## Awards (`awards.html`, `service/awards.js`)

`computeAwards({ players, prevPlayers, standings, prevStandings, starts, coaches })` is pure. New API routes:

| Route | Source | Cache |
| --- | --- | --- |
| `/api/players[?season=2026]` | ESPN `statistics/byathlete` (every player's season averages) | 30 min (24 h for past seasons) |
| `/api/standings?season=2026` | last season's standings (Coach of the Year baseline) | 24 h |
| `/api/starts` | games started, aggregated from regular-season box scores (finished games cached for good) | 6 h |
| `/api/coaches` | head coach from each team roster | 12 h |
| `/api/honors/{athleteId}` | career honors from the athlete overview | 24 h |
| `/api/news` | ESPN NBA news | 1 min |

- **Model:** AwardScore = production (Game Score–style) × (0.7 + 0.6 × team win %) × √availability.
  Projected games = GP ÷ team GP × 82. Under 65 earns a badge and keeps the player off the MVP, DPOY,
  Sixth Man, Most Improved and All-NBA ladders.
- **Inferred fields:** rookies are inferred (ESPN leaves `debutYear` blank for most players). ESPN doesn't
  publish All-Star selection counts, so ESPN career honors are shown instead.
- **Saved data:** My Ballot, My Picks and the exported card are stored in `localStorage`.
