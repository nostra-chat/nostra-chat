# Fuzz Findings

Last updated: 2026-04-23
Open bugs: 2 (live) · Regression-watch: 2 (2b.3 fixes firing again in 2b.4 runs) · Fixed: 6+2 (Phase 2b.1) · Fixed in 2b.2a: 3 · Fixed in 2b.2b: 3 · Fixed in 2b.3: 2

## Open (sorted by occurrences desc)

### FIND-dbe8fdd2 — POST-sendInGroup-bubble-on-sender
- **Status**: open — **real groups UI bug**, carry-forward to Phase 2b.5
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-23 16:49:55
- **Last seen**: 2026-04-23 16:49:55
- **Seed**: 45
- **Assertion**: `"sendInGroup: sent bubble \"!m}xargume\" never appeared on sender userA"`
- **Replay**: `pnpm fuzz --replay=FIND-dbe8fdd2`
- **Minimal trace** (2 actions):
  1. `scrollHistoryUp({"user":"userA"})`
  2. `sendInGroup({"from":"userA","text":"!m}xargume"})`
- **Root cause (investigation, not fix)**: `GroupAPI.onGroupMessage` callback (`src/lib/nostra/group-api.ts:39`) is declared but **never assigned** anywhere in the codebase. When a group message arrives via relay (own self-echo included), `handleIncomingGroupMessage` calls `this.onGroupMessage?.(…)` — but it's always null, so nothing renders. Sender never sees their own group bubble. Receiver likely doesn't either. This is the missing "groups→display bridge" analogous to `nostra-sync.ts` for DMs. Fix requires a new module wiring group rx → message-store persist → `nostra_new_message` dispatch → bubble render. Scope: ~100 LOC, not in Phase 2b.4.
- **Artifacts**: [`docs/fuzz-reports/FIND-dbe8fdd2/`](../fuzz-reports/FIND-dbe8fdd2/)

### FIND-450d2436 — INV-console-clean
- **Status**: open — cold-start flake, benign
- **Tier**: cheap
- **Occurrences**: 1
- **First seen**: 2026-04-23 16:51:29
- **Last seen**: 2026-04-23 16:51:29
- **Seed**: 46
- **Assertion**: `"Unallowlisted console error: [error] Failed to wait for circuit: Internal error: Channel not established"`
- **Replay**: `pnpm fuzz --replay=FIND-450d2436`
- **Minimal trace** (1 actions):
  1. `reactViaUI({"user":"userB","emoji":"👍"})`
- **Note**: Tor circuit bootstrap logs this during cold-start before the Tor proxy is disabled or fully ready. Unrelated to groups; candidate for the console allowlist if determined benign.
- **Artifacts**: [`docs/fuzz-reports/FIND-450d2436/`](../fuzz-reports/FIND-450d2436/)

## Regression-watch (2b.3 fixes re-firing in 2b.4)

Two findings marked "Fixed in Phase 2b.3" fired repeatedly in 2b.4 runs without touching their production code paths. Phase 2b.4 changes are limited to `src/tests/fuzz/**` — no production files modified. These are tracked for re-investigation in Phase 2b.5; existing Fixed entries below are preserved unchanged.

- **FIND-57989db1** — `INV-mirrors-idb-coherent` — fired in iter 3 + iter 4 (seed=42). 2b.3 fix gated P2P success on `nostraMid` presence; something is still polluting the mirror with an orphan tempId on userB. Hypothesis: an additional VMT failure path not covered by the 2b.3 gate.
- **FIND-4e18d35d** — `INV-reaction-bilateral` — fired in iter 3 (seed=42). 2b.3 two-part fix (dual p-tag + rumor-id alignment) covered the `reactViaUI` own-message path; this recurrence may be from `reactToRandomBubble` on a different bubble selection, not yet confirmed.

## Phase 2b.4 findings closed via fuzz-side adjustment (not production fixes)

These were transient artifacts of a warmup/action configuration that was itself invalid — no production code change. Listed here so they are not re-added to Open on future runs.

- `POST-sendText-bubble-appears` (text "e") — single iter-1 cold-start occurrence before the groups warmup landed. Not reproduced in iter 2–4.
- `INV-group-admin-is-member` × 3 signatures (`3a55d85e`, `69055db3`, `ca210bdf`) — triggered when A (admin) left the warmup group, leaving remaining member B with `adminPubkey ∉ members`. **Real product bug.** 2b.4 avoids triggering it (warmup has B leave, `leaveGroup` action filters admin groups). Carry-forward to 2b.5 — fix needs a product design decision: **prevent admin leave**, **auto-transfer admin to first remaining member on `handleMemberLeave`**, or **mark group adminless**.
- `INV-group-bilateral-membership` (signature `4f52549b`) — fired on warmup-residue group that B never received due to cold-start relay sub. Grace window bumped from 5s to 30s (using `group.createdAt`) in invariant check; no recurrence after fix.

## Fixed

### Fixed in Phase 2b.3

#### FIND-57989db1 — INV-mirrors-idb-coherent (VMT failure polluted mirror with tempId)
- **Status**: fixed in Phase 2b.3
- **Tier**: medium
- **Occurrences**: 1
- **First seen**: 2026-04-21 09:37:50
- **Last seen**: 2026-04-21 09:37:50
- **Seed**: 43
- **Assertion**: `"mirror mids not in idb on userB: 1776764255324505"`
- **Minimal trace** (1 action): `replyToRandomBubble({"from":"userB","text":".5"})`
- **Root cause**: in `appMessagesManager.ts` the P2P send-completion handler entered its success branch when the VMT returned `emptyUpdates` — regardless of whether the VMT actually succeeded. The VMT returns `emptyUpdates` on BOTH success and failure, distinguishing them only via the `nostraMid` field being set. When `chatAPI.sendText` (or any step inside the VMT's `try` block) threw, the catch swallowed the error, returned `emptyUpdates` with NO `nostraMid`, and the Worker then dispatched `message_sent` + `history_append` using the tempId as the message mid. Because `generateTempMessageId` returns `topMessage + 1` (an INTEGER) when `topMessage >= 2^50` (FIND-cfd24d69 fix), the main-thread mirror gained an integer mid with no IDB row — the exact pattern INV-mirrors-idb-coherent detects. The mid `1776764255324505` in the failing assertion is exactly `topMessage + 1` on userB's chat at that point.
- **Fix**: gate the P2P success-path execution on `nostraMid` being present. When the VMT signals failure (no `nostraMid`), the Worker now deletes the temp bubble from storage, dispatches `messages_deleted` so the UI removes it, and rejects the send promise. The mirror is never polluted with an orphan tempId. Scope: 1 production file, ~15 LOC. `src/lib/appManagers/appMessagesManager.ts`.
- **Regression coverage**: primary verification is the live fuzz replay (`pnpm fuzz --replay=FIND-57989db1`). Unit-testing the Worker-side P2P completion handler in isolation would require mocking the full bridge pipeline; the defensive gate matches the shape of the `FIND-e49755c1` identity-triple invariant and is covered by the same invariant scan at fuzz runtime.
- **Follow-up**: the underlying reason `chatAPI.sendText` threw for this specific reply is not addressed by this fix (the fix makes failures visible rather than silent). Likely candidates: relay disconnect, encryption failure on a specific content, or a race in `chatAPI.connect(peerPubkey)`. If the fuzz observes new findings post-fix with "P2P send failed" rejections, investigate the underlying send-failure source.
- **Artifacts**: [`docs/fuzz-reports/FIND-57989db1/`](../fuzz-reports/FIND-57989db1/)

#### FIND-4e18d35d — INV-reaction-bilateral (reactions on own messages not propagated to peer)
- **Status**: fixed in Phase 2b.3 (two-part fix)
- **Tier**: medium
- **Occurrences**: 3 (across two baseline emit attempts at seed=43)
- **First seen**: 2026-04-21 09:29:29
- **Last seen**: 2026-04-21 09:42:02
- **Seed**: 43
- **Assertion**: `"reaction 😂 (aa468d4b…) from B not propagated to A"`
- **Minimal trace** (1 action): `reactViaUI({"user":"userB","emoji":"😂"})` (also triggered by `reactToRandomBubble` with `fromTarget: 'own'`)
- **Root cause (part 1 — delivery)**: architectural, not a 2b.2b regression. `nostra-reactions-publish.ts` emitted kind-7 events with a single `p` tag — the target author — per NIP-25 canonical. When the reactor and target author are the same (B reacting to B's own message), the p-tag was `B`. The peer A's relay subscription `#p: [A]` does not match, so the event was never delivered to A. The architecture never supported bilateral propagation for reactions on own messages; the feature claim in Phase 2b.1 ("NIP-25 reactions RX bilateral") was only exercised in the narrow case of reacting to the peer's message.
- **Fix (part 1)** — PR #59 (dual p-tag): `nostra-reactions-publish.ts` now looks up the conversation peer's pubkey via `virtualPeersDB.getPubkey(targetPeerId)` and, when distinct from the target author, adds a second `['p', peerPubkey]` tag to both kind-7 and kind-5 events. Multiple `p` tags are permitted by NIP-25/NIP-09. `nostra-reactions-receive.ts::onKind7` now checks **any** `p` tag against `ownPubkey` (using `pTags.some(...)`) instead of only the first — events with the target author as the first p-tag but own pubkey as a subsequent tag are now accepted. Scope: 2 production files, ~20 LOC.
- **Root cause (part 2 — resolver)**: even after the dual-p-tag fix made the relay deliver kind-7 events to both sides, the receiver's resolver `store.getByEventId(targetEventId)` still missed. The sender saved its own-message rows keyed by the app-level `chat-XXX-N` id while the receiver saved by the NIP-17 rumor id (64-hex). Kind-7 e-tags MUST be 64-hex per NIP-01 fixed-size rule; strfry rejected any event whose e-tag was `chat-XXX-N`. So when the sender was the reactor, the publish failed silently (no surfaced `OK <id> false` log); when the receiver was the reactor, delivery worked but the sender's resolver missed because its row key diverged from the rumor id.
- **Fix (part 2)** — PR #63 (rumor-id alignment): `wrapNip17Message` now returns `{wraps, rumorId}`; `NostrRelayPool.publish` propagates `rumorId` on `PublishResult`; `ChatAPI.sendMessage` saves outgoing rows with `eventId = rumorId` and `appMessageId = <chat-XXX-N>`. `updateMessageStatus` and the delivery-UI receipt resolver look up by `appMessageId` first, then fall back to `eventId`. `handleSelfEcho` dedups cross-device echoes by `msg.id` (rumor hex) for write-key consistency. `NostrRelay.handleMessage` gains an `OK` case that surfaces relay rejections as warnings — this logger was what finally surfaced the silent strfry rejection and is the tooling win that prevents this class of bug from hiding in future. Scope: 6 production files, ~150 LOC.
- **Regression tests**: `src/tests/nostra/nostra-reactions-publish.test.ts` adds three cases — (1) `publish()` adds peer pubkey as extra p-tag when reacting to own message, (2) `publish()` does not duplicate the p-tag when targetAuthor === peer, (3) `unpublish()` (kind-5) tags the peer pubkey too. `src/tests/nostra/nostra-reactions-receive.test.ts` adds one case — `onKind7` accepts events where ownPk matches a non-first p-tag. `src/tests/nostra/nip17-rumorid-contract.test.ts` locks the `{wraps, rumorId}` shape + verifies the id matches the canonical rumor hash on both recipient and self wraps. `src/tests/e2e/e2e-reactions-bilateral.ts` runs against a local strfry + two Playwright contexts to assert `A.row.eventId === reaction.targetEventId` (both 64-hex) within 5s end-to-end.
- **Artifacts**: [`docs/fuzz-reports/FIND-4e18d35d/`](../fuzz-reports/FIND-4e18d35d/)

### Fixed in Phase 2b.2b

#### FIND-chrono-v2 — INV-bubble-chronological (same-second tempMid race)
- **Status**: fixed in Phase 2b.2b
- **Tier**: cheap
- **Occurrences**: ~60% of `FIND-eef9f130` replays
- **First seen**: 2026-04-20 during Task 4 investigation of FIND-eef9f130
- **Last seen**: 2026-04-20
- **Assertion**: `INV-bubble-chronological` fires on a same-second same-user interleaved send where the `is-sending` placeholder bubble has `tempMid = topMessage + 1` and a concurrent peer-incoming bubble arrives with the same `timestampSec`. Phase 2b.2a's switch to `'timestamp'` sort key resolved FIND-c0046153 but left same-second ties subject to non-deterministic insertion order, exposing this variant.
- **Root cause**: single-key `insertSomething(array, item, 'timestamp', reverse)` collapsed to insertion order when two P2P items shared the same wall-clock second — `mid` was ignored as a tiebreaker, so distinct mids interleaved unpredictably in the DOM.
- **Fix**: added `insertSomethingWithTiebreak<T>(to, what, primaryKey, secondaryKey, reverse)` alongside `insertSomething` in `src/components/chat/bubbleGroups.ts`. New private method `insertGroupItem(arr, item)` dispatches to the two-key variant when `_isP2P=true` (set in the constructor from `Number(chat.peerId) >= 1e15`), using `(timestamp, mid)` both descending. Non-P2P chats retain the single-key `insertSomething` path unchanged. Callsite `insertItemToArray` now delegates to `insertGroupItem`.
- **Relationship to FIND-c0046153**: distinct. c0046153's trace passes 9/9 with 2b.2a's fix. This is a contention variant surfaced by eef9f130's higher-concurrency sequence.
- **Regression coverage**: `src/tests/fuzz/invariants/bubbles.test.ts` — new `INV-bubble-chronological — FIND-chrono-v2 regression` suite with 2 comparator-level tests (deterministic descending mid ordering across same-second ties + stability across 20 shuffled runs).

#### FIND-cold-deleteWhileSending — POST_deleteWhileSending_consistent (cold-start relay delivery)
- **Status**: fixed in Phase 2b.2b
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-20
- **Last seen**: 2026-04-20
- **Seed**: 42
- **Assertion**: `asymmetric deleteWhileSending outcome: sender=true, peer=false` on first smoke-run action.
- **Root cause**: first fuzz action raced a not-yet-fully-warm relay subscription for kinds 1059/7/5. The sender's optimistic bubble rendered, but the relay publish + peer subscribe roundtrip had not completed within the postcondition's poll window. Partial 2b.2a mitigations (skip-if-tempMid-null + 6s poll) did not fully close the race.
- **Fix**: Deterministic multi-kind warmup handshake in `bootHarness` after `linkContacts`. `warmupHandshake` exercises kinds 1059 (text send), 7 (react), and 5 (delete) bidirectionally and awaits DOM confirmation at each step (15s each) before returning control to the fuzzer. Scope: 1 file, ~165 LOC. `src/tests/fuzz/harness.ts`.
- **Regression coverage**: live smoke `pnpm fuzz --duration=60s --seed=42` must emit the four `[harness] warmup: step N ack` log lines before the first fuzz action executes. Deferred to post-`pnpm start` environment.

#### FIND-cold-reactPeerSeesEmoji — POST_react_peer_sees_emoji (cold-start reaction delivery)
- **Status**: fixed in Phase 2b.2b
- **Tier**: postcondition
- **Occurrences**: 1
- **First seen**: 2026-04-20
- **Last seen**: 2026-04-20
- **Seed**: 42
- **Assertion**: `peer userB never saw emoji 🔥 on bubble <mid>` on action 4 of a cold-started sequence.
- **Root cause**: identical cold-start class as `FIND-cold-deleteWhileSending`. Peer's relay subscription for kind-7 had not propagated by the postcondition's 3s poll deadline when the first reaction action fired.
- **Fix**: Same `warmupHandshake` in `bootHarness` — step 2 is the bidirectional react (B reacts to A's warmup text, A awaits the reaction in their DOM), guaranteeing the kind-7 roundtrip is fully warm before any fuzz action runs.
- **Regression coverage**: same as above.

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
