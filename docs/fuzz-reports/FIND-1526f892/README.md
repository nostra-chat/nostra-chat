# FIND-1526f892 — react UI doesn't appear on sender (sender-side fix only)

**Status:** fixed (Phase 2a scope). Sender-side display works. Receive-side
(peer sees the reaction via relay NIP-25) is tracked separately for
Phase 2b.

## Invariant

`POST-react-emoji-appears` — after `reactToRandomBubble`, the emoji appears
in the `.reactions` element of the bubble on the sender's DOM within 2.5s.

## Root cause

`appReactionsManager.sendReaction` (Worker) issues
`messages.sendReaction` via `invokeApi`. For Nostra P2P peers the method is
not in `NOSTRA_STATIC` or `NOSTRA_BRIDGE_METHODS`, so it falls through to
the fallback `{pFlags: {}}` stub — no relay publish, no update events that
reach the bubble DOM. The local `updateMessageReactions` pseudo-update path
targets storage lookups that the Nostra injectOutgoingBubble render path
doesn't register with, so the UI stays blank. See
`docs/fuzz-reports/FIND-1526f892/DIAGNOSIS.md`.

## Fix

`src/lib/nostra/nostra-reactions-local.ts` — new in-memory store keyed by
`(peerId, mid)`. On reaction-add it dispatches `nostra_reaction_added` on
rootScope; `src/components/chat/reactions.ts` appends the emoji to
`.bubble .nostra-reactions` idempotently. `src/components/chat/chat.ts`
`sendReaction` hooks into the store for P2P peers via `isP2PPeer(peerId)`.

## Test

- Vitest: `src/tests/nostra/reactions-local.test.ts`
- Fuzz postcondition: `POST_react_emoji_appears` un-muted.

## Phase 2b follow-up

Implement NIP-25 kind-7 relay publish + receive bridge so the OTHER user
sees the reaction on their DOM. Current scope is sender-only.
