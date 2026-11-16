// Community Feed: public mock trades and mock drafts from every Hooptrax member. Guests can browse; upvotes
// need a free account. Mounted as the "Feed" view on the Live page (live.html#feed).
import { account, itemBody, openHref, openLabel, logoImg, ago } from "./account.js";
import { esc } from "./avatar.js";

const FILTERS = [["all", "All"], ["trade", "Trades"], ["draft", "Mock Drafts"], ["tierlist", "Tier Lists"], ["top", "Top Upvoted"]];

export function startFeed(el) {
  let filter = "all", items = [], next = 0, loading = false, alive = true, error = "";
  el.innerHTML = `<div class="feed-filters" role="tablist" aria-label="Filter posts">${FILTERS.map(([k, l]) => `<button class="press" type="button" role="tab" data-f="${k}" aria-selected="${k === filter}">${l}</button>`).join("")}</div>
    <div class="feed-list" aria-live="polite"></div>
    <button class="btn ghost press feed-more" type="button" hidden>Load more</button>`;
  const list = el.querySelector(".feed-list"), more = el.querySelector(".feed-more");

  const card = (it) => `<article class="post" data-id="${esc(it.id)}">
      <header class="post-head">${it.favoriteTeam ? logoImg(it.favoriteTeam, "1.6rem") : '<span class="acct-dot">@</span>'}
        <span class="post-by"><b>@${esc(it.username)}</b><small>${esc(ago(it.createdAt))}</small></span>
        <span class="it-type ${it.type}">${it.type === "trade" ? "Trade" : it.type === "tierlist" ? "Tier List" : "Mock Draft"}</span></header>
      ${it.title ? `<h4 class="post-title">${esc(it.title)}</h4>` : ""}
      ${itemBody(it)}
      <footer class="post-foot">
        <button class="vote press" type="button" data-like aria-pressed="${!!it.likedByMe}" aria-label="Upvote (${it.likesCount})">▲ <span class="num">${it.likesCount}</span></button>
        <a class="btn ghost press post-open" href="${esc(openHref(it))}">${openLabel(it)} →</a>
      </footer></article>`;
  const paint = () => {
    if (!alive) return;
    el.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.f === filter)));
    list.innerHTML = error ? `<div class="empty">${esc(error)}</div>`
      : items.length ? items.map(card).join("")
      : loading ? `<div class="empty">Loading posts…</div>`
      : `<div class="empty feed-empty"><b>No posts yet.</b><span>Build a trade or a mock draft and tap 🌎 Save &amp; Post to start the feed.</span><a class="btn primary press" href="index.html">Open the Trade Machine</a></div>`;
    more.hidden = next == null || !items.length;
  };
  async function load(reset = false) {
    if (loading) return;
    loading = true; error = "";
    if (reset) { items = []; next = 0; }
    paint();
    const qs = new URLSearchParams({ offset: String(next || 0) });
    if (filter === "trade" || filter === "draft" || filter === "tierlist") qs.set("type", filter);
    if (filter === "top") qs.set("sort", "top");
    try {
      const r = await fetch(`/api/feed?${qs}`, { credentials: "same-origin" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Feed unavailable");
      items = [...items, ...j.data.items]; next = j.data.next;
    } catch (e) { error = `Couldn't load the feed: ${e.message}`; }
    loading = false; paint();
  }
  el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]");
    if (f && f.dataset.f !== filter) { filter = f.dataset.f; load(true); return; }
    if (e.target.closest(".feed-more")) { load(); return; }
    const v = e.target.closest("[data-like]");
    if (v) {
      const id = v.closest("[data-id]").dataset.id;
      account.requireAuth(async () => {
        try {
          const r = await fetch(`/api/items/${encodeURIComponent(id)}/like`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
          const j = await r.json(); if (!r.ok) throw new Error(j.error);
          const it = items.find((x) => x.id === id); if (it) { it.likedByMe = j.data.liked; it.likesCount = j.data.likesCount; }
          const b = list.querySelector(`[data-id="${CSS.escape(id)}"] [data-like]`);
          if (b) { b.setAttribute("aria-pressed", String(j.data.liked)); b.querySelector(".num").textContent = j.data.likesCount; }
        } catch {}
      }, "Create a free Hooptrax account to upvote posts");
    }
  });
  const off = account.onChange(() => load(true));          // sign in / out → refresh "▲ liked by me"
  load(true);
  return () => { alive = false; off(); };
}
