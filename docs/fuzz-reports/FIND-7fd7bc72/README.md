# FIND-7fd7bc72 — INV-console-clean (wrapSticker sticker TypeError)

**Status**: reproduced (inconclusive on replay — requires guard fix in 2b.1)
**Phase 2a-closing commit (if applicable)**: n/a — deferred to Phase 2b.1
**Phase 2b.1 decision**: fix-in-2b1-commit-<sha> (Task 11: "Fix tweb reaction.ts guard crashes")

## Original assertion

```
[pageerror] Cannot read properties of undefined (reading 'sticker')
TypeError: Cannot read properties of undefined (reading 'sticker')
    at wrapSticker (http://localhost:8090/src/components/wrappers/sticker.ts:72:27)
    at wrapStickerAnimation (http://localhost:8090/src/components/wrappers/stickerAnimation.ts:53:26)
    at onAvailableReaction (http://localhost:8090/src/components/chat/reaction.ts?t=1776499561809:419:23)
    at http://localhost:8090/src/components/chat/reaction.ts?t=1776499561809:576:16
```

**Exact crash site**: `src/components/wrappers/sticker.ts:72:27` —
`wrapSticker` dereferences `.sticker` on an undefined descriptor. Call
chain: `reaction.ts:576` → `reaction.ts:419 (onAvailableReaction)` →
`stickerAnimation.ts:53 (wrapStickerAnimation)` → `sticker.ts:72:27`.
The same family of missing-descriptor bug as FIND-2fda8762 but tripping
the sticker wrapper rather than the center_icon path.

**Triggering action**: `scrollHistoryUp` on userA (reaction preload runs
during scroll as bubbles enter viewport).

## Replay outcome (post-2a main)

Ran `FUZZ_APP_URL=http://localhost:8080 pnpm fuzz --replay=FIND-7fd7bc72`
on 2026-04-19 against branch `fuzz-phase-2b1` (tip 32e869f0).

The replay aborted at action 1 (`sendText`) on an unrelated
environmental console warning (webtor wasm preload timing) before
reaching the `scrollHistoryUp` action that originally triggered
the crash. Cannot confirm-or-deny reproduction from this replay alone.

Because the underlying code at `sticker.ts:72` and `reaction.ts:419`
has NOT been modified since 2a (no availableReaction guard added), the
crash is expected to reproduce once the environmental noise is resolved
or a targeted E2E test is written. Phase 2b.1 Task 11 will add the
guard; this FIND closes when that ships.
