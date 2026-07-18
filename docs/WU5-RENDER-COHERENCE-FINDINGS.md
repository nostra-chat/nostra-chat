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

---

## Adversarial-review outcome (2026-05-31)

A design + adversarial-review pass produced candidate patches for all three;
the review (verified against current source) found:

- **(a) burst-truncation — proposed listener patch is a NO-OP.** Forcing
  `renderNewMessage` from the `history_append` listener doesn't help: the same
  `if(!this.scrollable.loadedAll.bottom){...return}` guard exists DOWNSTREAM in
  `_renderNewMessage` (bubbles.ts ~3983), so the message is still dropped.
  Relaxing that guard risks DUPLICATE own bubbles (the deferred-render re-fetch
  at ~3985-3993 already re-renders after setPeer settles) and attaching into a
  sliced/re-anchored history. The real fix must distinguish "own send at bottom"
  from "scrolled-up send" at the `_renderNewMessage` guard, not the listener.

- **(c) dual-store — proposed reconciliation is a GUARANTEED NO-OP.**
  `appMessagesManager.getHistory({...})` returns `messages` only on the
  `searchType === 'uncached'` branch; a normal `getHistory` call returns
  `messages: undefined`, so a reconcile that diffs `res.messages` against the DOM
  builds an empty map and heals nothing — while adding a 200-msg fetch + full-DOM
  scan on every `peer_changed`. Option (B) (drop the redundant main-thread
  `setMessageToStorage` at nostra-message-handler.ts:264 and rely on the Worker
  IDB as the single source of truth) is the sounder direction but needs a live
  repro to verify it doesn't lose live-render messages.

- **(b) DM→group — FEASIBLE (the review's "sync" claim was wrong).** The review
  cited `setInnerPeer` at appImManager.ts:2778 as synchronous — that line is
  unrelated typing code. The real `setInnerPeer` is at **appImManager.ts:2607 and
  is already `async`**, so awaiting the group lookup + inject + cache-invalidate
  before the reuse/new-chat `return this.setPeer(options)` paths is safe (no
  contract change). Ready-to-apply patch — insert after the
  `options.type ??= ChatType.Chat;` block (~line 2625), gated on
  `isGroupPeer(peerId)` (NOT bare `< 0`, so DMs/native chats pay nothing):
  ```ts
  if(isGroupPeer(peerId as number)) {            // import from '@lib/nostra/group-types'
    try {
      const {getGroupStore} = await import('@lib/nostra/group-store');
      const rec = await getGroupStore().getByPeerId(peerId as number);
      if(rec?.groupId) {
        const {ensureGroupChatInjected} = await import('@lib/nostra/nostra-groups-sync');
        await ensureGroupChatInjected(rec.groupId, peerId as number); // mirrors.chats + peer_title_edit
      }
      await this.managers.appMessagesManager.invalidateHistoryCache(peerId); // drop stale single-top slice
    } catch(e: any) { console.debug('[setInnerPeer] WU-5b group coherence non-critical:', e?.message); }
  }
  ```
  **LIVE-TESTED — this simple patch is INSUFFICIENT (verified, not merged).** I
  built a deterministic E2E (`src/tests/e2e/e2e-groups-setpeer-coherence.ts`:
  open a DM, then `setInnerPeer` a 3-message group, assert topbar == group name
  AND ≥3 bubbles). The bug reproduces cleanly (RED: topbar stays `"Bob-Fuzz"`,
  bubbles=2). With the patch above applied + confirmed served in the dev bundle,
  the E2E STILL FAILS: topbar stays on the DM name and the render shows <3 bubbles
  — and `invalidateHistoryCache` visibly ran (the bubble count *changed*), so the
  block executed but neither half resolved. WU5b is therefore deeper than an
  inject+invalidate nudge:
  - **Topbar half:** `ensureGroupChatInjected`'s `peer_title_edit` dispatch does
    not re-title the topbar here — likely the subsequent `return this.setPeer(
    options)` re-renders the topbar from a chat whose group title still isn't
    resolved. Fix the title path directly (resolve from `mirrors.chats` for
    negative peerIds at setPeer time), not via a pre-setPeer event.
  - **Render half:** `invalidateHistoryCache` + `setPeer` does NOT force a full
    `getGroupHistory` render — the group still renders a partial slice. Needs the
    bubbles `setPeer`/`changeHistoryStorageKey` group path to re-fetch all
    messages, not just re-anchor.
  The ineffective patch was reverted (it adds a re-fetch cost with no benefit).

Net: ALL THREE WU-5 sub-issues need direct render/topbar-path work, not the
first-draft patches — (a) and (c) are dead-end patches (verified by source),
and (b)'s inject+invalidate is now ALSO verified insufficient by **live E2E**.
The valuable output of this pass: a **clean deterministic repro**
(`e2e-groups-setpeer-coherence.ts`, currently RED — not wired into run-all.sh)
plus three ruled-out approaches, so a supervised session starts from a red repro
+ a known-bad-path list instead of from scratch. WU-3 (the related cold-start
race) was safely closed and shipped — see PR #124 / v0.25.3.

> Correction note: an earlier revision of this section wrongly stated
> `setInnerPeer` was synchronous (citing the wrong line) and implied a
> working-tree corruption. Both were mistakes — the method is `async` at :2607
> and `git status` was clean throughout. Corrected here after direct verification.
