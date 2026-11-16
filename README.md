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
  - **3-2-1 (default, approved May 2026 for the 2027–2029 drafts):** 16 teams, 37 balls. Seeds 1–3 get 2 balls and are
    "draft relegated", seeds 4–10 get 3, seeds 11–14 get 2, and seeds 15–16 get 1. All 16 picks are drawn. The relegated
    teams can't fall past #12: once the picks left before #12 only cover the relegated teams still undrawn, the draw is
    limited to them. Everyone else can fall to #16. Exact odds come from a dynamic program over the 2^16 drawn-team sets
    (bottom three: 5.4% #1, 16.5% top-3, 28.0% top-5, 60.5% top-10).
  - **2019:** 14 teams, 1,000 combinations, four drawings.
- **Exact odds:** `lotteryTable()` gives #1 %, top-4 % and floor for each seed (sequence enumeration for 2019, DP for 3-2-1).
- **Sim UX:** Sim Lottery switches the lottery card to **Simulated Order**: picks 1–16 with logos, ↑/↓ badges and swap or
  protection pills, scrolled into view. **Pre-Lottery Odds** is one tap away. Once you scroll down into the board, a floating
  **🎲 Sim Again (count) · Reset** pill sits above the tab bar.
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

## Trading floor + Tankathon + Basketball Reference (Nov 2026, round 3)

- **LED ticker board** (`ui/ledboard.js`, top of Live): three horizontal tapes in a black bezel: scores (`BOS 118 ▲ +4  LAL 114`),
  player market (tonight's leaders vs. season average, then 2K27 movers), and an injury/move wire. Each row runs one Web Animations
  transform (55 / 65 / 50 px/s) and keeps its position across data updates. A single ⏸ / ▶ button pauses all rows; nothing pauses on
  hover. Reduced motion shows static, swipeable rows. Game quotes open the Game Center, and player and injury quotes open Quick-View.
  The vertical LiveWire rail is retired.
- **Advanced stats** (`service/advanced.js`): TS%, eFG%, AST/TO, Hollinger Game Score (total rebounds weighted 0.4 because ESPN's
  league feed has no OREB/DREB split), and per-36, per-40 and totals scaling. **Per Game | Per 36 | Totals** toggles appear in Quick-View,
  Compare and the Team Vault roster; the choice is saved as `htx:statMode`.
- **Stat Leaders** (Live, below the games): top 25 in PPG, RPG, APG, SPG, BPG, 3PM, TS% and Game Score, filtered by All / East / West
  and by mode. To qualify, a player needs half the league-high games played, plus 15 MIN for Per 36 and 6 FGA for TS%.
- **Bio and draft pedigree** (`/api/bio/:id`): draft year, round, pick and overall number, college or country, age, height and
  weight, and experience at the top of Quick-View.
- **Team efficiency** (`/api/team-stats`, 60 min): possessions = FGA − OREB + TOV + 0.44·FTA; ORtg, DRtg, Net and Pace with league
  ranks, shown in the Team Vault header and in Game Center.
- **Draft:** Rem SOS (`/api/sos`: remaining opponents' win %, color-coded easiest to hardest), L10 and streak in the lottery table.
  Also a sim count badge, ↑/↓ rank-change pills, Reset, Mock Draft This Order, and **Sim 1,000x**: a Monte Carlo matrix with
  #1 %, Top 4 %, Top 10 %, Most Likely and average pick for all 16 lottery teams.
- **Pick Grid:** the 30-team 2027–2029 first-round matrix with Own / Traded (Unprotected) / Protected / Swap Pool pills, plus picks
  held from other teams.
- **Prospect stats:** Per Game | Per 40 | Efficiency (TS%, eFG%, AST/TO) in the picker (Nov 14 snapshot) and the scouting drawer
  (live ESPN college stats, now including FGA/FTA/3PA from the athlete stats endpoint).

## History hub + Ask Hooptrax (round 4)

### `nba_history.json`
Built by an offline generator that cross-checks editorial data against ESPN:
- **ESPN-verified:** career leaders (top 25 in points, rebounds, assists, steals, blocks and 3PM, from ESPN career totals; live for
  active players), single-season leaders since 1975–76, every player award and Finals MVP (checked against each player's ESPN award
  record; about 97% confirmed, `verified: false` on the rest), #1 picks and draft steals (ESPN draft records), and the 2026 Finals,
  awards and #1 pick (read from ESPN).
- **Editorial (no reachable feed):** Coach of the Year, retired numbers and years, franchise top-5 leaders (names only), official
  pre-1974 rebound totals, career figures for about 20 legends whose ESPN profiles have no stats (marked `editorial`), and lottery notes.

### UI
- **Team Vault → History & #s:** championship banner wall (year, opponent, series, Finals MVP), Finals losses, a retired-jersey
  gallery in team colors with HOF badges, and franchise top-5 leaders.
- **Awards → History:** all-time leaders (career or single season), a searchable and filterable Awards & Champions timeline
  (1947–2026), and draft history (2026 lottery picks, #1 picks since 1985, notable steals).
- **Compare** searches active players, the legends index, and ESPN's athlete search (`/api/search`). Legends compare on ESPN career
  averages (`/api/career/:id`).

### Ask Hooptrax (`/api/nba-chat`, `service/chat.js`, `ui/chat.js`)
- An "✦ Ask AI" pill in the header opens a slide-over chat with dynamic starter prompts, a 16px input, and player and team chips that
  open Quick-View or the Team Vault.
- **Gemini (free tier):** set `GEMINI_API_KEY` (locally in `.env`, which is git-ignored; on Render under Environment). Models are tried
  in order from `GEMINI_MODELS` (default `gemini-flash-latest, gemini-2.5-flash, gemini-3-flash-preview, gemini-3.5-flash`) with
  20 s timeouts. Each question gets a targeted DATA block: today's games, standings, the 3-2-1 projection, injuries, moves,
  2K27 ratings, and the players, teams and years mentioned (stats, salary, injuries, awards, titles, retired numbers).
  The system prompt restricts answers to the NBA and to the provided data.
- **Zero-key local engine:** with no key, after errors, or over the limit (15 AI calls per hour per IP), answers come straight from the
  live cache and `nba_history.json`: scores, standings, injuries, lottery, prospects, 2K27, salary and cap, retired numbers,
  champions, award winners and career leaders. Off-topic questions are declined.

## NBA 2K-style redesign (round 5)

**Draft (`draft.html`)**
- The header is decluttered to three controls: the year switcher (2027 | 2028 | 2029), **🎲 Start Draft Lottery**, and **⚙ Settings**.
- The Settings sheet holds:
  - Sim 1,000x Odds Matrix
  - Instant lottery
  - Round 1 / 2-Round
  - 3-2-1 / Classic 2019 format
  - Animations on/off
  - Mock draft actions: take board, auto-fill, projected order, clear picks
- **Lottery reveal stage:** an envelope countdown from pick 16 to pick 1, with a 3D card flip for each pick. Each card shows the logo, the jump or drop delta, and any trade or swap badge.
  - Teams that jump into the top 4 get a gold glow and a **LOTTERY JUMP!** tag.
  - Use **Skip to Results ⏭** to jump ahead, and **Proceed to Mock Draft →** at the end.
- **ON THE CLOCK banner:** shows the drafting team's color gradient, its logo, the pick number, and its top-2 positional needs.
  - Three actions: **Pick Player**, **Sim Pick**, and **Sim Rest of Draft**. The CPU takes a need fit from the top 3 available, otherwise the best available.
- **THE PICK IS IN card:** shows headshot, position, school or country, height/weight, and NBA comp. Turn animations off in Settings to sim instantly.

**Trade Machine (`index.html`), "War Room"**
- Each team card has a team-color header accent.
- Player tiles show headshot, 2K27 OVR badge, and salary.
- Pick cards are gold for 1sts and silver for 2nds, labeled with protection (for example "2027 1st • Unprotected / Protected top-4 / Swap pool · via XXX").
- Each team has a Salary & Apron meter showing the cap, tax, 1st apron, and 2nd apron.
- **PROPOSE TRADE** opens a GM verdict stamp:
  - **✓ TRADE APPROVED**, or **✕ TRADE REJECTED** with a front-office reason taken from the actual CBA failure.
  - A Sandbox Override switch and a Share Trade Card button.

## Hooptrax AI assistant (round 6)

**Opening it**
- The header button is gone. A floating 48px **Hooptrax AI** orb (dark/amber glass, sparkle-basketball icon) sits bottom-right, above the mobile tab bar and the safe area.
- On pages with a bottom dock (Trade Machine) or the draft's Sim Again bar, the orb lifts above them.
- It opens an 88vh sheet with **🕒 History**, **＋ New Chat** and **✕**. The input is 16px so iOS doesn't zoom.

**Answers**
- Answers stream in token by token.
- Replies can include tappable **stat cards**:
  - Player: headshot, team logo, PPG/RPG/APG, 2K27 OVR.
  - Game: logos, score or tip time in ET, live dot.
- Player and team names are linked chips.

**Conversations**
- Saved in `localStorage["hooptrax_ai_threads"]` as `{ id, title, updatedAt, messages[] }`. The title comes from the first question. The cap is 50 threads and 80 messages each.
- A new browser/app session, or coming back after 10+ minutes away, opens a fresh blank chat with 4 starter prompts. Moving between Hooptrax pages in the same session keeps the open chat.
- The History drawer lists threads newest first, with relative time and message count. Tap a thread to continue it.
- 🗑 deletes one thread. **Clear All History** needs a second tap to confirm.

**Server (`/api/nba-chat`, `{ message, history, stream: true }` → NDJSON `meta` / `delta` / `done`)**
- **Schedule cache:** yesterday, today and the next 14 days (16 dates, `America/New_York`) are fetched from ESPN's scoreboard in parallel at startup, then every 15 minutes.
- **Question slicing:** `service/chat.js` reads players, teams, years, dates ("tomorrow", "friday", "Nov 20", "this week") and intent (schedule, scores, injuries, standings, trade/cap, draft, 2k, history). Only the matching slice of data goes to the model.
- **Gemini:** uses `streamGenerateContent`. The first token must arrive within **6 s** or the reply comes from the local engine (under 100 ms). A model that returns 404/429 or times out is skipped for a cooldown.
  - Default model order: `gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-flash-latest`, overridable with `GEMINI_MODELS`.
  - `gemini-2.5-flash` returns 404 for new API keys.
  - In testing, the free-tier flash models often returned 429 or stalled, while flash-lite started answering in about 0.5 s.
- **Scope:** Gemini uses its own NBA knowledge for history (1946–2026), the live data for 2026–27, and declines non-NBA questions.
- **Limits:** 15 AI answers per IP per hour, after which the local engine answers.

## Round 7: Live home, tap-outside dismiss, fresh AI chats, trending trades, controlled-team drafts

1. **Live is the home tab.**
   - `/` (and the home-screen icon, `/?source=homescreen`) returns a 302 to `/live.html`.
   - Trade Machine links keep working: `/?trade=…`, `/index.html` and the share links all open the Trade page.
   - Hash links that land on Live are forwarded: `#t=…` (old trade links), `#trade`, `#draft`, `#awards`, `#mcconnell`.
2. **Tap outside to dismiss.** `dismissOnBackdrop()` in `ui/motion.js` is used on every backdrop: the shared bottom sheet (Team Vault, Quick-View, Compare, Game Center, Prospect Picker, Select Teams), the AI chat, the LiveWire drawer, draft Settings, THE PICK IS IN card and the trade verdict.
   - It closes on `pointerdown` (iOS Safari doesn't send `click` to plain divs), with `click` as the keyboard fallback.
   - Only taps on the backdrop itself count, so taps inside a sheet never close it.
   - It cancels the follow-up tap on touch, so closing never "taps through" to the page underneath.
   - The sheets sit beside their backdrop, not inside it, so they need no `stopPropagation` (which would also break app-wide link handling).
3. **Fresh AI chat on every close.** Closing with ✕, a backdrop tap or a swipe down on the top bar saves the conversation to History, and the next tap on the orb opens a blank chat. An answer still streaming when the sheet closes finishes in the background and is saved to its own thread.
4. **🔥 MOST TRADED & RUMORED** (`GET /api/trending-trades`, `POST /api/trade-adds`, `service/trending.js`)
   - **Live mentions (refreshed every 30 min):**
     - The server reads HoopsHype's RSS feed (`HOOPSHYPE_FEEDS`, default `/rumors/feed/`, then `/feed/`) and ESPN's NBA news feed.
     - It counts each active player's full name in recent items (21 days) that contain trade words. A mention in a headline counts double.
   - **User trade counter:** every player a Hooptrax user adds to a mock trade, counted once per visitor per 6 hours over a rolling 7 days, saved to `data/trade-adds.json`.
   - **Baseline:** a small weight for current rumor regulars (Murray, Green, Sabonis, Powell, Herro, Reid, Porter Jr., Randle, Davis, Williamson) so the strip is never empty. General ESPN headline mentions are a weak tiebreaker.
   - **Accuracy:** team, logo, headshot and salary always come from the cached 2026–27 ESPN rosters and the salary book.
   - **Strip:** a single row at the top of the Trade page. Tapping a card loads that player's team as Team A and puts him on the outgoing trade block.
5. **Mock drafts start at Pick #1 and you choose which teams to control.**
   - "Proceed to Mock Draft" (and "Clear picks") empties the board. Picks from an earlier mock no longer carry over and look like auto-simmed picks.
   - The **Select Teams to Control** sheet then opens with three presets (All 30 Teams, Lottery Teams Only, Clear Selection) and a 30-team grid that shows how many picks each team owns. The button reads **Start Draft (X Teams Controlled) →**.
   - The On the Clock banner shows **YOUR PICK** or **CPU**. On a CPU pick, **Sim to Next User Pick** runs CPU picks until one of your teams is up. **Teams (X)** lets you change your teams mid-draft.

## Round 8: accounts, private saves, Community Feed; retired-number audit

### Accounts and guest mode
- **Welcome gate:** on a visitor's first page in a session, a dismissible card offers **Create Free Account / Log In** or **Continue as Guest**.
- **Account pill:** the header pill shows `@username` and the favorite-team logo. Tapping it opens the profile.
- **Sign up:** email, `@username` (3–20 letters, numbers or `_`) and a password of at least 8 characters.
  - Passwords are hashed with **bcrypt** (`bcryptjs`, cost 11).
  - Sessions are an **HS256 JWT** in an `HttpOnly; SameSite=Lax` cookie (`Secure` on HTTPS), valid for 30 days.
  - Writes must be same-origin JSON (CSRF), and logins are rate limited.
- **Guests** get every tool, but their trade workspace, mock drafts and ballots are cleared at the start of each new visit (a new browser session). If a guest taps Save or Post, they're asked to create an account, and the save goes through as soon as they sign up, with their work intact.

### Saving and posting
- **🔒 Save Privately** and **🌎 Save & Post** (with an optional headline) appear in the Trade Machine verdict, the Mock Draft's "Draft complete" banner and ⚙ Settings.
- **Trade saves** keep the exact trade: teams, players, 2027–29 picks, the CBA verdict and its share-link code.
- **Draft saves** keep the year, format, lottery order and every drafted prospect.

### Profile
- Tabs: **Public Posts** and **🔒 Private Vault**.
- From any item you can view the full breakdown, switch Private ↔ Public, delete it (tap twice), or **Load into Sandbox** (`index.html?trade=…` / `draft.html?item=…`).
- You can also change your favorite team and log out here.

### Community Feed
- **Live → Feed** (`live.html#feed`), filtered by All, Trades, Mock Drafts or Top Upvoted.
- ▲ upvotes (one per account, toggles) and **Open in Trade Machine / Mock Draft** to remix a post.

### Storage
- `service/accounts-store.js` has one interface and two adapters:
  - **PostgreSQL** when `DATABASE_URL` is set. The schema is created on boot, with tables `users` and `saved_items` as specified, so accounts survive restarts and deploys. Works with free Supabase or Neon databases.
  - **JSON file** `data/hooptrax_users.json` otherwise (local development; written atomically).
- **Render:** set `DATABASE_URL` and `JWT_SECRET` (any long random string) in Environment. Without `DATABASE_URL`, accounts are lost on every deploy. Without `JWT_SECRET`, everyone is logged out on every deploy.
- **API:** `POST /api/auth/{signup,login,logout}`, `GET /api/auth/me`, `GET|POST /api/me`, `GET /api/me/items/{public|private}`, `POST /api/items`, `GET /api/items/:id`, `POST /api/items/:id/{update,delete,like}`, `GET /api/feed?type=&sort=new|top&offset=`.

### Retired numbers and Ask Hooptrax grounding
- **Audit:** `nba_history.json` retired numbers for all 30 teams were checked against team and NBA announcements in November 2026.
  - Added: **Derrick Rose #1** (CHI, Jan 24 2026), **Dell Curry #30** (CHA, Mar 19 2026) and **Michael Cooper #21** (LAL, Jan 2025).
  - Retirement dates were added for recent ceremonies: Carter (TOR/BKN), Shaq (ORL), Iguodala, Tony Allen and Pau Gasol.
  - Announced ceremonies that haven't happened yet are stored in `upcomingRetirements`: Lowry #7 (TOR, Jan 10 2027), Westbrook #0 (OKC, Feb 7 2027), Bogues #1 (CHA, Feb 11 2027) and Garnett #21 (MIN, Feb 28 2027).
- **One source:** the Team Vault's "History & Retired #s" tab and Ask Hooptrax read the same `nba_history.json`.
- **Ask Hooptrax:**
  - Retired-number questions get exact rows for one team, every team that retired a player's number, or all 30 teams as compact rows.
  - Champion and MVP questions get the full lists.
  - The system prompt makes that data ground truth over the model's training. League-wide answers aren't truncated (`maxOutputTokens` 4096).
- **Live check:** for jersey, Hall of Fame or honors questions that name a player or team, `liveVerify()` scans recent ESPN NBA news (the league feed plus that team's feed, 1.5 s budget) and adds matching headlines as `LIVE ESPN NEWS`.

## Round 9: privacy and data isolation

**Legacy purge**
- On every page, the first script deletes pre-account history from `localStorage` and `sessionStorage`: the old global AI chat list `hooptrax_ai_threads`, plus `hooptrax_ai_active`, `chat:v1` and the un-scoped `trade:workspace:v1`, `draft:v2:<year>`, `draft:simcount:<year>`, `awards:ballot(:v2)` and `awards:picks` keys.
- Those keys are never written any more, so nothing comes back.
- On the server, both storage adapters delete saved items and AI threads that have no owner (`userId` null or unknown) at start-up (`purgeOrphans()`).

**Guest mode keeps nothing**
- Personal work goes through `ui/scoped.js`. For guests it lives only in an in-memory Map, never in `localStorage`, and a refresh, a new tab or "Continue as Guest" wipes it.
- Guest AI chats live only in the chat module's memory.

**Members**
- Trade workspace, mock drafts and ballots are stored under `<key>::u:<userId>`, so two accounts on one device never share them.
- AI chat history is stored server-side in `ai_threads`, per user, newest 50 kept, behind `GET|POST /api/ai-threads`, `POST /api/ai-threads/:id/delete` and `POST /api/ai-threads/clear`.
- `/api/ai-threads`, `/api/saved-items` and `/api/profile` all require a session (401 otherwise), and every query filters by the session user's id.
- A thread id that belongs to someone else is never overwritten (409).

**Switching identity**
- **Log out:** ends the session, deletes that user's cached keys from the device, wipes memory and reloads clean.
- **Signing in:** loads that account's own data. A guest's in-progress trade, draft or ballot moves into the new account; the guest chat is dropped.
- **"Continue as Guest":** wipes guest memory and chats.
- **Mismatched session:** if the page's stored user id disagrees with the server (expired session, logout in another tab, a forged hint), the page fixes the hint and reloads once.

## Round 10: Player Encyclopedia

**Search**
- **🔍** in the header (every page) opens Player Search in the shared sheet. The input is 16px so iOS doesn't zoom.
- `GET /api/players/search?q=` matches as you type against:
  - every active 2026–27 player (cached league rosters);
  - every legend in `nba_history.json`;
  - ESPN's athlete search, only when local matches are thin, waiting at most 1.5 s.
- Ranking: exact name, then name prefix, then last-name prefix, with a fame boost (current PPG for active players, career points and MVPs for legends). "jordan" → Michael Jordan, "kobe" → Kobe Bryant.
- Featured pills when empty: Wembanyama, Dončić, LeBron, Jordan, Kobe, Rose, Curry.

**Profile**
- `GET /api/players/:id/full` and `service/player.js` assemble it.
- **Bio:** ESPN headshot (initials fallback), team logo or Retired / 🏛 Hall of Fame badge, jersey, position, height/weight, age and birthdate, college or country, draft (`Year • Rd • Pick #`), years pro. Active players add 2026–27 salary and the 2K27 OVR badge.
- **Trophy shelf:**
  - Championships: a season counts when the team the player finished it with won the title.
  - Finals MVP, MVP, DPOY, ROY, 6MOY and MIP come from `nba_history.json`.
  - All-NBA, All-Defensive and All-Star Game MVP come from ESPN honors.
  - Retired jerseys come from `nba_history.json`.
  - All-Star *selections* aren't in any free feed, so they aren't shown.
- **Career Stats:**
  - Every regular season from ESPN `/athletes/:id/stats`, with sticky Season and Team columns and `TOT` rows for traded seasons.
  - Career Averages and Career Totals rows.
  - **Per Game / Per 36 Min / Totals / Advanced** (TS%, eFG%, AST/TO, Hollinger Game Score).
- **Game Log (active players):** the last 15 games of 2026–27 from ESPN `/gamelog`, refreshed every 2 minutes while open. ESPN's game log has no +/-, so that column isn't shown.
- **Actions:** ⚖️ Compare Player (the existing Compare tool) and ⇄ Load in Trade Machine (active players). Player Quick-View gained a **📖 Full Profile** button.
- **Header on phones:** the signed-in account pill shrinks to the team-logo circle under 768px, and the "30 Teams" label hides under 480px, so the header fits from 320 to 1280px with the new button.

## Round 11: calmer, iOS-style architecture

- **Four tabs:** Live · GM Lab · Reference · Arcade. The header holds only the logo, 30 Teams, Account and Theme. The search button and status dot are gone, and a screen-reader status region replaces the dot. Tool pages show a `‹ GM Lab` / `‹ Arcade` back link where the logo would be.
- **Ask Hooptrax pill:** a labeled floating `✦ Ask Hooptrax` pill sits above the tab bar. On phones the body padding leaves room for it so it doesn't cover the last content.
- **Live:** the LED ticker and pills stay. Under Games is a League Leaders Snapshot (top 5 for PPG, RPG, APG, 3PM and TS%). **View Full Leaderboard →** opens the full 25-row explorer in a sheet.
- **Hubs:**
  - `gmlab.html`: launcher cards for the Trade Machine, 3-2-1 Lottery & Mock Draft, and All-Star Ballot / Awards / 2K27, each with live chips.
  - `reference.html`:
    - Encyclopedia search with filters: All, Players, Coaches, GMs / Execs, Owners.
    - Browse sheets: All-Time Leaders, Champions & Awards, Retired Jerseys, and the current 30 front offices.
  - `arcade.html`: a featured McConnell card with a streak pill, plus Coming Soon cards.
- **People data (`nba_people.json`):** coaches, presidents/GMs and owners. Current 30-team front offices and notable all-time figures carry `verified:true` plus a source only when the fact was checked against a 2026 report. Anything else is `verified:false` and is shown with a "?" marker. Head coaches always come live from ESPN.
- **API:**
  - `GET /api/people/:id`: profile with player, coach, exec and owner sections.
  - `GET /api/front-offices`: the 30 teams' coach, president, GM and owner.
  - `/api/players/search?role=coach|exec|owner`: returns people only. Without a role, players and people are merged.
- **Multi-role profiles:** a role switcher (Player Career | Coaching Career | Front Office / GM | Ownership) covers MJ, Bird, Riley, West, Kerr, Ainge, Rivers, Redick, Russell and Phil Jackson.
- **30 Teams Vault:** each team shows its Head Coach, Basketball Ops lead and Owner. Linked names open profiles.
- **ⓘ popovers:** on screens ≤900px they become a fixed bottom sheet with 16px gutters and close when you tap outside or press Escape.

## Round 12: Archive (search-first), complete people search, mystery Arcade cards

- **Archive tab** (`archive.html`; `reference.html` now redirects here, keeping `?role=` and `?q=`).
  - The bar reads Live · GM Lab · **Archive** · Arcade, with an archive-box icon.
  - A Spotlight-style search is the hero: 16px input, ✕ clear button, focused automatically on desktop, `/` focuses it, Escape clears it.
  - Role pills: All · Players · Coaches · Front Office · Owners.
  - The emoji browse cards are gone. Three text pills (All-Time Leaders, Champions & Awards, Retired Jerseys) open the same sheets as before.
- **Directory under the search** (when the search is empty):
  - All or Players: *Trending & Legends* from `GET /api/archive/featured`, i.e. this season's top scorers plus all-time legends, with headshots, team badges and per-game stats.
  - Coaches, Front Office or Owners: the full 30-team directory, with team logo, name, title, live team record or "since" year, and a `?` on unconfirmed names. Every row opens a profile.
- **Search coverage** (`/api/players/search`):
  - ESPN's NBA athlete search (`type=player&sport=basketball&league=nba&limit=25`) always runs in parallel with the local roster and legends caches. Results are merged, deduplicated and ranked.
  - With few local matches, a cold ESPN lookup gets up to 4.5s. A timed-out answer is sent `no-store`, so it's never cached.
  - `service/people.js` `directory()` builds a profile for every current head coach (live from ESPN rosters), every president/GM and every owner group in `nba_people.json`. All 30 teams × 3 roles are searchable and linked.
  - `nba_people.json` now holds 108 editorial people, including 75+ notable all-time coaches, executives and owners. Career W–L is given only for finished careers.
- **Wikipedia fallback** (`service/wiki.js`): when a coach, executive or owner isn't in the archive, the server asks Wikipedia's REST search and summary API. If that comes back empty (for example, rate-limited), the browser asks Wikipedia directly; it allows cross-origin requests.
  - Results show as bio cards: description, summary, the NBA teams the summary names, the span of years and the championship lines. Everything is labelled "From Wikipedia" and links to the article.
  - List, season and surname pages are dropped. Set `HOOPTRAX_WIKI=0` to turn off the server-side lookup.
- **Arcade:** the four placeholder games are replaced by frosted mystery cards: blurred silhouette bars (`filter: blur(4px)`), a centered `?` and a COMING SOON pill.
- **Ask Hooptrax clearance:** every main view gets `pb-28`-style bottom padding (7rem, plus the tab bar on phones), so the floating pill never covers the last card or button.

## Round 13: verified front offices, clean Archive profiles

- **Front offices:** all 30 teams' basketball-operations leads and owners were re-checked against current reporting on Nov 15 2026. Every entry in `nba_people.json` `teams` now has `verified:true`, a `source`, a `checked` date and, where known, a tenure start (`since`).
- **Corrections:**
  - Utah: Austin Ainge is president of basketball operations, with Justin Zanik as GM and Danny Ainge as CEO.
  - Denver: Josh Kroenke is president, with Ben Tenzer and Jon Wallace as EVPs. Denver has no GM title.
  - Detroit: Michael Blackstone is EVP.
  - Dallas: the Dumont family became controlling owners in November 2026.
  - Toronto: Bobby Webster is now EVP & GM.
  - Miami: Andy Elisburg is GM.
  - Orlando: Anthony Parker is GM.
  - New Orleans: Troy Weaver is SVP.
  - Charlotte: Jeff Peterson's title is now EVP & GM.
- **Head coaches:** still live from ESPN rosters. `coachSince` gives each current coach's start year, and it applies only while ESPN names that coach.
- **Profiles:** each one shows the person's current team, title and start year under their name, then a *Career highlights* card (titles, awards, signature moves, recent notes), then the role tabs. The source is shown at the bottom.
- **UI:** the `?` badges are gone from the Archive rows, search results, profiles and the 30 Teams Vault.

## Round 14: Spotlight-style Archive, legend data polish

- **Archive empty state:** with `All` or `Players` selected and an empty search, the page shows only the search field ("Search any player, coach, GM, or owner...", 16px), the role pills, the browse links and one chip row, then open space.
  - The chip row is **Recent Searches** (the last 8 profiles opened from search) with a `Clear` link. With no history yet, it shows four quick-try pills.
  - Recent searches are stored per account via `ui/scoped.js` (`archive:recent`). Guests keep them in memory for the visit only, in line with the round 9 guest-privacy rule.
  - The live scoring-leader and legends lists are gone, along with `/api/archive/featured`.
  - Typing searches players, coaches, GMs and owners immediately. `Coaches`, `Front Office` and `Owners` still open their 30-team directories.
- **Legend data:**
  - All 22 legends whose ESPN season logs didn't load now have career years, e.g. Larry Bird 1979–1992. This is a fallback table in the generator, also applied to `nba_history.json`.
  - Bird's draft line (1978, Rd 1, Pk 6, BOS) was added.
  - Profile career cards always show PPG/RPG/APG to one decimal.
- **Draft line:** a missing ESPN draft record is no longer shown as "Undrafted". A player who debuted before 1985 with no record anywhere simply has no Draft row.

## Round 15: complete draft pedigree for legends

- `nba_history.json` legends that ESPN's bio has no draft record for now carry `draftInfo` `{ year, round, pick, team, type }`. This covers 66 legends.
  - `type` is `nba`, `baa`, `territorial`, `aba` or `undrafted`; `team` is the drafting franchise's code at the time (PHW, MNL, CIN, STL, BUF, SDC, KCK…).
  - Picks were checked against Basketball-Reference and Wikipedia draft pages. Bill Bridges is the one legend left without data, because his 1961 pick couldn't be confirmed.
  - The generator applies the same table (`fillDrafts`).
- Profile headers (`draftLine` in `ui/encyclopedia.js`):
  - Regular pick: `1984 • Rd 1 • Pick #3 (CHI)`
  - Territorial: `1959 • Territorial Pick • PHW`
  - ABA: `1974 • ABA Draft • Rd 3 • Utah Stars`
  - BAA: `1948 BAA • Rd 1 • Pick #4 (NYK)`
  - Otherwise `Undrafted`, never `Rd null` / `Pick #undefined`.
- ESPN draft lines get the drafting franchise of that year (`draftTeamAt` in `service/player.js`): Kobe 1996 → CHH, Chris Paul 2005 → NOH, 1993 Washington → WSB.

## Round 16: GM Lab bento grid, centered Archive hero, footer clearance

- **GM Lab** (`gmlab.html`) is a three-card bento grid (no emoji tiles):
  - A dark obsidian hero card (*NBA Trade Machine*) spans both columns. It shows the most-rumored trade player's ESPN headshot over faint logos of the most-rumored teams, from `/api/trending-trades`.
  - *3-2-1 Lottery & Mock Draft* shows a #1 lottery ball and the live **#1 seed** (worst record) with its chance at the first pick under the 3-2-1 format. The format flattens the bottom three, so the label is "#1 Seed", not "#1 Odds".
  - *All-Star, Awards & 2K27* shows a diamond OVR badge and the live 2K27 #1 player from `/api/2k-ratings`.
  - Each card opens its tool, which shows a `‹ GM Lab` back link at top-left.
- **Archive:** with an empty search on All or Players, the hero is centered in the space between header and tab bar (at least 66vh).
  - It holds a 30px "Archive" title, the subtitle "Every player, coach, GM & owner since 1946", the rounded search bar, a single row of role pills, a 2×2 grid of quick tiles (recent searches once you have some) and one line of amber text links.
  - Typing, or picking Coaches / Front Office / Owners, docks the search to the top with a 380ms transition (none with reduced motion).
- **Footer:** `.app-footer` keeps `pb-24` (6rem, plus the tab bar and any Ask-pill lift) under its badge and disclaimer, so the floating ✦ Ask Hooptrax pill never covers them. That includes the Trade Machine, where the pill sits higher above the trade tray.

## Round 17: titles, unified Players directory, 2K27 ratings feed, grounded Ask Hooptrax, McConnell copy

- **Titles:** "3-2-1 Draft Lottery and Mock Draft" (GM Lab card, draft page title) and "All-Star Voting, NBA Awards, and 2K27 Ratings" (GM Lab card, awards page title and header).
- **Archive → Players:** opens straight into one unified A–Z directory (by last name) of every active player (live ESPN rosters) and every legend in the archive. That's 774 players today.
  - `GET /api/players/directory?filter=all|active|hof|top75|G|F|C&letter=K&offset=&limit=` is paged and returns a letter index.
  - The page shows filter pills (All, Active, Hall of Fame, Top 75, G, F, C), an A–Z jump bar and infinite scroll.
  - Hall of Fame means inducted as a player; Top 75 is the NBA 75th Anniversary Team. Both lists are in `service/directory.js`.
  - Search still reaches every NBA player through ESPN.
  - Archive-only legends (`x-…` ids) now open profiles too.
- **2K27 ratings:**
  - Official OVRs come from a ratings feed instead of code: the bundled snapshot is `ratings_2k27.json`. Set `RATINGS_FEED_URL` to a JSON endpoint (format in `service/ratings-feed.js`) and it is re-read on every ratings refresh (6 h, or `RATINGS_TTL_MIN`).
  - Feed values (OVR and any attributes) override the snapshot. The last good copy is kept in `data/ratings-feed.json`.
  - `/api/2k-ratings` reports `source`. Players not in the feed are still estimated from live ESPN stats and labelled as estimates.
- **Ask Hooptrax:**
  - The system prompt starts with today's date (US Eastern). It forbids answering records, stats, rosters, injuries or standings from memory: use the DATA block, then Google Search, otherwise say it can't confirm.
  - Gemini calls carry the `google_search` grounding tool (`GEMINI_SEARCH=0` turns it off). On a quota error it retries without search and pauses search for 10 minutes.
  - All-time career leaderboards are live: active players' ESPN career totals, plus games the ESPN season line hasn't counted yet. They're re-sorted every 30 minutes and served to the chat and to `/nba_history.json`.
  - Leader questions get live 2026-27 season leaders.
- **McConnell card:** "Daily NBA Wordle — guess the mystery NBA player in 8 tries using team, conference, division, position, height, age and jersey-number clues."
