# FIND-2fda8762 — INV-console-clean (reaction.ts center_icon TypeError)

**Status**: reproduced (inconclusive on replay — requires guard fix in 2b.1)
**Phase 2a-closing commit (if applicable)**: n/a — deferred to Phase 2b.1
**Phase 2b.1 decision**: fix-in-2b1-commit-<sha> (Task 11: "Fix tweb reaction.ts guard crashes")

## Original assertion

```
[pageerror] Cannot read properties of undefined (reading 'center_icon')
TypeError: Cannot read properties of undefined (reading 'center_icon')
    at http://localhost:8090/src/components/chat/reaction.ts?t=1776497147834:205:33
    at async Promise.all (index 0)
```

**Exact crash site**: `src/components/chat/reaction.ts:205:33` — dereferences
an `availableReaction` (or equivalent descriptor) without a null-guard
when `deleteRandomOwnBubble` runs against a bubble whose reaction
metadata was already collected/disposed by the time the async
`Promise.all` resolves. The missing descriptor has no `center_icon`
sticker field, hence the TypeError.

**Triggering action**: `deleteRandomOwnBubble` on userB with
`deletedMid: "1776499539063110"`.

## Replay outcome (post-2a main)

Ran `FUZZ_APP_URL=http://localhost:8080 pnpm fuzz --replay=FIND-2fda8762`
on 2026-04-19 against branch `fuzz-phase-2b1` (tip 32e869f0).

The replay aborted at action 1 (`replyToRandomBubble`) on an unrelated
environmental console warning (webtor wasm preload timing) before
reaching the `deleteRandomOwnBubble` action that originally triggered
the crash. Cannot confirm-or-deny reproduction from this replay alone.

Because the underlying code path at `reaction.ts:205` has NOT been
modified since 2a (no guard added), the crash is expected to reproduce
once the environmental noise is resolved or a targeted E2E test is
written. Phase 2b.1 Task 11 will add the guard; this FIND closes when
that ships.
