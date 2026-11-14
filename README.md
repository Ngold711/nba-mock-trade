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

## App shell (`ui/shell.js`)

Every page calls `mountShell({ active })`, which provides:
- **Header:** brand, five-tab nav (Live, Trade, Draft, Awards, McConnell), the ● Live Sync pill and a 30 Teams switcher.
- **Mobile (under 768px):** a bottom tab bar with safe-area padding, and 16px inputs so iOS doesn't zoom.
- **LiveWire placement:** a fixed 300px right rail at 1100px and wider; below that, a slide-up drawer opened from the status pill.
- **Team Hub:** opened from the switcher or any `[data-team-hub]` badge. Shows record, seed, coach, the full roster with
  injury badges, and 2027–2029 pick inventory (`pickInventory()` in `service/draft.js`).
- **Player Quick-View:** opened from any `[data-player]`. Shows headshot, live season stats and *Open in Trade Machine*
  (`index.html#t=TEAM,_&a=TEAM:player>_`).

Each tool keeps its own `localStorage` keys (`draft:*`, `awards:*`, `mc:*`, the trade's URL hash); the shell never writes them.

## LiveWire behavior

The ticker scrolls with a CSS `@keyframes` animation (`translate3d(0,-50%,0)` over two copies of at most 25 items).
Duration is list height ÷ 45 seconds. Hover pauses it only under `(hover: hover) and (pointer: fine)`; the
⏸ Pause / ▶ Live button works everywhere, and the list scrolls by hand while paused. Polls never re-mount the running
list: new items wait behind "↑ N New Updates" and are applied on click or resume, while live scores update in place.

## McConnell (`mcconnell.html`, `service/mcconnell.js`)

Guess the mystery NBA player in 8 tries. All 30 rosters come from `/api/league`. Columns: Team, Conf, Div, Pos, Ht,
Age and #. Green means an exact match. Yellow means within 2 (with an arrow toward the answer) or a shared position.
Gray means no match.
- **Positions:** ESPN only reports G, F and C, so G-F and F-C come from the roster snapshot or from height.
- **Daily:** one mystery per calendar date, the same for everyone (a hash of the date over the pool sorted by ESPN id).
  Stats, streaks and the 1–8 distribution are stored locally.
- **Unlimited:** random mystery players, one after another.
- **Share:** copies the emoji grid.

## Brand: Hooptrax

- **Assets:** `public/logo.svg` (the mark), `public/favicon.svg` + `favicon-32.png`, `apple-touch-icon.png` (180),
  `icon-512.png`, and `og-image.png` (1200×630, used for OpenGraph and Twitter cards).
- **Theme:** one deliberate dark theme, with tokens at the top of `ui/base.css`: canvas `#0B0E14`, cards `#151B26`,
  borders `#232C3D`, amber `#F59E0B`, emerald `#10B981` and crimson `#EF4444`. Text is Plus Jakarta Sans; numbers
  use JetBrains Mono with tabular figures.
- **`HooptraxWatermark()`** (`ui/brand.js`) appears in the app footer, at the foot of every sheet and modal, on the
  exported ballot card, and as the last line of the McConnell share text.
- **Domain:** OpenGraph tags point at `https://hooptrax.com`. Link previews need that domain to serve this site.

## All-Star Voting (`awards.html`, `service/allstar.js`)

The Awards tab has two views: **All-Star Voting** and **Season Awards** (MVP, ROY, DPOY, All-NBA and the rest).

- **My Ballot / Live Model Projection**, with East and West tabs. Each conference has 5 starters on a court
  (2 backcourt + 3 frontcourt, the NBA ballot rule), 7 reserves and 3 honorable mentions.
- **One-tap voting:** "+" fills the next open matching starter slot, then a reserve slot, then an honorable mention.
  Tapping an empty slot targets it, filters the pool and focuses search. Tapping a filled slot offers
  Swap, Make captain, Remove and Player card.
- **The pool is never empty.** `buildPool()` merges sources by ESPN id: league-wide season stats, then all 30 live
  rosters, then the bundled `data.js` snapshot. ESPN's `leaders` endpoints currently return 500/404, so they aren't used.
  Conference comes from a fixed map, so a standings outage can't empty the list.
- **View & Share Ballot** draws a 1080×1700 PNG with the Hooptrax watermark. The ballot is saved in
  `localStorage` (`awards:ballot:v2`), and v1 ballots are migrated automatically.

## Platform upgrades (Nov 2026)

### Fast start
On startup the service fetches all 30 rosters at once (`Promise.allSettled`), plus standings, season stats and ratings,
and refreshes them in the background (league rosters and standings every 30 min). Each team's roster is primed into the
cache from the league-wide load, so `/api/rosters/:team` answers from memory. Pages show shimmer skeletons until data lands.

### Trade Machine (`index.html`, `service/trade.js`, `salaries_2026_27.json`)
- **Salaries:** live ESPN 2026–27 contract → the bundled ESPN contract snapshot (`salaries_2026_27.json`, by athlete id) →
  an estimate from experience and production (veteran minimum, rookie scale, rotation, starter). Estimates show an `est.` tag;
  no active player is ever $0.
- **`validateTrade()`** runs on every change: cap room absorption, over-cap matching (200% + $250K / outgoing + flat / 125% + $250K),
  a 100% limit at or over the 1st Apron after the trade, the 2nd-Apron aggregation ban, the Stepien Rule on 2027–2029 firsts
  (protected picks owed away count as gone; picks a team doesn't control can't be traded), and roster-size warnings.
  Cap thresholds are projections; edit `cba` in the JSON if official numbers differ.
- **Strict CBA Rules / Sandbox Mode:** sandbox keeps the math but unlocks links and image cards, marked "⚡ Sandbox".
- **Auto-save** to `localStorage` (`trade:workspace:v1`). **Copy Trade Link** encodes teams, ESPN player ids and picks as
  `?trade=<base64url>`; opening it on any page loads the Trade tab.
- **Share Image Card:** a 1080px-wide (2x) receipt drawn on a canvas. Images load with `crossOrigin="anonymous"`, falling back to
  `GET /api/proxy-image?url=` (ESPN image CDN only). Download, Copy Image, or the native share sheet.

### Mock Draft
Boards hold 75 (2027) and 65 (2028, 2029) prospects. Ranks past each hand-built board are a statistical board of real
Division I players from ESPN rosters, ordered by early-season production, class and size (`"board": "statistical"`).
Round 1 or Full Draft (60 picks; round 2 in record order, owners unchanged). The picker filters by position (PG/SG/SF/PF/C,
combos match both), origin (NCAA / International / High School), sorts by rank, height or PPG, and flags **Team Need** from the
drafting team's live roster.

### Awards tabs
All-Star · Season Races · **Weekly & Polls** · **2K27 Ratings**.
- Weekly: Players of the Week (seeded weeks 1–3, later winners detected from ESPN news headlines), honors schedule, MVP and
  Rookie ladders, and Hooptrax Live Polls (`GET/POST /api/polls`; one vote per poll per browser and IP; stored in `data/polls.json`,
  which resets on a fresh deploy).
- 2K27 Ratings (`/api/2k-ratings`, `service/ratings.js`, cached 6 h): players named in the Nov 2026 update keep that OVR and delta;
  everyone else is rated from live ESPN stats (percentile curve, capped at 93). Attributes, badges and 30 team ratings are computed.
  These are Hooptrax estimates, not official 2K data.

### Shell
- **Light / dark** toggle (Sun/Moon) next to 30 Teams, saved as `htx:theme`, applied before first paint. The logo's lower seams and
  the "Hoop" wordmark switch to deep slate in light mode.
- **Team Vault** (30 Teams or any team badge): record, seed, 3-2-1 lottery badge, payroll meter against cap/tax/aprons, roster with
  salaries and OVR, 2027–2029 picks, schedule and results (`/api/schedule/:team`).
- **Player Quick-View** shows 2K27 OVR and salary; **Compare** lines up stats, ratings and contract/profile with winners in green and
  exports a PNG card.
- The LiveWire ticker appears on Live only; other pages show a live dot on the Live tab.

### Live Game Center
Tap any game: linescore (Q1–Q4, OT), Box Score (away/home), Team Stats, and Play-by-Play, polling every 15 s while live.

### Home Screen app
`public/manifest.json` (standalone, icons 192/512/maskable), `apple-mobile-web-app-capable`, `black-translucent` status bar, and
light/dark `theme-color` tags. On iPhone: Share → Add to Home Screen.
