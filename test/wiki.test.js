import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsFrom, factsFrom, roleOf, wikiLookup } from "../service/wiki.js";

const SEARCH = { pages: [
  { key: "Bill_Sharman", title: "Bill Sharman", description: "American basketball player and coach (1926–2013)", excerpt: "William Walton Sharman was an American <span class=\"searchmatch\">NBA</span> player and coach", thumbnail: { url: "//upload.wikimedia.org/sharman.jpg" } },
  { key: "List_of_NBA_champions", title: "List of NBA champions", description: "Wikimedia list article", excerpt: "The NBA Finals…" },
  { key: "Sharman_(surname)", title: "Sharman (surname)", description: "Surname", excerpt: "Sharman is a surname." },
] };
const SUM = { Bill_Sharman: { title: "Bill Sharman", description: "American basketball player and coach (1926–2013)",
  extract: "William Walton Sharman was an American professional basketball player and coach. He played for the Washington Capitols and the Boston Celtics, winning four NBA championships as a player. As head coach of the Los Angeles Lakers he won the 1972 NBA championship.",
  thumbnail: { source: "https://upload.wikimedia.org/sharman.jpg" }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Bill_Sharman" } } } };

test("bio cards keep NBA people, drop list and surname pages, and read facts from the summary", () => {
  const cards = cardsFrom(SEARCH, SUM);
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.equal(c.name, "Bill Sharman"); assert.equal(c.role, "coach"); assert.equal(c.kind, "wiki");
  assert.deepEqual(c.facts.teams.map((t) => t.code).sort(), ["BOS", "LAL"]);   // the Washington Capitols were a defunct BAA club, not the Wizards franchise
  assert.match(c.facts.titles, /1972 NBA championship/);
  assert.equal(c.url, "https://en.wikipedia.org/wiki/Bill_Sharman");
});
test("roles from descriptions", () => {
  assert.equal(roleOf("American businessman and owner of the Milwaukee Bucks"), "owner");
  assert.equal(roleOf("American basketball executive"), "exec");
  assert.equal(roleOf("American basketball coach"), "coach");
  assert.equal(factsFrom("He coached from 1961 to 1976.").span, "1961–1976");
});
test("lookup is fault-tolerant: a 429 gives no cards and isn't cached", async () => {
  let calls = 0;
  const limited = async () => { calls++; return { ok: false, status: 429, json: async () => ({}) }; };
  assert.deepEqual(await wikiLookup("Gene Shue", { fetchImpl: limited }), []);
  const ok = async (url) => { calls++; return { ok: true, json: async () => (url.includes("/search/") ? SEARCH : url.endsWith("Bill_Sharman") ? SUM.Bill_Sharman : { title: "x", description: "Surname", extract: "" }) }; };
  const r = await wikiLookup("Gene Shue", { fetchImpl: ok, role: "coach" });
  assert.equal(r.length, 1); assert.ok(calls > 1);
});
