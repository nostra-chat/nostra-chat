# FIND-bbf8efa8 — POST_react_multi_emoji_separate (missing emoji in aggregated render)

Status: **OPEN** (carry-forward to Phase 2b.2)
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
