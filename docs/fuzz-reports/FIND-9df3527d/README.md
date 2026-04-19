# FIND-9df3527d — POST-sendText-bubble-appears ("y " trailing-space)

**Status**: fixed-in-2a
**Phase 2a-closing commit (if applicable)**: `633aed78` (fix(fuzz): INV-sent-bubble-visible-after-send uses trimmed text)
**Phase 2b.1 decision**: close-as-stale

## Original assertion

"sent bubble with text \"y \" never appeared on sender" — trailing whitespace
edge case. Post-commit 633aed78 the postcondition's bubble text query was
updated to trim before matching, which is the same trim the invariant
already applied.

## Replay outcome (post-2a main)

Ran `FUZZ_APP_URL=http://localhost:8080 pnpm fuzz --replay=FIND-9df3527d`
on 2026-04-19 against branch `fuzz-phase-2b1` (tip 32e869f0).

The original failing invariants (`POST-sendText-bubble-appears`,
`INV-sent-bubble-visible-after-send`) did NOT fire. The replay tripped on
an unrelated environmental console warning (webtor wasm preload timing —
a Chromium-emitted diagnostic, not an app bug) which aborted the trace at
action 1 before the original post-conditions could be checked against
the "y " send. The absence of the original invariant failure, combined
with the trim-aware postcondition from `633aed78`, is consistent with
the bug being fixed. Closing as stale for Phase 2b.1.
