# FIND-bbf8efa8 — POST_react_multi_emoji_separate (missing emoji in aggregated render)

Status: **FIXED** in Phase 2b.2a
Tier: postcondition
Scope: Phase 2b.2 investigation

## Symptom

After `reactMultipleEmoji` publishes 3 distinct kind-7 events in quick
succession from the same sender on the same target bubble, the sender's
own bubble fails to render all 3 emojis:

```
sender userB missing one of 👍,❤️,😂 on bubble 1776632512772244
```

From `failure.json`:
```
user: "userB"
mid: "1776632512772244"
expected: ["👍","❤️","😂"]
```

## Minimal trace (seed 101, iter 1)

1. `sendText({from:"userA",text:"hi"})`
2. `sendText({from:"userA",text:"10B9|tl\`k\"A"})`
3. `reactMultipleEmoji({user:"userB",emojis:["👍","❤️","😂"]})`

The action fires 3 `chatAPI.publishReaction(...)` calls in sequence against
the same target mid. All 3 kind-7 events reach the relay (confirmed by
`RelayPool` recv log in `console.log`), but only 1 or 2 render on the
sender-side `.reactions` bubble annotation.

## Likely cause

Multi-emoji aggregation render race. Two hypotheses to probe in 2b.2:

**Hypothesis A — legacy tweb `.reactions` collision.** tweb bubbles have a
built-in `.reactions` container that the legacy appReactionsManager
populated from MTProto updates. Our `renderNostraReactions` may target
the same DOM node and the last render wins — overwriting earlier emojis
instead of aggregating.

**Hypothesis B — reactions-store cache refresh race.** Each `publishReaction`
triggers an optimistic local upsert + `nostra_reactions_changed` event.
If the event-driven re-render reads `nostraReactionsStore.getForBubble(mid)`
during a write (the 2nd or 3rd upsert), the stored Map may momentarily
contain only partial rows, and the render commits a stale snapshot. The
4th invocation (aggregate postcondition check at +800ms) sees only the
snapshot from whichever race won.

**Hypothesis C — React/Solid keyed-list diffing.** If the 3 emoji elements
are keyed by `reactionEventId` (hex hash), DOM reconciliation may treat
them as independent subtree insertions. An intermediate re-render could
unmount one of the three if the store emits "all three" → "first + third"
→ "all three" during the race.

2b.2 triage plan: add `console.debug` at the start + end of
`renderNostraReactions` logging the store snapshot, run the replay with
`--debug`, and compare the rendered emoji Set vs the stored Set at each
render tick.

## Reproduction

```bash
pnpm fuzz --replay=FIND-bbf8efa8
```

## Artifacts

- `trace.json` — deterministic replay (3 actions)
- `failure.json` — expected emojis + failing user/mid
- `console.log` — 34 KB of browser console output
- `dom-A.html` / `dom-B.html` — full DOM snapshots at failure
- `screenshot-A.png` / `screenshot-B.png` — final viewport showing partial reaction render

## Triage (2b.2a session)

- **Replay status**: REPRODUCED (log: `/tmp/repro-bbf8efa8.log`)
- **Failure observed**: `POST_react_multi_emoji_separate` fires at action 3 (`reactMultipleEmoji userB ["👍","❤️","😂"]`) — `sender userB missing one of 👍,❤️,😂 on bubble 1776684477450509`.
- **Verdict**: PROD
- **Hypothesis selected**: H1 (Hypothesis A in README) — legacy tweb `.reactions` container collision with `renderNostraReactions`. The last `nostra_reactions_changed` re-render wins and overwrites prior emoji entries rather than aggregating, because `renderNostraReactions` likely clears the container on each invocation and the 3 rapid kind-7 events trigger 3 sequential re-renders.
- **Planned fix scope**: `src/components/chat/reaction.ts` and/or `src/lib/nostra/nostra-reactions-receive.ts` — ensure `renderNostraReactions` reads the full current set from the store (all upserted rows for that `mid`) rather than committing a snapshot from a single event's payload.
- **Time-box**: 2h. Escape: downgrade `POST_react_multi_emoji_separate` postcondition to `skip: true` with TODO, carry-forward to 2b.2b.

## Root cause (confirmed)

Instrumented replay identified **two** sequential bugs, neither matching the
H1/H2/H3 hypotheses from the original README — H1 (tweb collision) was a
dead end because the Nostra renderer writes to its own `:scope > .reactions`
node and never collides. The actual chain was:

1. **Wiring race** (`src/lib/nostra/chat-api.ts`): `setReactionsChatAPI(this as any)`
   was only called inside `initGlobalSubscription()`, which is fire-and-forget
   from `nostra-onboarding-integration.ts`. On userB the global init was
   overtaken by an eager `connect(peer)` call from the chat UI, so the
   closures inside `initGlobalSubscription` never reached `setReactionsChatAPI`
   before `messages.sendReaction` arrived via the VMT bridge — three
   consecutive `"ChatAPI not wired"` warnings in the trace.

2. **Cache-read race** (H2 variant, `src/lib/nostra/nostra-reactions-local.ts`
   + `src/components/chat/bubbles.ts`): with wiring fixed, `publish()`
   fires `nostra_reactions_changed` which has two rootScope listeners —
   the render listener in `bubbles.ts` (registered first, on chat mount)
   and the cache-warmer in `nostra-reactions-local.ts` (registered later,
   on first lazy-import). Both are invoked in registration order. The
   render listener read `getReactions()` *before* the cache-warmer
   finished its async `getAll()` refresh — so every render saw the cache
   one dispatch behind. On 3 rapid-fire publishes the final DOM commit
   held only 2 emojis even though the store held 3.

Evidence (instrumented trace):

```
[react-render] {mid, emojis: []}        ← publish 1 → render reads empty
[react-render] {mid, emojis: []}        ← publish 2 → render still empty
[react-refresh] {emojis: [e1, e2]}      ← warmer catches up
[react-render] {mid, emojis: [e1, e2]}  ← publish 3 → render reads 2
[react-refresh] {emojis: [e1, e2, e3]}  ← warmer catches up, no more renders
```

## Fix summary

Two small edits, both in main-thread modules:

1. `chat-api.ts` constructor now calls `setReactionsChatAPI(this as any)`
   immediately, so the publish module is wired before any async path can
   overtake it.
2. `nostra-reactions-local.ts` exposes a new `getReactionsFresh(peerId, mid)`
   that awaits a store refresh before returning. `bubbles.ts` uses the
   fresh read inside the `nostra_reactions_changed` handler, so each
   render reflects the committed store state for that dispatch — no
   listener-order dependency.

Regression: `INV-reaction-aggregated-render` (cheap tier) asserts all
N emojis from `reactMultipleEmoji.meta.emojis` are present in the sender
bubble's `.reactions` textContent after the postcondition settles. Two
Vitest cases cover the pass/fail branches of the invariant itself.
