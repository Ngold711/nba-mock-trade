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
