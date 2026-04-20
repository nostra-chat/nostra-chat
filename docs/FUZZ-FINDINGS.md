# Fuzz Findings

Last updated: 2026-04-20
Open bugs: 1 · Fixed: 6+2 (in Phase 2b.1) · Fixed in Phase 2b.2a: 3

## Open (sorted by occurrences desc)

### FIND-chrono-v2 — INV-bubble-chronological (same-second tempMid race)

**Status:** OPEN (carry-forward to Phase 2b.2b)
**Tier:** cheap
**First observed:** 2026-04-20 during Task 4 investigation of FIND-eef9f130
**Assertion:** `INV-bubble-chronological` fires on ~60% of `FIND-eef9f130` replays even AFTER Task 2's `bubbleGroups` sort-key fix (which covered FIND-c0046153's specific trace at 9/9). The residual flake is a DIFFERENT race: same-second same-user interleaved send where the `is-sending` placeholder bubble has `tempMid = topMessage + 1` based on the previous topMessage, but a concurrent peer-incoming bubble arrives with the same `timestampSec`. Task 2's switch to `'timestamp'` sort key resolves same-second ties by insertion order (non-deterministic), exposing a new variant.

**Reproduction:** `pnpm fuzz --replay=FIND-eef9f130` — ~60% of runs.
**Relationship to FIND-c0046153:** Distinct. c0046153's trace passes 9/9. This is a contention variant surfaced by eef9f130's higher-concurrency sequence.
**Hypothesis:** fix either (a) add `mid` as tiebreaker after `timestamp` in the P2P sort (straightforward), or (b) root-cause fix `generateTempMessageId` to encode wall-clock seconds (deeper).
**Owner:** Phase 2b.2b.

## Fixed

### Fixed in Phase 2b.2a

#### FIND-eef9f130 — POST-sendText-input-cleared (harness/postcondition fix)
- **Status**: fixed in Phase 2b.2a
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-19 21:03:08
- **Last seen**: 2026-04-19 21:03:08
- **Seed**: 102
- **Assertion**: "chat input not cleared after send (still contains \"hello\")"
- **Replay**: `pnpm fuzz --replay=FIND-eef9f130` (passes after fix; previously failed on the 3rd `sendText("hello")` after a chat-switch with a ~75% hit rate when the chrono flake did not intercept first)
- **Minimal trace** (8 actions):
  1. `sendText({"from":"userA","text":"$ JNnqb]s6"})`
  2. `sendText({"from":"userA","text":"hello"})`
  3. `sendText({"from":"userB","text":"uyim%{A:"})`
  4. `deleteRandomOwnBubble({"user":"userB"})`
  5. `sendText({"from":"userB","text":"test 123"})`
  6. `replyToRandomBubble({"from":"userA","text":"NJ"})`
  7. `openRandomChat({"user":"userB"})`
  8. `sendText({"from":"userA","text":"hello"})`
- **Root cause**: POSTCONDITION (harness) race, not a production bug. `POST-sendText-input-cleared` probed `chat-input [contenteditable="true"]` textContent synchronously right after `sendBtn.click()`. The post-send clear pipeline is actually async (several awaited steps): `sendMessage` awaits `getConfig → showSlowModeTooltipIfNeeded → prepareStarsForPayment` on the main thread, then `appMessagesManager.sendText` → `beforeMessageSending` on the Worker, which schedules `clearDraft` via a `processAfter` callback, dispatches `draft_updated`, which is relayed via MessagePort back to main, where the listener calls `setDraft(undefined, true, true)` → `messagesQueuePromise` → `fastRaf` → `onMessageSent` → `clearInput`. Under contention (3rd `sendText("hello")` after a chat switch + interleaved deletes/replies) the chain can exceed the 2.5s `bubble_appears` grace window, so by the time `input_cleared` probes the input still holds "hello". The earlier-hypothesised HARNESS driver bug (`keyboard.insertText` vs `document.execCommand`) was tested and invalidated — swapping drivers did not change the failure rate. Instrumentation of the main-thread `sendMessage` + Worker `beforeMessageSending` + `apiManagerProxy.event` showed the failing run simply has `sendMessage` stuck past `getRichValueWithCaret` with no subsequent log; the Worker never sees the call within the probe window, so the clear chain never runs in time. The `bubble_appears` postcondition falsely passed because "hello" was already in the DOM from action 2.
- **Fix**: Add a 3s wait-loop to the `POST-sendText-input-cleared` postcondition (100 ms polls), matching the pattern already used by `POST-sendText-bubble-appears`. No production code change. Scope: 1 file, 20 LOC. `src/tests/fuzz/postconditions/messaging.ts`.
- **Verification**: 8 consecutive replays after fix — 0 `POST-sendText-input-cleared` failures (3 passed outright, 5 intercepted by the unrelated pre-existing chrono flake). Before fix: ~6/8 POSTCONDITION failures. `FIND-3c99f5a3` replay (multi-codepoint emoji) still passes — no HARNESS driver regression. `nostra:quick` = 401/401 passing; fuzz vitest = 53/53 passing.
- **Artifacts**: [`docs/fuzz-reports/FIND-eef9f130/`](../fuzz-reports/FIND-eef9f130/)

#### FIND-bbf8efa8 — POST_react_multi_emoji_separate
- **Status**: fixed in Phase 2b.2a
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-19 21:01:57
- **Last seen**: 2026-04-19 21:01:57
- **Seed**: 101
- **Assertion**: "sender userB missing one of 👍,❤️,😂 on bubble 1776632512772244"
- **Replay**: `pnpm fuzz --replay=FIND-bbf8efa8` (passes after fix; previously failed at action 3 postcondition)
- **Minimal trace** (3 actions):
  1. `sendText({"from":"userA","text":"hi"})`
  2. `sendText({"from":"userA","text":"10B9|tl`k\"A"})`
  3. `reactMultipleEmoji({"user":"userB","emojis":["👍","❤️","😂"]})`
- **Root cause**: Two layered races surfaced by the rapid-fire 3-publish sequence: (1) `setReactionsChatAPI` was only called inside the fire-and-forget `initGlobalSubscription()`, so a `connect(peer)` that resolved first could overtake the wiring and every VMT-bridge `sendReaction` failed with `"ChatAPI not wired"`; (2) once wired, the render listener in `bubbles.ts` (registered before the cache-warmer in `nostra-reactions-local.ts`) read `getReactions()` synchronously before the warmer's async `getAll()` refresh completed — each of the 3 dispatches rendered the previous dispatch's snapshot, leaving the final DOM at 2/3 emojis.
- **Fix**: (1) Move `setReactionsChatAPI(this as any)` into the ChatAPI constructor so the publish module is wired before any async path can overtake it. (2) Add `NostraReactionsLocal.getReactionsFresh(peerId, mid)` which awaits a store refresh before returning; use it in the `nostra_reactions_changed` render listener in `bubbles.ts`. Scope: 3 files, 27 LOC. `src/lib/nostra/chat-api.ts`, `src/lib/nostra/nostra-reactions-local.ts`, `src/components/chat/bubbles.ts`.
- **Regression test**: `src/tests/fuzz/invariants/reactions.ts` — `INV-reaction-aggregated-render` (cheap tier) verifies all emojis from `reactMultipleEmoji.meta.emojis` are present in the sender bubble's `.reactions` after the postcondition settles. Vitest cases in `reactions.test.ts`.
- **Artifacts**: [`docs/fuzz-reports/FIND-bbf8efa8/`](../fuzz-reports/FIND-bbf8efa8/)

#### FIND-c0046153 — INV-bubble-chronological
- **Status**: fixed in Phase 2b.2a
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-19 20:59:13
- **Last seen**: 2026-04-19 20:59:13
- **Seed**: 48
- **Assertion**: "bubbles not chronological: idx 1=1776632351 > idx 2=1776632349"
- **Replay**: `pnpm fuzz --replay=FIND-c0046153` (9/9 runs pass after fix; previously reproduced ~40-50% of the time)
- **Minimal trace** (10 actions):
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
- **Root cause**: `BubbleGroups.sortItemsKey` was hardcoded to `'mid'` for non-Scheduled chats. For P2P peers, `generateTempMessageId` returns `topMessage + 1` when `topMessage >= 2^50` (FIND-cfd24d69 fix), encoding the PREVIOUS peer's second not the current one; the `message_sent` tempMid → realMid swap only updates `bubble.dataset.mid`, never `GroupItem.mid`/`itemsArr`, so DOM order reflects the stale tempMid sort.
- **Fix**: Commit this patch — switch `sortItemsKey`/`sortGroupsKey` to `'timestamp'`/`'lastTimestamp'` for P2P chats (`peerId >= 1e15`), mirroring `ChatType.Scheduled` behaviour. Scope: 1 file, 11 LOC. `src/components/chat/bubbleGroups.ts`.
- **Regression test**: `src/tests/fuzz/invariants/bubbles.test.ts` — `INV-bubble-chronological — FIND-c0046153 regression` (verifies the invariant detects the exact failing timestamp sequence).
- **Artifacts**: [`docs/fuzz-reports/FIND-c0046153/`](../fuzz-reports/FIND-c0046153/)

### Fixed in Phase 2b.1

#### FIND-e49755c1 — INV-mirrors-idb-coherent (architectural identity-triple fix)
- **Status**: fixed in Phase 2b.1
- **Tier**: medium
- **Occurrences**: 5
- **First seen**: 2026-04-19 11:32:44
- **Last seen**: 2026-04-19 19:31:45
- **Seed**: 48
- **Assertion**: "mirror mids not in idb on userA: 1776598357119890,1776598357119891"
- **Fix**: Commit `2426ec6d` — architectural invariant that `{eventId, mid, timestampSec, twebPeerId}` is immutable across all write paths. Removed 5 read-path `?? mapEventId` fallbacks, pinned `timestampSec` through the send pipeline, made `StoredMessage.mid`/`twebPeerId` required, added `INV-stored-message-identity-complete` medium-tier invariant + regression test suite (`src/tests/nostra/message-identity-triple.test.ts`).
- **Replay**: `pnpm fuzz --replay=FIND-e49755c1` (replay now hits a pre-existing Playwright SW env failure at action 1, before reaching the original `waitForPropagation` step; the `INV-mirrors-idb-coherent` signature no longer fires on seed=48 direct run).
- **Artifacts**: [`docs/fuzz-reports/FIND-e49755c1/`](../fuzz-reports/FIND-e49755c1/) (full audit in `audit-identity-triple.md`)

#### FIND-3c99f5a3 — POST-sendText-bubble-appears (multi-codepoint emoji)
- **Status**: fixed in Phase 2b.1
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-19 11:26:47
- **Last seen**: 2026-04-19 11:26:47
- **Seed**: 43
- **Assertion**: "sent bubble with text \"🔥🔥🔥\" never appeared on sender"
- **Fix**: Migrated fuzz messaging actions (`sendText`, `replyToRandomBubble`, `editRandomOwnBubble`) from Playwright `keyboard.type(...)` to `keyboard.insertText(...)`. `type` iterates UTF-16 code units and sends each half of a surrogate pair as a separate key event; `insertText` delivers the whole string atomically via CDP `Input.insertText`. See `docs/fuzz-reports/FIND-3c99f5a3/README.md` for full diagnosis.
- **Regression test**: `src/tests/nostra/emoji-send-regression.test.ts`.
- **Related**: Covers FIND-03f9ea6f (same root cause — `INV-sent-bubble-visible-after-send` on the same "🔥🔥🔥" trace) — both closed by the `insertText` migration.
- **Replay**: `pnpm fuzz --replay=FIND-3c99f5a3`
- **Artifacts**: [`docs/fuzz-reports/FIND-3c99f5a3/`](../fuzz-reports/FIND-3c99f5a3/)

### Fixed in Phase 2a overnight

#### FIND-9df3527d — POST-sendText-bubble-appears
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

#### FIND-f7b0117c — INV-sent-bubble-visible-after-send
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

#### FIND-2f61ff8b — INV-console-clean (Solid createRoot cleanup warning)
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

#### FIND-2fda8762 — INV-console-clean (reaction.ts center_icon TypeError)
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

#### FIND-7fd7bc72 — INV-console-clean (wrapSticker sticker TypeError)
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
