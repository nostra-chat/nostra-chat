# FIND-c0046153 — INV-bubble-chronological (out-of-order DOM insert)

Status: **OPEN** (carry-forward to Phase 2b.2)
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
