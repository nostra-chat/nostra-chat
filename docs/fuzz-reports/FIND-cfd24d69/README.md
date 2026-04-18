# FIND-cfd24d69 — duplicate data-mid on cross-direction send

**Status:** open — `INV-no-dup-mid` muted in fuzzer (commented in
`src/tests/fuzz/invariants/index.ts`) until the underlying render bug is
fixed.

**Broader than initially thought.** Second 2h run (post-mute of
replyToRandomBubble) reproduced the identical signature with a trace that
contained NO reply action — just plain `sendText` alternating between
userA and userB. So the bug triggers on ANY outgoing send that follows an
incoming receive, not only replies. The muted invariant will re-enable when
the render / mid-assignment bug in the send pipeline is fixed.

## Invariant

`INV-no-dup-mid` — `.bubbles-inner .bubble[data-mid]` must have unique mids.

## Reproduction

Replay: `pnpm fuzz --replay=FIND-cfd24d69`
Minimal trace (4 actions):
1. `scrollHistoryUp({user: "userB"})`
2. `sendText({from: "userB", text: "rBCM"})`
3. `openRandomChat({user: "userA"})`
4. `replyToRandomBubble({from: "userA", text: "p-1!Y"})`

Reproduces deterministically on at least two seeds (43, 44).

## Observed state

On userA's chat pane, DOM contains two `.bubble[data-mid="1776496225326960"]`:
- **Bubble 1** `is-in`: text `rBCM` (B's original message to A)
- **Bubble 2** `is-out is-sent`: text `p-1!Y` (A's reply)

Expected: B's bubble keeps `data-mid=1776496224054669` (its own mid, equal to
`replyToMid` in the trace meta), A's reply gets a fresh mid derived from its
own send timestamp.

## Diagnosis (Explore agent, 2026-04-18)

Two candidate roots, both require deeper investigation:

1. **Message store upsert collision** in `src/lib/nostra/message-store.ts:121`
   — the incoming B message and outgoing reply may compute the same mid via
   `mapEventIdToMid` (timestamp * 1e6 + hashBigInt % 1e6) or the upsert
   merges rows by eventId and drops one mid.

2. **Bubble DOM re-render during send flow** in `src/components/chat/bubbles.ts`
   — the `message_sent` listener renames a bubble from temp mid → real mid
   at `bubble.dataset.mid = '' + mid;`. If `getBubble(fullTempMid)` returns
   the WRONG bubble (e.g. matches on B's incoming row), the incoming bubble's
   mid gets overwritten with A's reply mid.

`nostra-peer-mapper.ts:93` `createTwebMessage` also does not forward
`reply_to`, so the reply-quote metadata is lost on P2P — a related but
separate defect.

## Why muted in fuzzer

Every fuzz iteration that generates a `replyToRandomBubble` step hits this
bug at action 2-4 and stops, dominating `FUZZ-FINDINGS.md` while hiding
whatever OTHER bugs the remaining action sequence would surface. Setting
`weight: 0` on `replyToRandomBubble` in `src/tests/fuzz/actions/messaging.ts`
lets the fuzzer explore breadth. Restore to `weight: 15` once this is fixed.

## Artifacts in this directory

- `screenshot-A.png`, `screenshot-B.png` — full-page at failure
- `dom-A.html`, `dom-B.html` — DOM snapshots at failure
- `console.log` — merged userA + userB console
- `failure.json` — assertion + action meta
- `trace.json` — replay sequence
