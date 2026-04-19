# FIND-f7b0117c — INV-sent-bubble-visible-after-send ("y " trailing-space)

**Status**: closed-stale-verified-in-2b1
**Phase 2a-closing commit**: `633aed78` (fix(fuzz): INV-sent-bubble-visible-after-send uses trimmed text)
**Phase 2b.1 decision**: verified-closed via code inspection (replay blocked by environmental webtor preload warning — known issue from Task 1 triage)

## Original assertion

"sent text \"y \" not visible on sender userB" — sibling of FIND-9df3527d.
Same root cause: the invariant's bubble text query did not trim, so a
trailing-space input produced a mismatch against the rendered bubble
(whose text tweb trims on render). Commit `633aed78` aligned the
postcondition / invariant to trim before matching.

## Phase 2b.1 re-verification (2026-04-19, tip 5db6121c)

Replay step skipped in Phase 2b.1 — same environmental webtor wasm
preload warning as Task 1 continues to abort traces at action 1 before
the originally-failing action fires. Re-verification via code inspection:

1. `src/tests/fuzz/invariants/bubbles.ts:96-123` — `INV-sent-bubble-visible-after-send`
   applies `String(action.args.text).trim()` at line 103 before querying
   the sender's bubble DOM. This is the fix shipped in `633aed78`.
2. `src/tests/fuzz/postconditions/messaging.ts:4-31` — sibling
   `POST-sendText-bubble-appears` carries the same trim (confirmed by
   FIND-9df3527d code inspection).
3. The Phase 2b.1 reactions refactor (Tasks 2-12) did NOT touch the
   `sendText` path or `INV-sent-bubble-visible-after-send`, so
   `633aed78` remains in force.

No new code change required. Closing as stale-verified for Phase 2b.1.
