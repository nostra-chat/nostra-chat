# Performance Baseline

**Measured:** 2026-07-12. Update this document when production chunking or the
performance-sensitive chat pipeline changes materially.

The baseline command is `ANALYZE=1 pnpm build`. It performs the real production
build and validates the emitted update manifest, so measurements describe the
artifact users receive rather than the development graph.

## Initial evidence

- 2,104 modules transformed in 13.23 seconds on the local verification host.
- 4,241 files covered by the signed-update manifest.
- largest JavaScript chunk: `appDialogsManager`, 2,296.93 kB minified and
  716.48 kB gzip.
- Vite reported redundant static/dynamic-import boundaries, including
  `nostra-groups-sync` and `rootScope` inside `group-api`.

The inherited `appDialogsManager` chunk is a high-value future target, but
splitting that retained-client dependency graph is not a safe first change.
The first incremental intervention instead removes two ineffective dynamic
imports from `group-api`: both modules were already eagerly imported in the
same file, so the async boundaries could never create lazy chunks and added
Promise/module-loader work to every received group metadata update.

## Verification and comparison

Characterization is provided by the existing group lifecycle/management tests,
especially receiver-side metadata mirroring. The focused group suite,
typecheck, lint and a second production build are the regression gate. The
comparison build transformed the same 2,104 modules in 13.50 seconds and
produced the same 2,296.93 kB / 716.48 kB gzip largest chunk. As expected, the
`nostra-groups-sync` redundant-import warning disappeared and `group-api` no
longer appears among the dynamic `rootScope` importers. Output-size improvement
is deliberately not claimed because those modules were already statically
reachable. Typecheck, lint, 12 focused group metadata/management tests, the
production build, and validation of all 4,241 manifest files passed.

An ad-hoc combined run exposed cross-file mock contamination in the legacy
`group-ui-integration.test.ts` harness (`_groups` was resolved from the real
store). The canonical isolated runner avoids that known Vitest limitation and
the file, along with all 112 Nostra test files, passes there. It is not counted
as performance evidence; the focused metadata/management tests are.

## Next measured work

Capture browser traces for long chat histories before changing rendering or
virtualization. Separately inspect the generated bundle report for the
2.30 MB dialogs chunk and extract only dependency islands that can be lazy
without moving startup invariants, Worker bridges or message persistence.
