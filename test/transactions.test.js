import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNbaMovement, mergeTransactions, transactionKind, newest } from "../service/transactions.js";

const espn = [
  { date: "2026-11-13T08:00Z", description: "Signed C Johni Broome to a two-way contract.", kind: "signing", team: { abbr: "MIN" } },
  { date: "2026-11-11T08:00Z", description: "Waived C Lawson Lovering.", kind: "release", team: { abbr: "MIN" } },
];
const nbaJson = { NBA_Player_Movement: { rows: [
  { Transaction_Type: "Signing", TRANSACTION_DATE: "2026-11-15T00:00:00", TRANSACTION_DESCRIPTION: "Cleveland Cavaliers guaranteed the contract of Mario Hezonja.", TEAM_ID: 1610612739 },
  { Transaction_Type: "Signing", TRANSACTION_DATE: "2026-11-13T00:00:00", TRANSACTION_DESCRIPTION: "Minnesota Timberwolves signed Johni Broome to a two-way contract.", TEAM_ID: 1610612750 },
] } };

test("NBA.com movement fills days ESPN hasn't posted; duplicates are merged; newest first", () => {
  const nba = normalizeNbaMovement(nbaJson);
  assert.equal(nba[0].team.abbr, "CLE"); assert.equal(nba[0].kind, "contract");
  const list = mergeTransactions(espn, nba);
  assert.equal(list[0].description, "Cleveland Cavaliers guaranteed the contract of Mario Hezonja.");
  assert.equal(list.filter((t) => /Broome/.test(t.description)).length, 1, "same move from both sources appears once");
  assert.equal(newest(list).slice(0, 10), "2026-11-15");
});
test("transaction kinds", () => {
  assert.equal(transactionKind("Guaranteed the contract of F Mario Hezonja."), "contract");
  assert.equal(transactionKind("Assigned G X to the G League."), "assignment");
  assert.equal(transactionKind("Suspended F Y two games."), "suspension");
});

import { parseRss, realgmTransactions } from "../service/transactions.js";
test("RealGM Wiretap RSS: NBA move headlines only, team + kind detected, deduped against ESPN", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Cavaliers Guarantee Mario Hezonja&#039;s Contract]]></title><link>https://basketball.realgm.com/wiretap/1</link><pubDate>Sun, 15 Nov 2026 19:02:00 -0500</pubDate></item>
    <item><title>Real Madrid Beats Barcelona In Clasico</title><pubDate>Sun, 15 Nov 2026 18:00:00 -0500</pubDate></item>
    <item><title>Timberwolves Sign Johni Broome To Two-Way Deal</title><pubDate>Fri, 13 Nov 2026 10:00:00 -0500</pubDate></item>
    <item><title>Trail Blazers Waive Lawson Lovering</title><pubDate>Tue, 10 Nov 2026 12:00:00 -0500</pubDate></item>
  </channel></rss>`;
  const r = realgmTransactions(parseRss(xml));
  assert.deepEqual(r.map((t) => [t.team.abbr, t.kind]), [["CLE", "contract"], ["MIN", "signing"], ["POR", "release"]]);
  assert.equal(r[0].description, "Cavaliers Guarantee Mario Hezonja's Contract.");
  const merged = mergeTransactions(espn, [], r);
  assert.equal(merged[0].source, "realgm");
  assert.equal(merged.filter((t) => /Broome/.test(t.description)).length, 1);
});

test("RealGM rumors vs official moves: speculation never counts as a move", () => {
  const xml = `<rss><channel>
    <item><title>Pelicans Working On Trade For Starting Center</title><pubDate>Sun, 15 Nov 2026 20:00:00 -0500</pubDate></item>
    <item><title>Bulls Open To Trading Coby White</title><pubDate>Sun, 15 Nov 2026 19:30:00 -0500</pubDate></item>
    <item><title>Heat Sign Vladislav Goldin To Two-Way Contract</title><pubDate>Sun, 15 Nov 2026 19:00:00 -0500</pubDate></item>
    <item><title>Report: Lakers Exploring Market For Austin Reaves</title><pubDate>Sun, 15 Nov 2026 18:00:00 -0500</pubDate></item>
    <item><title>Mavericks Hire New Assistant Coach</title><pubDate>Sun, 15 Nov 2026 17:00:00 -0500</pubDate></item>
  </channel></rss>`;
  const r = realgmTransactions(parseRss(xml));
  const by = Object.fromEntries(r.map((t) => [t.team.abbr, [t.category, t.kind]]));
  assert.deepEqual(by.NO, ["rumor", "rumor"]); assert.deepEqual(by.CHI, ["rumor", "rumor"]);
  assert.deepEqual(by.MIA, ["move", "signing"]); assert.deepEqual(by.LAL, ["rumor", "rumor"]); assert.deepEqual(by.DAL, ["rumor", "news"]);
  const merged = mergeTransactions(espn, [], r);
  assert.ok(merged.filter((t) => t.category === "move").every((t) => !/working on trade|open to trading|exploring/i.test(t.description)));
  assert.equal(merged.filter((t) => t.category === "rumor").length, 4);
  assert.ok(merged.every((t) => t.category === "move" || t.category === "rumor"));
});

import { espnNewsItems, shamsItems, classifyNews, attributionFor } from "../service/transactions.js";
test("ESPN news: stories only, insider attribution, categories", () => {
  const now = Date.parse("2026-11-16T03:00:00Z");
  const news = [
    { headline: "Sources: Hawks are signing guard Ty Jerome to a two-year deal", byline: "Shams Charania", type: "HeadlineNews", published: "2026-11-16T02:00:00Z", teamIds: ["1"], url: "https://espn.com/1" },
    { headline: "Brunson hits tiebreaking 3-pointer in OT", type: "Recap", published: "2026-11-16T02:10:00Z", teamIds: ["18"] },
    { headline: "Kings exploring trades for Zach LaVine", byline: "Brian Windhorst", type: "Story", published: "2026-11-16T01:00:00Z", teamIds: ["23"] },
    { headline: "Jokic (ankle) expected to miss two weeks", type: "Story", published: "2026-11-15T23:00:00Z", teamIds: ["7"] },
  ];
  const r = espnNewsItems(news, { 1: { abbr: "ATL" }, 23: { abbr: "SAC" }, 7: { abbr: "DEN" } }, {}, { now });
  assert.equal(r.length, 3, "recaps dropped");
  assert.deepEqual(r.map((t) => [t.team.abbr, t.category, t.kind, t.sourceAttribution]), [
    ["ATL", "move", "agreed", "Per Shams Charania"], ["SAC", "rumor", "rumor", "Per Brian Windhorst"], ["DEN", "rumor", "news", "Per ESPN"]]);
});
test("Shams RSS (Google News format): outlet kept for attribution; same story from ESPN shows once", () => {
  const now = Date.parse("2026-11-16T03:00:00Z");
  const xml = `<rss><channel>
    <item><title>Hawks are signing guard Ty Jerome to a two-year deal, sources say - ESPN</title><link>https://news.google.com/a</link><pubDate>Mon, 16 Nov 2026 02:05:00 GMT</pubDate></item>
    <item><title>Shams: Celtics' Brown to miss Friday with ankle sprain - Yahoo Sports</title><link>https://news.google.com/b</link><pubDate>Mon, 16 Nov 2026 01:00:00 GMT</pubDate></item>
    <item><title>Charania's podcast picks top golf moments - Golf Digest</title><pubDate>Mon, 16 Nov 2026 01:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const s = shamsItems(parseRss(xml), {}, { now });
  assert.equal(s.length, 2, "non-NBA item dropped");
  assert.equal(s[0].sourceAttribution, "Per Shams Charania (via ESPN)");
  assert.equal(s[1].kind, "news");
  const espnNews = [{ date: "2026-11-16T02:00Z", description: "Sources: Hawks are signing guard Ty Jerome to a two-year deal.", category: "move", kind: "agreed", team: { abbr: "ATL" }, source: "espnNews", sourceAttribution: "Per Shams Charania" }];
  const merged = mergeTransactions([], [], espnNews, s);
  assert.equal(merged.filter((t) => /Jerome/.test(t.description)).length, 1);
  assert.ok(merged.every((t) => t.sourceAttribution));
});
test("speculation from insiders stays a rumor; agreements from non-insiders stay rumors", () => {
  assert.equal(classifyNews("Sources: Bulls could trade Coby White", { insider: true }).category, "rumor");
  assert.equal(classifyNews("Lakers, Reaves agree to four-year extension").category, "rumor");
  assert.equal(attributionFor("", "Kings waive X", "RealGM"), "Per RealGM");
});
