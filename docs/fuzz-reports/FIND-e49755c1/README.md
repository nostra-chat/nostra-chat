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

**Make both writes on both sides already carry `mid` + `twebPeerId` +
`isOutgoing`** so the invariant never sees a partial row, regardless of
commit order.

### `src/lib/nostra/chat-api.ts`

`sendText(content)` → `sendText(content, opts?: {mid?, twebPeerId?})`, same for
`sendFileMessage` (opts folded into `extras`). The internal `sendMessage`
now applies these onto the first IDB row:
- `opts.mid` → `row.mid`
- `opts.twebPeerId` → `row.twebPeerId`, `row.isOutgoing = true`
  (presence of `twebPeerId` is a reliable "this is an outgoing send via VMT"
  signal — callers pass it when they know the message is outgoing, even if
  they haven't precomputed the mid yet).

### `src/lib/nostra/virtual-mtproto-server.ts`

`sendMessage` now passes `{twebPeerId}` through `chatAPI.sendText(text, ...)`
so the sender's first IDB row already contains `twebPeerId` +
`isOutgoing: true`. The authoritative second save still writes `mid`; the
message-store merge stitches them.

### `src/lib/nostra/chat-api-receive.ts`

The fire-and-forget receive save now computes `mid` and `twebPeerId` via
`NostraBridge.getInstance()` before constructing the row, so that partial
save already carries all three fields. Any subsequent NostraSync save merges
without removing them.

## Files changed

- `src/lib/nostra/chat-api.ts` — `sendText` / `sendFileMessage` / `sendMessage`
  accept `opts` carrying mid/twebPeerId.
- `src/lib/nostra/chat-api-receive.ts` — eager mid/twebPeerId lookup before
  partial save.
- `src/lib/nostra/virtual-mtproto-server.ts` — VMT `sendMessage` passes
  `{twebPeerId}` into `chatAPI.sendText`.
- `src/tests/nostra/mirror-idb-coherent.test.ts` — NEW regression test.
- `src/tests/nostra/virtual-mtproto-server.test.ts`,
  `src/tests/nostra/virtual-mtproto-server-errors.test.ts` — updated
  `.toHaveBeenCalledWith(...)` assertions for the new `sendText` opts arg.

## Verification

- `pnpm test:nostra:quick` — 393/393 pass.
- `npx vitest run src/tests/nostra/mirror-idb-coherent.test.ts` — 3/3 pass.
- `npx tsc --noEmit` — clean.
- Full replay of trace.json (offline via unit test) exercises both paths;
  every save produces a row with `mid` present.

## Related

- `docs/fuzz-reports/FIND-cfd24d69/` — dup-mid blocker (Phase 2a).
- `docs/fuzz-reports/FIND-676d365a/` — delete-side race (Phase 2a).
- Invariant: `src/tests/fuzz/invariants/state.ts:38` (mirrorsIdbCoherent).
