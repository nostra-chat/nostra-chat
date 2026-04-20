# FIND-c0046153 — INV-bubble-chronological (out-of-order DOM insert)

Status: **FIXED** in Phase 2b.2a
Tier: cheap
Scope: Phase 2b.2 investigation

## Symptom

`INV-bubble-chronological` fires on `userA` during a burst of P2P sends from
both sides:

```
bubbles not chronological: idx 1=1776632351 > idx 2=1776632349
```

Evidence (from `failure.json`):
```
timestamps: [1776632349, 1776632351, 1776632349, 1776632353]
                   ↑—— two bubbles with ts=1776632349 split by one ts=1776632351 ——↑
```

## Minimal trace (seed 48, iter 6)

1. `sendText({from:"userB",text:"y "})`
2. `sendText({from:"userB",text:"<"})`
3. `reactToRandomBubble({user:"userA",fromTarget:"own",emoji:"👍"})`  — skipped (no own bubble yet)
4. `deleteRandomOwnBubble({user:"userB"})`  — skipped (no own bubble on open chat for B)
5. `removeReaction({user:"userA"})`  — skipped (no reaction to remove)
6. `sendText({from:"userA",text:"&"})`
7. `sendText({from:"userB",text:"/"})`
8. `replyToRandomBubble({from:"userB",text:"<Ja.hZ9Hv\"_R"})`  — skipped (no bubble to reply to yet on fresh chat frame)
9. `sendText({from:"userB",text:"p$"})`
10. `replyToRandomBubble({from:"userA",text:"&ref$#i"})`

## Likely cause

Out-of-order delivery: peer's `sendText` is signed and relay-published, then
the local sender's own `sendText` resolves with a later `created_at` because
of sequential `Math.floor(Date.now()/1000)` capture, but the peer-echoed
message arrives at the sender AFTER the local bubble is already inserted.
DOM insert order is "append in receive order" rather than "sort by
`created_at`", so the receive-side bubble appears AFTER the older local
bubble even though its timestamp is smaller.

Variants to probe in 2b.2:
- `BubblesController.insertBubble` sort key — does it use `mid` or `timestamp`?
- `nostra_new_message` dispatch path: does it call `setMessageToStorage` +
  `getHistorySlice` (sorted), or does it directly `appendChild` a fresh
  bubble element?
- NTP/clock skew between the two Playwright contexts: if `created_at` is
  wall-clock seconds and both contexts happen to fire at the same second
  boundary, the insertion order becomes non-deterministic and arrives
  observer-order.

## Reproduction

```bash
pnpm fuzz --replay=FIND-c0046153
```

Trace + failure.json committed in this directory.

## Artifacts

- `trace.json` — deterministic replay
- `failure.json` — original invariant failure payload
- `console.log` — 94 KB of browser console output captured during the run
- `dom-A.html` / `dom-B.html` — full DOM snapshots at failure
- `screenshot-A.png` / `screenshot-B.png` — final viewport

## Triage (2b.2a session)

- **Replay status**: REPRODUCED (log: `/tmp/repro-c0046153.log`)
- **Reproduction note**: Two allowlist entries were added to `src/tests/fuzz/allowlist.ts` before the replay succeeded: (1) dev-mode SW registration failure (Playwright headless cannot start Vite module-type SWs — production build is unaffected), and (2) `[ACC-N-MESSAGES] noIdsDialogs` (pre-existing P2P diagnostic that straddles the 5 s warmup window depending on machine speed). Both are dev/timing artefacts unrelated to this FIND.
- **Failure observed**: `INV-bubble-chronological` fires at action 10 (`replyToRandomBubble userA`) with `timestamps: [1776684401, 1776684403, 1776684401, 1776684405]` — idx 1 > idx 2.
- **Verdict**: PROD
- **Hypothesis selected**: H1 — `nostra_new_message` / `history_append` path inserts bubbles in relay-receive order rather than sorting by `created_at`. Two messages sent within the same second get the same `created_at`, and the one received second is appended after the one already in the DOM even when its timestamp is older.
- **Planned fix scope**: `src/lib/nostra/nostra-sync.ts` (dispatch order) and/or `src/components/chat/bubbles.ts` (`insertBubble` sort key — verify it uses `created_at`, not DOM-append order).
- **Carry-forward note**: This bug also blocks FIND-eef9f130's replay — the chronological invariant fires during eef9f130's trace before reaching the input-clear check. Fixing c0046153 unblocks independent eef9f130 reproduction.
- **Time-box**: 2h. Escape: downgrade `INV-bubble-chronological` to `skip: true` with TODO, carry-forward to 2b.2b.

## Root cause (confirmed)

`BubbleGroups.sortItemsKey` was hardcoded to `'mid'` for all non-Scheduled chats (`bubbleGroups.ts:374`). For P2P peers the Worker's `generateTempMessageId` returns `topMessage + 1` when `topMessage >= 2^50` (see `appMessagesIdsManager.ts:23-24` / FIND-cfd24d69 fix) — which encodes the PREVIOUS peer's second, NOT the current wall-clock second. A bubble initially rendered with such a tempMid places itself in `itemsArr` at the position implied by that stale timestamp prefix; the subsequent `message_sent` tempMid → realMid swap in `bubbles.ts` only updates `bubble.dataset.mid` (line 790), never `GroupItem.mid` or `itemsArr`. Result: when a peer's later wall-clock message arrives with a correctly-encoded (smaller-prefix) mid, it sorts AFTER the own bubble even though its timestamp is earlier — `[T, T+2, T, T+4]` in DOM.

Chrono instrumentation on a reproducing run confirmed `bubbleFound: false` at every `message_sent` dispatch (the bubble was rendered under `fullMid(realMid)` via VMT's `injectOutgoingBubble`, never under `fullMid(tempId)`), so no in-place reposition hook in `message_sent` could reach it.

## Fix summary

Switch `sortItemsKey`/`sortGroupsKey` from `'mid'` to `'timestamp'`/`'lastTimestamp'` for P2P chats (`peerId >= 1e15`), mirroring the existing `ChatType.Scheduled` behaviour. `message.date` is the invariant source of truth for DOM chronology regardless of how mids are assigned. Scope: one file (`src/components/chat/bubbleGroups.ts`), 11 LOC including comment. MTProto-legacy peers are unaffected. The underlying `generateTempMessageId` encoding (which produces tempMids with stale second-prefixes) remains unchanged — a future hardening pass could encode wall-clock seconds directly for P2P tempMids to close this gap permanently.
