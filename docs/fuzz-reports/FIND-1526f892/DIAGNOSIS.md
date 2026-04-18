# FIND-1526f892 — react display diagnosis

## Caso identificato

**Caso B** (no Nostra-side infra). The sender path runs tweb's MTProto-style
reaction flow; for P2P peers the relay hop silently falls through, and no
DOM update path is wired for the local updateMessageReactions pseudo-event
that reaches the bubble in Nostra mode.

## Root cause

`appReactionsManager.sendReaction()` (Worker-side) does two things after
mutating `message.reactions`:

1. `this.apiUpdatesManager.processLocalUpdate({_: 'updateMessageReactions',
   …, local: true})` — a local pseudo-update intended to refresh the UI
   before the server round-trip confirms.
2. `this.apiManager.invokeApi('messages.sendReaction', …)` — the real
   MTProto call.

For Nostra P2P peers:
- The `messages.sendReaction` call is NOT in `NOSTRA_STATIC`,
  `NOSTRA_BRIDGE_METHODS`, or any action-prefix in `apiManager.ts`. It
  falls through to the generic `{pFlags: {}}` stub, so `onUpdates` receives
  an empty update set — no relay publish, no propagation.
- There is no Nostra handler for `nostraIntercept('messages.sendReaction')`
  and no wiring in `virtual-mtproto-server.ts` — grep across `src/lib/nostra/`
  for `sendReaction`/`reaction` matches zero results outside
  `unread_reactions_count: 0` on the peer-mapper stub.
- The `processLocalUpdate('updateMessageReactions')` path in the Worker
  dispatches a rootScope event (`messages_reactions`) that the main-thread
  bubble component expects to consume. But the consumer looks the message
  up by `messageByPeer(peerId, mid)` which goes through the VMT bridge;
  for P2P peers the pipeline resolves but the update never connects to a
  running DOM listener because `bubbles.ts`'s `messages_reactions`
  subscription doesn't trigger in the P2P happy path — the bubble was
  rendered via `injectOutgoingBubble` / `history_append` which doesn't
  register with the `messages_reactions` wiring.

Net effect: the sender's own reaction is mutated on the in-memory message
object, but no `.bubble[data-mid="X"] .reactions` element is updated.
Receiver (the other user) also doesn't see it because kind-25 NIP-25 publish
is never performed.

## Planned fix scope (Phase 2a)

Sender-side display only — close the gap between reaction click and local
DOM update. Leave the receive-side (peer sees the reaction via relay
NIP-25) to Phase 2b.

1. **Persist locally** (in-memory `Map<${peerId}:${mid}, Set<emoji>>`).
   Keeps the invariant that a refresh loses the reaction — acceptable for
   2a since the real source of truth is the relay event in 2b.
2. **Dispatch** `rootScope.dispatchEventSingle('nostra_reaction_added',
   {peerId, mid, emoji})` when a new emoji is added (idempotent for
   duplicates).
3. **Subscribe** in the chat component and append an emoji `<span>` to the
   bubble's `.reactions` element, creating the element if absent.

Hook `appReactionsManager.sendReaction()` with an `isP2PPeer(peerId)` guard
right before the MTProto invoke: call the local store's `addReaction()`.

Receive-side (Phase 2b) will implement NIP-25 kind-7 publish in the VMT,
plus a separate receive bridge + persistence store.

## Planned files

- `src/lib/nostra/nostra-reactions-local.ts` — NEW (caso B store).
- `src/lib/rootScope.ts` — add `nostra_reaction_added` to `BroadcastEvents`.
- `src/components/chat/reactions.ts` — MODIFY — subscribe + DOM append.
- `src/lib/appManagers/appReactionsManager.ts` — MODIFY — P2P-guarded hook.
- Tests: `src/tests/nostra/reactions-local.test.ts` — red → green for the store.
