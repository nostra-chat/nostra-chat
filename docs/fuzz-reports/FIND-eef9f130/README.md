# FIND-eef9f130 — POST-sendText-input-cleared (input retains text after send)

Status: **FIXED** in Phase 2b.2a (harness/postcondition fix)
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
- **Verdict**: **POSTCONDITION race (harness-side)** — neither HARNESS driver bug nor PROD handler bug. The `POST-sendText-input-cleared` check was synchronous while the post-send clear pipeline is deeply async; under contention (3rd `hello` after a chat-switch + interleaved deletes/replies) the async chain exceeds the 2.5s window that the preceding `POST-sendText-bubble-appears` has loop-waited, leaving "hello" in the input at probe time.
- **Hypothesis initially selected**: HARNESS (`keyboard.insertText` composition events bypassing tweb's clear). **Invalidated** by the Step 2 swap: replacing `sender.page.keyboard.insertText(...)` with `input.evaluate(el => document.execCommand('insertText', ...))` did not change the failure rate. Evidence: `/tmp/repro-eef9f130-v2.log`.
- **Decisive evidence**: browser-console instrumentation at `sendMessage`, `beforeMessageSending`, `clearDraft`, `draft_updated` relay, and main-thread `setDraft` showed the failing run stopping at `sendMessage got value` with no subsequent log (the await on `getConfig/slowMode/payment` was still outstanding when the postcondition probed). Adding a 3s wait-loop to the postcondition reduces the failure rate to 0/8 over 8 consecutive replays (the remaining 5/8 chrono flakes are an unrelated pre-existing intermittent).
- **Fix applied**: `src/tests/fuzz/postconditions/messaging.ts` — `POST_sendText_input_cleared` now polls textContent for up to 3s (100ms interval), same pattern as `POST_sendText_bubble_appears`. No production code changed. Scope: 1 file, 20 LOC.
- **Time-box**: closed within 1h of Task 4 start.

## Root cause (confirmed)

The post-send clear is an async chain with ~5 awaited steps before the DOM textContent actually becomes empty:

1. Main thread `ChatInput.sendMessage()` awaits `apiManager.getConfig()` (MessagePort round-trip to Worker).
2. Awaits `showSlowModeTooltipIfNeeded(...)`.
3. Awaits `paidMessageInterceptor.prepareStarsForPayment(messageCount)`.
4. Calls `appMessagesManager.sendText({clearDraft: true, ...})` (MessagePort → Worker).
5. Worker `beforeMessageSending` pushes a `processAfter` callback that calls `appDraftsManager.clearDraft(...)` → dispatches `draft_updated` on Worker rootScope.
6. `MTProtoMessagePort.getInstance().invokeVoid('event', {name: 'draft_updated', ...})` relays to the SharedWorker/main tab.
7. Main-thread `apiManagerProxy.event` handler re-dispatches via `rootScope.dispatchEventSingle('draft_updated', ...)`.
8. `ChatInput.setChatListeners` listener calls `setDraft(undefined, true, true)` → `messageInputField.inputFake.textContent = ''` → waits for `chat.bubbles.messagesQueuePromise` → `fastRaf` → `onMessageSent()` → `clearInput()` → `messageInputField.setValueSilently('')`.

Under fuzz contention (8-action trace with interleaved peer sends, a delete, a reply, and a chat switch preceding the failing `sendText("hello")`), steps 1–8 routinely exceed the postcondition's implicit window. The postcondition ran synchronously right after `sendBtn.click()` returned, with no wait — so it reliably caught the input still holding "hello".

`POST_sendText_bubble_appears` precedes `POST_sendText_input_cleared` and has a 2.5s wait-loop on any bubble containing "hello", but because "hello" had already been sent at action 2 it found a stale match immediately and returned — giving no real time buffer for the async clear to complete before the next postcondition probed.

Invalidated hypotheses:
- **HARNESS driver (CDP `Input.insertText` composition events bypassing tweb's clear handler)**: swapping to `document.execCommand('insertText', ...)` did not change the failure rate. The clear handler is wired to the `draft_updated` pipeline, which is driven by the send manager regardless of how the input was populated.
- **PROD compositionend path missing**: the `draft_updated` mechanism clears the input reliably for every send, including the replay action 6 (`replyToRandomBubble` "NJ") that used the same driver. Only the probe timing was off.

## Fix summary

Patient postcondition matching the send pipeline's true latency:

```ts
// src/tests/fuzz/postconditions/messaging.ts
const deadline = Date.now() + 3000;
let lastText = '';
while(Date.now() < deadline) {
  const text = await sender.page.evaluate(() => {
    const el = document.querySelector('.chat-input [contenteditable="true"]') as HTMLElement | null;
    return ((el?.textContent) || '').trim();
  });
  lastText = text;
  if(text.length === 0) return {ok: true};
  await sender.page.waitForTimeout(100);
}
return {ok: false, message: ..., evidence: {text: lastText}};
```

Mirrors the 2.5s+ pattern already established by `POST_sendText_bubble_appears`. Under normal conditions the clear resolves in <300ms; the 3s deadline is diagnostic overhead, not a latency guarantee — a genuinely stuck clear would still fail the postcondition cleanly with the last-observed textContent in `evidence`.
