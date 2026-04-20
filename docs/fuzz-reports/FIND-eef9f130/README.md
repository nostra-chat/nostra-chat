# FIND-eef9f130 — POST-sendText-input-cleared (input retains text after send)

Status: **OPEN** (carry-forward to Phase 2b.2)
Tier: postcondition
Scope: Phase 2b.2 investigation

## Symptom

After the fuzz action `sendText` commits a message via
`keyboard.insertText('hello')` + Enter, the chat input `contenteditable`
still contains the string `"hello"` when the postcondition probes it:

```
chat input not cleared after send (still contains "hello")
```

From `failure.json`:
```
action: sendText
args: {from: "userA", text: "hello"}
meta.sentAt: 1776632588217
```

## Minimal trace (seed 102, iter 2)

1. `sendText({from:"userA",text:"$ JNnqb]s6"})`  — passes
2. `sendText({from:"userA",text:"hello"})`  — passes
3. `sendText({from:"userB",text:"uyim%{A:"})`
4. `deleteRandomOwnBubble({user:"userB"})`
5. `sendText({from:"userB",text:"test 123"})`
6. `replyToRandomBubble({from:"userA",text:"NJ"})`
7. `openRandomChat({user:"userA"})`
8. `sendText({from:"userA",text:"hello"})`  — FAILS on input-cleared postcondition

The first 2 sends of "hello" on userA succeed (input cleared). The 3rd
send (after a chat-switch) fails: input retains "hello" even after the
send pipeline returns.

## Likely cause

**Regression introduced by the `keyboard.insertText` migration for
FIND-3c99f5a3.** The fuzz action `sendText` previously used
`keyboard.type(text)` which synthesizes per-key `keydown`/`keypress`/
`input` events. tweb's contenteditable `onInput` handler clears the input
after its internal "send" pipeline runs when it observes the post-send
DOM reset via those `input` events.

`keyboard.insertText` instead injects the whole string via CDP
`Input.insertText`, which fires a single composition-ish sequence
(`compositionstart` → `compositionupdate` → `compositionend` → `input`).
tweb's handler may not wire `compositionend` to the same "clear on send"
path, so after Enter commits and `sendMessage` resolves, the DOM input
node keeps the original text.

The intermittent nature (first 2 sends of "hello" pass, 3rd fails after
a chat-switch) suggests a race: the chat-switch resets the editor state,
and the next insertText lands in a state where the composition-end
handler is wired, but the post-send clear fires BEFORE `insertText`
completes. By the time the postcondition reads the input, it sees the
incoming composition text re-asserting itself.

2b.2 triage plan:
1. Reproduce via `pnpm fuzz --replay=FIND-eef9f130 --headed --slowmo=500`
   and watch the DOM in devtools.
2. Instrument tweb's input-clear handler (`src/components/chat/input.ts`)
   with `console.debug` on every input/composition event.
3. Decide: either (a) switch the fuzz action to explicit
   `page.fill(selector, text)` which replaces contents atomically, or
   (b) fix tweb to clear input on `compositionend` + Enter as well.

Trade-off note: option (a) risks re-introducing the multi-codepoint emoji
bug (FIND-3c99f5a3) if `fill` routes through `keyboard.type` internally.
Playwright docs clarify it does not — `fill` uses
`Input.insertText` + explicit DOM value set. Worth verifying.

## Reproduction

```bash
pnpm fuzz --replay=FIND-eef9f130
```

## Artifacts

- `trace.json` — deterministic replay (8 actions)
- `failure.json` — failing action metadata + residual input text
- `console.log` — browser console output
- `dom-A.html` / `dom-B.html` — DOM snapshots showing input retaining "hello"
- `screenshot-A.png` / `screenshot-B.png` — viewport

## Triage (2b.2a session)

- **Replay status**: NOT INDEPENDENTLY REPRODUCED — replay intercepted by FIND-c0046153 (log: `/tmp/repro-eef9f130.log`)
- **Reproduction note**: The 8-action trace includes interleaved userA/userB sends (actions 1-3), which trigger `INV-bubble-chronological` at action 3 (`deleteRandomOwnBubble` skipped check point) before the replay reaches action 8 (`sendText "hello"` — the actual POST-sendText-input-cleared trigger). The chronological bug (FIND-c0046153) masks this FIND's reproduction. Fixing c0046153 first is a prerequisite for independent eef9f130 replay.
- **Verdict**: TBD at M5 triage (decided via manual sanity in Task 4, after FIND-c0046153 is fixed in Task 2). Original finding is valid per Phase 2b.1 capture; this session cannot independently confirm.
- **Hypothesis selected**: HARNESS (default) — `keyboard.insertText` composition sequence bypasses tweb's input-clear handler on the 3rd send after a chat-switch. Confirmed hypothesis (PROD vs HARNESS) deferred to Task 4 manual investigation once c0046153 is fixed and replay reaches action 8.
- **Planned fix scope**: `src/tests/fuzz/actions/messaging.ts` (HARNESS branch — switch to `page.fill`) OR `src/components/chat/input.ts` (PROD branch — clear on `compositionend` + Enter).
- **Time-box**: 2h (after c0046153 fix). Escape: downgrade `POST-sendText-input-cleared` postcondition to `skip: true` with TODO, carry-forward to 2b.2b.
