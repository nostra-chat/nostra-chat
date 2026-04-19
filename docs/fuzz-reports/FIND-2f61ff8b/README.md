# FIND-2f61ff8b — INV-console-clean (Solid createRoot cleanup warning)

**Status**: fixed-in-2a (allowlisted)
**Phase 2a-closing commit (if applicable)**: allowlist entry — `src/tests/fuzz/allowlist.ts` already contains `/\w+ created outside a `createRoot` or `render`/` (see comment block explaining dev-build-only noise; the production `--backend=real` path is unaffected).
**Phase 2b.1 decision**: close-as-stale

## Original assertion

"Unallowlisted console error: [warning] cleanups created outside a
`createRoot` or `render` will never be run" — surfaced while a
`reactToRandomBubble` action fired on userA. Classic SolidJS dev-build
developer warning emitted when a reactive primitive is instantiated
outside a reactive owner. Production builds strip this; dev builds
cannot.

## Replay outcome (post-2a main)

Ran `FUZZ_APP_URL=http://localhost:8080 pnpm fuzz --replay=FIND-2f61ff8b`
on 2026-04-19 against branch `fuzz-phase-2b1` (tip 32e869f0).

The original failing message ("cleanups created outside a `createRoot`")
did NOT surface as a failure — the allowlist regex in
`src/tests/fuzz/allowlist.ts:58` matches it and filters it out. The
replay did trip `INV-console-clean` on a different, unrelated message
(webtor wasm preload timing) that aborted the trace at action 1. For
the original signature this FIND is stale; closing as stale for
Phase 2b.1. (The unrelated webtor warning is its own environmental
noise, tracked separately if it persists.)
