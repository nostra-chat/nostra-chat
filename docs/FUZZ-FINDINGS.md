# Fuzz Findings

Last updated: 2026-04-19 11:32:44
Open bugs: 2 · Fixed: 5

## Open (sorted by occurrences desc)

### FIND-3c99f5a3 — POST-sendText-bubble-appears
- **Status**: open
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-19 11:26:47
- **Last seen**: 2026-04-19 11:26:47
- **Seed**: 43
- **Assertion**: "sent bubble with text \"🔥🔥🔥\" never appeared on sender"
- **Replay**: `pnpm fuzz --replay=FIND-3c99f5a3`
- **Minimal trace** (6 actions):
  1. `editRandomOwnBubble({"user":"userB","newText":".5"})`
  2. `reactMultipleEmoji({"user":"userB","emojis":["😂","👍"]})`
  3. `waitForPropagation({"ms":1899})`
  4. `replyToRandomBubble({"from":"userA","text":"Y%)wnY"})`
  5. `openRandomChat({"user":"userB"})`
  6. `sendText({"from":"userA","text":"🔥🔥🔥"})`
- **Artifacts**: [`docs/fuzz-reports/FIND-3c99f5a3/`](../fuzz-reports/FIND-3c99f5a3/)

### FIND-e49755c1 — INV-mirrors-idb-coherent
- **Status**: open
- **Tier**: medium
- **Occurrences**: 1
- **First seen**: 2026-04-19 11:32:44
- **Last seen**: 2026-04-19 11:32:44
- **Seed**: 48
- **Assertion**: "mirror mids not in idb on userA: 1776598357119890,1776598357119891"
- **Replay**: `pnpm fuzz --replay=FIND-e49755c1`
- **Minimal trace** (11 actions):
  1. `sendText({"from":"userB","text":"y "})`
  2. `sendText({"from":"userB","text":"<"})`
  3. `reactToRandomBubble({"user":"userA","fromTarget":"own","emoji":"👍"})`
  4. `deleteRandomOwnBubble({"user":"userB"})`
  5. `removeReaction({"user":"userA"})`
  6. `sendText({"from":"userA","text":"&"})`
  7. `sendText({"from":"userB","text":"/"})`
  8. `replyToRandomBubble({"from":"userB","text":"<Ja.hZ9Hv\"_R"})`
  9. `sendText({"from":"userB","text":"p$"})`
  10. `replyToRandomBubble({"from":"userA","text":"&ref$#i"})`
  11. `waitForPropagation({"ms":2716})`
- **Artifacts**: [`docs/fuzz-reports/FIND-e49755c1/`](../fuzz-reports/FIND-e49755c1/)

## Fixed

### FIND-9df3527d — POST-sendText-bubble-appears
- **Status**: fixed
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 48
- **Assertion**: "sent bubble with text \"y \" never appeared on sender"
- **Replay**: `pnpm fuzz --replay=FIND-9df3527d`
- **Minimal trace** (1 actions):
  1. `sendText({"from":"userB","text":"y "})`
- **Artifacts**: [`docs/fuzz-reports/FIND-9df3527d/`](../fuzz-reports/FIND-9df3527d/)

### FIND-f7b0117c — INV-sent-bubble-visible-after-send
- **Status**: fixed
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 48
- **Assertion**: "sent text \"y \" not visible on sender userB"
- **Replay**: `pnpm fuzz --replay=FIND-f7b0117c`
- **Minimal trace** (1 actions):
  1. `sendText({"from":"userB","text":"y "})`
- **Artifacts**: [`docs/fuzz-reports/FIND-f7b0117c/`](../fuzz-reports/FIND-f7b0117c/)

### FIND-2f61ff8b — INV-console-clean (Solid createRoot cleanup warning)
- **Status**: fixed
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
- **Artifacts**: [`docs/fuzz-reports/FIND-2f61ff8b/`](../fuzz-reports/FIND-2f61ff8b/)

### FIND-2fda8762 — INV-console-clean (reaction.ts center_icon TypeError)
- **Status**: fixed
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 51
- **Assertion**: "Unallowlisted console error: [pageerror] Cannot read properties of undefined (reading 'center_icon') — TypeError at `src/components/chat/reaction.ts:205:33`"
- **Replay**: `pnpm fuzz --replay=FIND-2fda8762`
- **Minimal trace** (5 actions):
  1. `sendText({"from":"userA","text":"a"})`
  2. `openRandomChat({"user":"userA"})`
  3. `sendText({"from":"userB","text":"u>@(}"})`
  4. `reactToRandomBubble({"user":"userA","emoji":"🤔"})`
  5. `deleteRandomOwnBubble({"user":"userB"})`
- **Artifacts**: [`docs/fuzz-reports/FIND-2fda8762/`](../fuzz-reports/FIND-2fda8762/)

### FIND-7fd7bc72 — INV-console-clean (wrapSticker sticker TypeError)
- **Status**: fixed
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 08:31:00
- **Last seen**: 2026-04-19 08:31:00
- **Seed**: 52
- **Assertion**: "Unallowlisted console error: [pageerror] Cannot read properties of undefined (reading 'sticker') — TypeError at `src/components/wrappers/sticker.ts:72:27` via `onAvailableReaction` at `reaction.ts:419:23`"
- **Replay**: `pnpm fuzz --replay=FIND-7fd7bc72`
- **Minimal trace** (8 actions):
  1. `sendText({"from":"userB","text":"~?WDIxqj35"})`
  2. `waitForPropagation({"ms":524})`
  3. `deleteRandomOwnBubble({"user":"userB"})`
  4. `waitForPropagation({"ms":2083})`
  5. `scrollHistoryUp({"user":"userA"})`
  6. `openRandomChat({"user":"userB"})`
  7. `reactToRandomBubble({"user":"userA","emoji":"👍"})`
  8. `scrollHistoryUp({"user":"userA"})`
- **Artifacts**: [`docs/fuzz-reports/FIND-7fd7bc72/`](../fuzz-reports/FIND-7fd7bc72/)

