# Fuzz Findings

Last updated: 2026-04-19 10:17:50
Open bugs: 0 · Fixed: 5 (in Phase 2b.1)

This file is the canonical index for fuzz findings. During live runs,
`src/tests/fuzz/reporter.ts` appends new findings (deduplicated by
signature) and writes minimal replay traces under
`docs/fuzz-reports/FIND-<sig>/`. The Phase 2b.1 entries below were
curated manually while closing the Phase 2a overnight backlog; future
live runs continue to mutate this file through `recordFinding()`.

## Open (sorted by occurrences desc)

_None — all 5 Phase 2a open findings closed in Phase 2b.1 (see below)._

## Fixed — Phase 2b.1

### FIND-9df3527d — POST-sendText-bubble-appears

- **Status**: fixed-in-2b1 (closed-stale-verified; root-cause fix in Phase 2a commit `633aed78`)
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 48
- **Assertion**: "sent bubble with text \"y \" never appeared on sender"
- **Replay**: `pnpm fuzz --replay=FIND-9df3527d`
- **Minimal trace** (1 action):
  1. `sendText({"from":"userB","text":"y "})`
- **Artifacts**: [`docs/fuzz-reports/FIND-9df3527d/`](fuzz-reports/FIND-9df3527d/)

### FIND-f7b0117c — INV-sent-bubble-visible-after-send

- **Status**: fixed-in-2b1 (closed-stale-verified; root-cause fix in Phase 2a commit `633aed78`)
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 48
- **Assertion**: "sent text \"y \" not visible on sender userB"
- **Replay**: `pnpm fuzz --replay=FIND-f7b0117c`
- **Minimal trace** (1 action):
  1. `sendText({"from":"userB","text":"y "})`
- **Artifacts**: [`docs/fuzz-reports/FIND-f7b0117c/`](fuzz-reports/FIND-f7b0117c/)

### FIND-2f61ff8b — INV-console-clean (Solid createRoot cleanup warning)

- **Status**: fixed-in-2b1 (closed-via-allowlist; regex `src/tests/fuzz/allowlist.ts:58` filters dev-only SolidJS warning, AND Phase 2b.1 commit `121b1395` removed the ad-hoc reactions renderer that originally triggered it)
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 47
- **Assertion**: "Unallowlisted console error: [warning] cleanups created outside a `createRoot` or `render` will never be run"
- **Replay**: `pnpm fuzz --replay=FIND-2f61ff8b`
- **Minimal trace** (6 actions):
  1. `waitForPropagation({"ms":1633})`
  2. `sendText({"from":"userA","text":"G+"})`
  3. `sendText({"from":"userA","text":".~r6fZO"})`
  4. `sendText({"from":"userB","text":"+\"2:vr!r"})`
  5. `waitForPropagation({"ms":1272})`
  6. `reactToRandomBubble({"user":"userA","emoji":"🔥"})`
- **Artifacts**: [`docs/fuzz-reports/FIND-2f61ff8b/`](fuzz-reports/FIND-2f61ff8b/)

### FIND-2fda8762 — INV-console-clean (reaction.ts center_icon TypeError)

- **Status**: fixed-in-2b1 (commit `8dd51c24` — `src/components/chat/reaction.ts` guards all `availableReaction.center_icon` / `sticker` access sites in Nostra mode where no sticker catalog exists)
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 51
- **Assertion**: "Unallowlisted console error: [pageerror] Cannot read properties of undefined (reading 'center_icon') — TypeError at `src/components/chat/reaction.ts:205:33`"
- **Replay**: `pnpm fuzz --replay=FIND-2fda8762`
- **Minimal trace** (6 actions):
  1. `replyToRandomBubble({"from":"userB","text":"3<BDDaM\"#"})` (skipped)
  2. `sendText({"from":"userA","text":"a"})`
  3. `openRandomChat({"user":"userA"})`
  4. `sendText({"from":"userB","text":"u>@(}"})`
  5. `reactToRandomBubble({"user":"userA","emoji":"🤔"})`
  6. `deleteRandomOwnBubble({"user":"userB"})`
- **Artifacts**: [`docs/fuzz-reports/FIND-2fda8762/`](fuzz-reports/FIND-2fda8762/)

### FIND-7fd7bc72 — INV-console-clean (wrapSticker sticker TypeError)

- **Status**: fixed-in-2b1 (commit `8dd51c24` — same guard as FIND-2fda8762; closes the `reaction.ts:576 → onAvailableReaction → wrapStickerAnimation → wrapSticker → sticker.ts:72` chain when the descriptor is undefined)
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 52
- **Assertion**: "Unallowlisted console error: [pageerror] Cannot read properties of undefined (reading 'sticker') — TypeError at `src/components/wrappers/sticker.ts:72:27` via `onAvailableReaction` at `reaction.ts:419:23`"
- **Replay**: `pnpm fuzz --replay=FIND-7fd7bc72`
- **Minimal trace** (9 actions):
  1. `sendText({"from":"userB","text":"~?WDIxqj35"})`
  2. `waitForPropagation({"ms":524})`
  3. `deleteRandomOwnBubble({"user":"userB"})`
  4. `waitForPropagation({"ms":2083})`
  5. `scrollHistoryUp({"user":"userA"})`
  6. `editRandomOwnBubble({"user":"userA","newText":"Y_+"})` (skipped)
  7. `openRandomChat({"user":"userB"})`
  8. `reactToRandomBubble({"user":"userA","emoji":"👍"})`
  9. `scrollHistoryUp({"user":"userA"})`
- **Artifacts**: [`docs/fuzz-reports/FIND-7fd7bc72/`](fuzz-reports/FIND-7fd7bc72/)
