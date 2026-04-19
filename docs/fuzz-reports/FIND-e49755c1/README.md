# FIND-e49755c1 — Mirror/IDB coherence drift (sent + received messages)

Status: **FIXED** in Phase 2b.1.

## Symptom

`INV-mirrors-idb-coherent` (tier: medium) fired on `userA` after a
`waitForPropagation(2716ms)` following a burst of text sends and replies:

```
mirror mids not in idb on userA: 1776598357119890, 1776598357119891
```

The mirror (`apiManagerProxy.mirrors.messages.<peerId>_history`) contained
integer mids that had no corresponding row in the `nostra-messages` IndexedDB
— or rows existed but their `mid` field was `null`.

## Root cause

Fix landed in **two waves**. The first wave added `{twebPeerId}` to ChatAPI's
partial save to eliminate the merge race; the second wave (this patch) closed
a residual drift that reintroduced the invariant failure in fuzz replays.

### Wave 1 (commit 4aa59b8f) — partial row carried twebPeerId

**Both sides of the send/receive pipeline had two-phase saves** to the same
`nostra-messages` row, keyed by `eventId`. The message-store's `saveMessage()`
upsert merges fields in a second call, but the **first** write was
"partial" — missing `mid`, `twebPeerId`, `isOutgoing`.

A second ChatAPI path (`updateMessageStatus`, fire-and-forget) races with
these saves. While the field-preserving merge at
`src/lib/nostra/message-store.ts:137-143` is theoretically correct in
isolation, the invariant check can observe a transient window after the
mirror has been updated (from `injectOutgoingBubble` / `nostra-message-handler
→ injectIntoMirrors`) but before the authoritative `mid`-carrying save has
committed.

### Wave 2 (this patch) — pin the seconds-precision timestamp

Fuzz replay still reproduced the failure: the mirror held two mids that had
no IDB row. After tracing, the authoritative cause was a **timestamp drift
between the two writers**, not a missing field.

`mapEventIdToMid(eventId, timestamp)` is deterministic per `(eventId,
timestamp)` pair — the mid encodes the timestamp in the high bits. Two
independent call sites:

1. `ChatAPI.sendMessage()` captured `Date.now()` INSIDE the send — AFTER VMT
   had already computed its own `now = Math.floor(Date.now()/1000)` outside.
2. `NostraMTProtoServer.sendMessage()` used its precomputed `now` for the
   authoritative save and the mirror injection.

If the relay publish crossed a second boundary, ChatAPI's internal timestamp
landed one second LATER than VMT's `now`. Both rows still upserted the same
`eventId`, and the merge logic correctly preserved `mid` — so the IDB row
ended up with VMT's `mid` and VMT's earlier `timestamp`.

But `nostra-delivery-ui.refreshDialogPreview()` (triggered synchronously
from `nostra_delivery_update` → `markSent`) was racing the authoritative
save. It read the latest IDB row back with `store.getMessages(convId, 1)`,
and when `latest.mid` was still undefined it fell back to
`await mapper.mapEventId(latest.eventId, latest.timestamp)`. Because the
partial row's timestamp was ChatAPI's internal seconds (one second later
than VMT's `now`), this computed a **different mid** — which the preview
handler then wrote into `apiManagerProxy.mirrors.messages[<peer>_history]`.

The result: the mirror held VMT's mid (from `injectOutgoingBubble`) AND
refreshDialogPreview's mid (from the stale-timestamp fallback). The IDB
only held a row for VMT's mid. The second mirror mid was a ghost — exactly
the `missing in idb` signature the invariant reports.

`getDialogs()` and `getHistory()` in VMT share the same `?? mapEventId(...)`
fallback pattern at `virtual-mtproto-server.ts:369, 433, 520, 586` and
would exhibit the same ghost-mid behavior if they observed the partial row.

### Sender path (before)

1. `ChatAPI.sendMessage()` (`src/lib/nostra/chat-api.ts:517`) saved
   `{eventId, deliveryState: 'sending'}` — **no** `mid`/`twebPeerId`/`isOutgoing`.
2. `NostraMTProtoServer.sendMessage()` (`src/lib/nostra/virtual-mtproto-server.ts:749`)
   called `chatAPI.sendText()`, then `mapEventId()`, then saved the
   authoritative row with `{..., mid, twebPeerId, isOutgoing: true}`.
3. `injectOutgoingBubble()` put the mid into `apiManagerProxy.mirrors.messages`.

If the invariant ran between step 1 and step 2, or if
`updateMessageStatus` raced and re-saved a stale partial row, the
invariant saw an `mid` in the mirror but not in IDB.

### Receiver path (before)

1. `chat-api-receive.ts:374` saved `{eventId, deliveryState: 'delivered'}`
   via fire-and-forget — **no** `mid`/`twebPeerId`/`isOutgoing`.
2. `ctx.onMessage()` kicked off `NostraSync.onIncomingMessage`, which
   awaited a full save with `{..., mid, twebPeerId, isOutgoing: false}`.
3. `nostra-message-handler.injectIntoMirrors()` placed the mid in mirrors.

Same shape as sender — the partial row could be observed before NostraSync's
full save landed.

## Fix

### Wave 1 — make every write carry mid/twebPeerId/isOutgoing

**Both writes on both sides already carry `mid` + `twebPeerId` +
`isOutgoing`** so the invariant never sees a partial row, regardless of
commit order.

- `src/lib/nostra/chat-api.ts`: `sendText(content)` →
  `sendText(content, opts?: {mid?, twebPeerId?})`, same for `sendFileMessage`.
  `opts.twebPeerId` → `row.twebPeerId`, `row.isOutgoing = true`.
- `src/lib/nostra/virtual-mtproto-server.ts`: VMT `sendMessage` passes
  `{twebPeerId}` through `chatAPI.sendText(text, ...)`.
- `src/lib/nostra/chat-api-receive.ts`: the fire-and-forget receive save now
  computes `mid` + `twebPeerId` via `NostraBridge.getInstance()` before the
  partial save.

### Wave 2 — pin the seconds-precision timestamp across the race

Add a `timestampSec` opt to `sendText`/`sendFileMessage`. When the caller
provides it, `ChatAPI.sendMessage` uses `opts.timestampSec * 1000` as its
internal `timestamp` instead of a fresh `Date.now()`. This keeps the
partial row's `timestamp` field EXACTLY equal to the `now` VMT used when
computing its `mid` via `mapEventId(eventId, now)`.

Consequence: any subsequent `latest.mid ?? mapEventId(latest.eventId,
latest.timestamp)` fallback (in `refreshDialogPreview`, `getDialogs`,
`getHistory`, `searchMessages`) observes the SAME `(eventId, timestamp)`
pair VMT used and therefore computes the IDENTICAL mid. The mirror can
no longer gain a ghost mid with no IDB counterpart.

Files changed in wave 2:

- `src/lib/nostra/chat-api.ts` — `sendText` / `sendFileMessage` / internal
  `sendMessage` accept `opts.timestampSec`; when present, `timestamp` is
  pinned to `timestampSec * 1000`.
- `src/lib/nostra/virtual-mtproto-server.ts` — VMT.sendMessage passes
  `timestampSec: now` alongside `twebPeerId` to `chatAPI.sendText`.
- `src/lib/nostra/nostra-send-file.ts` — `realMid` (seconds) is captured
  BEFORE `chatAPI.sendFileMessage`, and the same value is passed as
  `mid`, `twebPeerId` target is piped through, and `timestampSec: realMid`
  pins the partial row's timestamp to the same second the authoritative
  save will use.
- `src/tests/nostra/mirror-idb-coherent.test.ts` — assert VMT passes
  `timestampSec` as a number.

## Verification

- `pnpm test:nostra:quick` — 393/393 pass (after both waves).
- `npx vitest run src/tests/nostra/mirror-idb-coherent.test.ts` — 3/3 pass.
- `npx tsc --noEmit` — clean.
- Full replay of trace.json (offline via unit test) exercises both paths;
  every save produces a row with `mid` present and a consistent timestamp.

## Related

- `docs/fuzz-reports/FIND-cfd24d69/` — dup-mid blocker (Phase 2a).
- `docs/fuzz-reports/FIND-676d365a/` — delete-side race (Phase 2a).
- Invariant: `src/tests/fuzz/invariants/state.ts:38` (mirrorsIdbCoherent).
