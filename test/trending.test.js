import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, parseEspnNews, playerMatcher, countMentions, rankTrending, createTradeCounter, BASELINE } from "../service/trending.js";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[Kings exploring trade market for Domantas Sabonis]]></title><pubDate>Sat, 14 Nov 2026 18:00:00 +0000</pubDate>
  <description><![CDATA[<p>Sacramento has fielded calls on Domantas Sabonis &amp; others.</p>]]></description></item>
<item><title>Rival teams view Michael Porter Jr. as a target</title><pubDate>Sat, 14 Nov 2026 15:00:00 +0000</pubDate><description>Contenders &#8217;interested&#8217;.</description></item>
<item><title>Stephen Curry scores 40</title><pubDate>Fri, 13 Nov 2026 12:00:00 +0000</pubDate><description>Brilliant night.</description></item>
<item><title>Old: Tyler Herro trade talk</title><pubDate>Mon, 01 Jun 2026 12:00:00 +0000</pubDate><description>Stale rumor.</description></item>
</channel></rss>`;
const league = {
  teams: { SAC: { displayName: "Sacramento Kings", logo: "sac.png", color: "#5a2d81" }, BKN: { displayName: "Brooklyn Nets", logo: "bkn.png", color: "#000000" }, GS: { displayName: "Golden State Warriors", logo: "gs.png", color: "#1d428a" }, MIL: { displayName: "Milwaukee Bucks", logo: "mil.png", color: "#00471b" } },
  players: [
    { id: "3155942", name: "Domantas Sabonis", teamAbbr: "SAC", position: "C", salary: 45500000 },
    { id: "4278104", name: "Michael Porter Jr.", teamAbbr: "BKN", position: "F", salary: 40900000 },
    { id: "3975", name: "Stephen Curry", teamAbbr: "GS", position: "G", salary: 62600000 },
    { id: "4395725", name: "Tyler Herro", teamAbbr: "MIL", position: "G", salary: 33000000 },
  ],
};

test("feed parsing: RSS items with CDATA, entities and dates", () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 4);
  assert.equal(items[0].title, "Kings exploring trade market for Domantas Sabonis");
  assert.match(items[0].text, /Domantas Sabonis & others/);
  assert.equal(items[0].date, Date.parse("2026-11-14T18:00:00Z"));
  const espn = parseEspnNews({ articles: [{ headline: "Trade talk", description: "x", published: "2026-11-14T10:00:00Z", categories: [{ type: "athlete", athleteId: 3975 }, { type: "team", teamId: 9 }] }] });
  assert.deepEqual(espn[0].athleteIds, ["3975"]);
});

test("mentions: only trade-flavored, recent items; headline mentions weigh double; Jr. suffix optional", () => {
  const m = countMentions(parseFeed(RSS), playerMatcher(league.players), { now: NOW });
  assert.equal(m.get("3155942"), 2);              // headline + body, counted once per item, headline weight 2
  assert.equal(m.get("4278104"), 2);
  assert.equal(m.has("3975"), false);             // "scores 40" is not trade talk
  assert.equal(m.has("4395725"), false);          // older than 21 days
  const any = countMentions(parseFeed(RSS), playerMatcher(league.players), { now: NOW, tradeOnly: false });
  assert.ok(any.get("3975") >= 1);
});

test("ranking blends rumors, user adds and the baseline; resolves team, salary, heat", () => {
  const rumor = countMentions(parseFeed(RSS), playerMatcher(league.players), { now: NOW });
  const r = rankTrending({ league, book: null, stats: null, rumor, userAdds: new Map([["3975", 36]]) });
  assert.deepEqual(r.map((p) => p.name), ["Stephen Curry", "Domantas Sabonis", "Michael Porter Jr.", "Tyler Herro"]);
  assert.equal(r[0].rank, 1); assert.equal(r[0].heat, 100); assert.equal(r[0].team.code, "GSW");
  assert.equal(r[1].team.logo, "sac.png"); assert.equal(r[1].salary, 45.5);
  const herro = r.find((p) => p.name === "Tyler Herro");
  assert.equal(herro.baseline, true);              // only on the strength of the mainstay list
  assert.ok(BASELINE.includes("Tyler Herro"));
  assert.ok(rankTrending({ league, top: 2 }).length <= 2);
});

test("user trade counter: per-visitor de-duplication, 7-day window, id validation", () => {
  const c = createTradeCounter();
  assert.equal(c.add("v1", ["3975", "3975", "abc", "3155942"], NOW), 2);
  assert.equal(c.add("v1", ["3975"], NOW + 1000), 0);                 // same visitor within 6h
  assert.equal(c.add("v2", ["3975"], NOW + 1000), 1);
  assert.equal(c.counts(NOW + 2000).get("3975"), 2);
  assert.equal(c.counts(NOW + 8 * 864e5).size, 0);                    // aged out
  const d = createTradeCounter(); d.load(JSON.parse(JSON.stringify(c)));
  assert.equal(d.counts(NOW + 2000).get("3975"), 2);
});
