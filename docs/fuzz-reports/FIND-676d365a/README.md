# FIND-676d365a — delete doesn't remove local bubble (P2P mid filter)

**Status:** fixed — see commit for `deleteMessages` P2P short-circuit.

## Invariant

`POST-delete-local-bubble-gone` — after `deleteRandomOwnBubble`, the bubble
with that `data-mid` is absent from the sender's DOM within 2.5s.

## Root cause

`appMessagesManager.deleteMessagesInner:6196-6200` mapped `mids →
serverMessageIds` via `getServerMessageId(mid) % MESSAGE_ID_OFFSET` and
filtered entries where the round-trip via `generateMessageId` did not match
the original mid. For any P2P mid (>= 1e15), the `%` arithmetic cannot
reconstruct the original, so all P2P mids were filtered out → `serverMessageIds
= []` → VMT responded `{pts: 1, pts_count: 0}` → `apiUpdatesManager.processLocalUpdate`
was a no-op → bubble stayed on DOM.

## Fix

Early-branch in `appMessagesManager.deleteMessages`: when `isP2PPeer(peerId)`,
call VMT with the full `mids` array and dispatch `processLocalUpdate` with
`pts_count: mids.length`. Avoids the broken round-trip filter entirely for P2P.

## Test

`src/tests/nostra/delete-messages-p2p.test.ts`, red → green. Also confirmed
by un-muting `POST_delete_local_bubble_gone` in fuzz postconditions — once-
failing cases now pass.
