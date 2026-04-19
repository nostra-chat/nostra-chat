# FIND-9df3527d — POST-sendText-bubble-appears ("y " trailing-space)

**Status**: closed-stale-verified-in-2b1
**Phase 2a-closing commit**: `633aed78` (fix(fuzz): INV-sent-bubble-visible-after-send uses trimmed text)
**Phase 2b.1 decision**: verified-closed via code inspection (replay blocked by environmental webtor preload warning — known issue from Task 1 triage)

## Original assertion

"sent bubble with text \"y \" never appeared on sender" — trailing whitespace
edge case. Post-commit 633aed78 the postcondition's bubble text query was
updated to trim before matching, which is the same trim the invariant
already applied.

## Phase 2b.1 re-verification (2026-04-19, tip 5db6121c)

Replay step skipped in Phase 2b.1 — the same environmental webtor wasm
preload warning that blocked Task 1 replays continues to abort traces at
action 1 before the originally-failing action fires. Re-verification was
performed via code inspection instead:

1. `src/tests/fuzz/postconditions/sendText.ts` — `POST-sendText-bubble-appears`
   performs `text.trim()` before querying the bubble, matching the trim
   tweb applies on render. This is the fix shipped in `633aed78`.
2. `src/tests/fuzz/invariants/bubbles.ts` — `INV-sent-bubble-visible-after-send`
   applies the same trim (sibling fix in the same commit, cross-referenced
   by FIND-f7b0117c).
3. The Phase 2b.1 reactions refactor (Tasks 2-12) did NOT touch the
   text-send path (`sendText` action, `POST-sendText-bubble-appears`
   postcondition, or `INV-sent-bubble-visible-after-send` invariant), so
   the `633aed78` fix remains in force.

No new code change required. Closing as stale-verified for Phase 2b.1.
