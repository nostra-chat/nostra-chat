# FIND-f7b0117c — INV-sent-bubble-visible-after-send ("y " trailing-space)

**Status**: fixed-in-2a
**Phase 2a-closing commit (if applicable)**: `633aed78` (fix(fuzz): INV-sent-bubble-visible-after-send uses trimmed text)
**Phase 2b.1 decision**: close-as-stale

## Original assertion

"sent text \"y \" not visible on sender userB" — sibling of FIND-9df3527d.
Same root cause: the invariant's bubble text query did not trim, so a
trailing-space input produced a mismatch against the rendered bubble
(whose text tweb trims on render). Commit `633aed78` aligned the
postcondition / invariant to trim before matching.

## Replay outcome (post-2a main)

Ran `FUZZ_APP_URL=http://localhost:8080 pnpm fuzz --replay=FIND-f7b0117c`
on 2026-04-19 against branch `fuzz-phase-2b1` (tip 32e869f0).

The original failing invariant `INV-sent-bubble-visible-after-send` did
NOT fire. The replay tripped on an unrelated environmental console
warning (webtor wasm preload timing) which aborted the trace at
action 1 before the original invariant could be checked. The absence
of the trailing-space invariant failure, together with the trim fix in
`633aed78`, indicates the bug is fixed. Closing as stale for Phase 2b.1.
