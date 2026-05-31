# WU-5 — Render-coherence races (findings for a supervised session)

Status: **analysis only — no code change.** These three are timing/render races
that need a *live* repro (specific scroll/transition/burst timing) to verify a
fix. An autonomous run cannot reproduce them deterministically, so per the
merge policy they are documented here rather than fixed speculatively. Each
section gives the root cause, exact code location, a recommended fix, and the
repro conditions to drive in a supervised local session (`pnpm start` + two
Playwright contexts + docker strfry relay).

Companion: WU-3 cold-start subscription barrier is draft PR #124 (same "needs
live verification" class).

---

## (a) Sender burst-truncation — own history collapses to the last message

**Symptom:** after a rapid send burst (or a quick chat-switch), the sender's own
chat history visually collapses to just the last message they sent. Reload
restores everything → the data layer is intact; it's a render-anchor bug.

**Root cause:** `src/components/chat/bubbles.ts:1648-1651` — the `history_append`
handler:
```ts
if(!this.scrollable.loadedAll.bottom) {
  this.chat.setMessageId();        // re-anchor: re-fetches around a mid, drops the live append
} else {
  this.renderNewMessage(message, true);
}
```
When `loadedAll.bottom` is transiently `false` during a burst (or mid
chat-switch), each own send takes the `setMessageId()` re-anchor branch instead
of rendering, so bubbles are dropped from the view until a reload re-reads IDB.

**Recommended fix:** for an **own, freshly-sent** message (`message.pFlags.out`
and it's the new top), always `renderNewMessage` — own messages are always at
the bottom, so the re-anchor branch is wrong for them. Gate the re-anchor on
`!message.pFlags?.out`. When `loadedAll.bottom` is false and no `setPeerPromise`
is in flight, re-fetch + re-render after `setPeer` settles rather than dropping.

**Repro (supervised):** open a DM, fire 8–10 `sendText` with no delay between
them (and/or a `setPeer` toggle mid-burst), then assert `.bubble.is-out` count
== messages sent. Extend `e2e-back-and-forth.ts` / `e2e-stress-1to1.ts` (which
currently send with 1.5s gaps — the gap hides the race).

---

## (b) DM→Group transition — topbar frozen + only 1 of N messages render

**Symptom:** with a DM open, tapping a group leaves the topbar showing the DM
peer's name and renders only the latest group message (not the full history).
Navigating away and back recovers it.

**Root cause (topbar):** `src/lib/nostra/nostra-groups-sync.ts:270` dispatches
`peer_title_edit` only from inside `ensureGroupChatInjected`, whose call-sites
are group lifecycle events (create/send/receive) — **not** a plain `setPeer`
navigation into an already-known group. So a navigation-only transition never
refreshes the topbar title.

**Root cause (render):** the bubbles render keys off `historyStorage.maxId`
(single top-message) for the freshly-keyed group history storage; `getGroupHistory`
returns all messages but the transition render shows only the top one.

**Recommended fix:** (1) dispatch `peer_title_edit` (or resolve the title from
`mirrors.chats` for negative peerIds) on **any** `setPeer` transition into a
group peerId, not only on lifecycle events. (2) On `setPeer`/`changeHistoryStorageKey`
into a group storage, force a full `getHistory` render instead of the cached
single-top-message render.

**Repro (supervised):** two contexts; open a DM, then `setInnerPeer(groupPeerId)`
for a group with 3 messages; assert topbar == group name AND 3 bubbles render
without navigating away. (Carry-forward β from PR #115; partial topbar work in
unmerged commit 1f675d31 only reused the lifecycle dispatch.)

---

## (c) Dual-store coherence — rendered count diverges from getHistory

**Symptom:** after a burst of incoming messages then navigate-away-and-back (or
an offline toggle), the open DM shows fewer bubbles than are stored; messages
appear missing until a full reload.

**Root cause:** incoming P2P messages persist to **two unreconciled stores** —
the Worker IDB (via NostraSync) and the main-thread per-mid map written by
`appMessagesManager.setMessageToStorage` (live path: `nostra-message-handler.ts:264`).
`invalidateHistoryCache` wipes the rendered history *slice* + count but leaves
the per-mid map, so `getMessageByPeer` and the rendered slice can disagree after
navigation.

**Recommended fix:** add a reconciliation pass on `peer_changed`/`setPeer`
completion — compare rendered bubbles against `appMessagesManager.getHistory(peerId)`
and `renderNewMessage` any missing mids. Cleaner: make the Worker IDB
(`VMT.getHistory`) the single source of truth — drop the redundant main-thread
`setMessageToStorage` (nostra-message-handler.ts:264) and rely on
`getHistory` + `invalidateHistoryCache` so the slice and per-mid storage rebuild
together.

**Repro (supervised):** build history, navigate away + back (and/or offline
toggle), assert DOM `.bubble` count == `appMessagesManager.getHistory(peerId)`
length.

---

## Why not auto-fixed

All three depend on hitting a specific timing/scroll/transition window that
isn't deterministic in a headless autonomous run, and they touch the
render/history-anchor path on a P2P crypto messenger — merging a speculative fix
without a live red→green repro is the wrong trade-off. The fixes above are
scoped and ready for a supervised session (`pnpm start` + Playwright + docker
strfry), each with a concrete assertion to drive.
