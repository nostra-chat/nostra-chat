# FIND-3c99f5a3 — multi-codepoint emoji sendText

## Symptom

`pnpm fuzz --replay=FIND-3c99f5a3` fails on:

```
POST-sendText-bubble-appears: sent bubble with text "🔥🔥🔥" never appeared on sender
```

Action sequence (from `trace.json`, seed 43): 4 skipped setup actions, then
`openRandomChat({user: "userB"})` at index 4, then `sendText({from: "userA", text: "🔥🔥🔥"})`
at index 5 which fails.

## Diagnosis — Hypothesis A confirmed

Evidence from the captured artifacts:

| Probe | Result | Interpretation |
|---|---|---|
| `grep -c "🔥" dom-A.html` | `0` | Emoji is nowhere in the DOM — not as text, not as anything. |
| `grep -i "emoji-image\|alt=\"🔥\"\|emoji" dom-A.html` | `0` | Not rendered as `<img alt="🔥">` either. Rules out Hypothesis B. |
| `grep -c "🔥" console.log` | `0` | No `sendMessage`/`chatAPI.send` ever logged the emoji string. |

If tweb had accepted the input and rendered it as `<img alt="🔥">` (Hypothesis B),
we would see `emoji-image` class / `alt="🔥"` in `dom-A.html`. Zero occurrences.
If tweb had rejected an emoji-only message on the server side (Hypothesis C),
we would see at least the outgoing text once in `console.log` or in the input
field. Also zero.

The only explanation left is that the emoji **never entered the input** in the
first place. This matches the known Playwright gotcha with
`keyboard.type()`: it iterates the string by UTF-16 code unit and presses
each unit as a separate key event. U+1F525 🔥 is a surrogate pair (`0xD83D
0xDD25`); pressing each half as a standalone key on a contenteditable
produces no usable input (browser drops orphan surrogates).

**Hypothesis A confirmed.** Fix: replace `keyboard.type()` with
`keyboard.insertText()`, which inserts the full string atomically via
`Input.insertText` (no per-key translation).

## Fix

### Primary (messaging actions)

`src/tests/fuzz/actions/messaging.ts` — replace all 3 `keyboard.type(...)`
calls with `keyboard.insertText(...)`:

- `sendText` (line ~42)
- `replyToRandomBubble` (line ~104)
- `editRandomOwnBubble` (line ~153)

`insertText` is the standard recommendation for multi-codepoint strings (see
Playwright docs on `keyboard.insertText` vs `keyboard.type`).

### Secondary (defensive postcondition)

`src/tests/fuzz/postconditions/messaging.ts` `POST_sendText_bubble_appears` —
extend bubble text extraction to concat `img[alt]` attributes. Even though
the current DOM evidence shows emoji is not rendered as `<img>` here, this
is a forward-compatibility guard: if native-emoji gets turned off or a
custom emoji pack ships, the postcondition would otherwise start failing
spuriously on emoji-containing messages.

### Regression test

`src/tests/nostra/emoji-send-regression.test.ts` — Vitest (jsdom) unit that
validates the extraction logic handles three cases:
- `<img alt="🔥">` only (img-rendered emoji)
- mixed text + img
- plain-text emoji
- strips `.time/.reactions/.bubble-pin` before extracting

Run: `npx vitest run src/tests/nostra/emoji-send-regression.test.ts`.

## Verification plan

The definitive check is `pnpm fuzz --replay=FIND-3c99f5a3`, which should now
pass: the emoji enters the input via `insertText`, the send button commits,
the outgoing bubble renders with the emoji (either as text or `<img alt>`),
and the postcondition's `fullText` contains `"🔥🔥🔥"`.

Replay not run in this session — dev server unavailable. Task 21 (v2b1
baseline emit) will exercise the fuzzer end-to-end and confirm the fix.

Unit gate: `npx vitest run src/tests/nostra/emoji-send-regression.test.ts`
should be green; `npx tsc --noEmit` should be clean.
