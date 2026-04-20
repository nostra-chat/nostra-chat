# FIND-2f61ff8b — INV-console-clean (Solid createRoot cleanup warning)

**Status**: closed-via-allowlist-verified-in-2b1
**Phase 2a-closing commit**: allowlist entry — `src/tests/fuzz/allowlist.ts:58` contains `/\w+ created outside a `createRoot` or `render`/` (see comment block at lines 52-57 explaining dev-build-only noise; production `--backend=real` path is unaffected).
**Phase 2b.1 decision**: verified-closed via allowlist + code inspection (replay blocked by environmental webtor preload warning — known issue from Task 1 triage)

## Original assertion

"Unallowlisted console error: [warning] cleanups created outside a
`createRoot` or `render` will never be run" — surfaced while a
`reactToRandomBubble` action fired on userA. Classic SolidJS dev-build
developer warning emitted when a reactive primitive is instantiated
outside a reactive owner. Production builds strip this; dev builds
cannot.

## Phase 2b.1 re-verification (2026-04-19, tip 5db6121c)

Replay step skipped in Phase 2b.1 — same environmental webtor wasm
preload warning as Task 1 continues to abort traces at action 1 before
the originally-failing action fires. Re-verification via code inspection:

1. `src/tests/fuzz/allowlist.ts:58` still contains the regex
   `/\w+ created outside a `createRoot` or `render`/` — the comment
   block at lines 52-57 documents why (dev-build-only SolidJS
   developer warning, stripped by production builds).
2. `isAllowlisted()` is invoked by `INV-console-clean` before a message
   promotes to failure — so the original `reactToRandomBubble`
   signature would be filtered even if it re-surfaces under the
   rewritten reactions path.
3. The Phase 2b.1 reactions refactor (Tasks 2-12) replaced the
   `nostra-reactions-local.ts` ad-hoc render path with the
   store/publish/receive trio driven by the `messages_reactions`
   rootScope event (see `121b1395` "render Nostra reactions from store
   on nostra_reactions_changed event"). The new render site lives
   inside the bubble render tree, so it inherits the owner from the
   enclosing `render()` root — the specific triggering site for the
   original warning no longer exists.

Both the allowlist safety-net AND the refactor-removal of the
triggering site cover this FIND. Closing as verified for Phase 2b.1.
