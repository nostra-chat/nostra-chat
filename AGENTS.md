# Nostra.chat agent guide

This file is the shared operational entry point for coding agents and human
contributors. Read it before changing the repository. `CLAUDE.md` remains the
Claude Code compatibility guide; durable project rules belong here or in the
linked subsystem documentation.

## Project snapshot

Nostra.chat is a decentralized, privacy-oriented messaging PWA forked from
Telegram Web K. The application replaces Telegram transport with encrypted
Nostr messaging while retaining the mature client UI.

- Language: TypeScript 5.7, with `strict: true` but `strictNullChecks: false`
- UI: Solid.js using the custom fork in `src/vendor/solid/`; this is not React
- Build: Vite 5 and SCSS
- Storage: IndexedDB, CacheStorage, localStorage, and sessionStorage
- Background contexts: SharedWorker, Web Worker, and Service Worker
- Tests: Vitest plus Playwright-driven E2E harnesses
- Package manager: the pinned pnpm 9 version in `package.json`
- License: GPL-3.0

## Sources of truth

Use the narrowest authoritative source. Do not infer current feature status
from the existence of a file alone.

| Subject | Source |
|---|---|
| Commands, dependencies, package-manager version | `package.json`, `pnpm-lock.yaml` |
| Compiler, aliases, JSX mode | `tsconfig.json`, `vite.config.ts` |
| Enforced style | `eslint.config.mjs` |
| Shared agent workflow | this file |
| Deep architecture and test harness behavior | `docs/ARCHITECTURE.md` |
| Subsystem invariants and production traps | `docs/SUBSYSTEM-RULES.md` |
| Release and deployment | `docs/RELEASE.md`, `.github/workflows/` |
| Current product status and requirements | `.planning/STATE.md`, `.planning/REQUIREMENTS.md` |
| Future sequencing | `.planning/ROADMAP.md` |
| User-facing capabilities | `README.md`, `docs/FEATURE_MATRIX.md` |
| Fuzzer findings | `docs/FUZZ-FINDINGS.md`, `docs/explorer-reports/` |

When documents disagree, verify against code, tests, workflows, and recent
history, then correct the stale document in the same change when appropriate.

## Setup and canonical commands

```bash
pnpm install --frozen-lockfile
pnpm start                    # Vite development server, normally port 8080
pnpm lint                     # ESLint for src/**/*.{ts,tsx}
npx tsc --noEmit              # TypeScript check
pnpm test:nostra:quick        # Critical Nostra unit/integration suite
pnpm test:nostra              # Full src/tests/nostra suite
pnpm test:explorer            # Explorer tests
pnpm test:explorer:capture    # Browser/driver integration; requires app :8080
pnpm test:explorer:driver     # Full driver integration; requires app :8080
pnpm build                    # Production build plus update manifest validation
pnpm test:e2e:all             # Long-running E2E harness
pnpm test:e2e:all:no-bail     # Run all E2E cases and collect all failures
pnpm fuzz --duration=3m       # Minimum useful stateful-fuzzer run
```

Use `pnpm test run <file>` for a one-shot Vitest file. Do not use
`pnpm test <file>`: `pnpm test` starts watch mode and can hang unattended work.
Targeted E2E scripts are run with `node_modules/.bin/tsx <script>`; inspect
`src/tests/e2e/run-all.sh` for prerequisites and the canonical list.

`pnpm build` deliberately sets both `NODE_ENV=production` and Vite production
mode. Do not remove either flag. Update-flow behavior must be tested from a
production build served as static files, not inferred from `pnpm start` or
Vite's SPA fallback in `pnpm preview`.

## Proportional verification

Run the smallest set that proves the change, plus every broader check required
by the risk of the touched subsystem.

| Change | Minimum verification |
|---|---|
| Documentation only | validate commands/links against current files; inspect diff |
| TypeScript or TSX | targeted Vitest, `pnpm lint`, `npx tsc --noEmit` |
| Nostra messaging, storage, relay, groups, bridge | targeted tests, `pnpm test:nostra:quick`, lint, typecheck |
| Explorer or fuzzer | targeted test, `pnpm test:explorer`; deterministic replay when applicable |
| Build, Service Worker, manifest, update system | targeted update tests, typecheck, `pnpm build`; production-static verification when behavior changes |
| User-visible critical flow | all above that apply plus the targeted E2E script |
| Release or CI | validate workflow syntax and run the same local checks the workflow declares |

Before handing off a broad or release-facing change, run `pnpm lint`,
`npx tsc --noEmit`, `pnpm test:nostra:quick`, and `pnpm build`. Record any
pre-existing, environmental, or flaky failure explicitly; never weaken a
check merely to make the baseline green.

## Code conventions

- Use 2 spaces, single quotes, LF endings, and no trailing commas.
- Follow the unusual enforced keyword style: `if(condition)`, not `if (condition)`.
- Do not add spaces inside object or array delimiters.
- Put ternary `?` and `:` at the end of their preceding line.
- Use `const`/`let`, never `var`; do not use `return await`.
- Prefer configured aliases such as `@lib/*`, `@components/*`, `@helpers/*`,
  `@stores/*`, and `@/*` over deep `../../` imports.
- JSX is Solid.js. Do not import React or apply React lifecycle/state patterns.
- Keep root-scope events typed in `BroadcastEvents`; do not bypass them with
  `as any` casts.
- Do not add `eslint-disable` comments unless the rule is genuinely
  inapplicable and the reason is stated.

## High-risk architecture invariants

- Worker-side app managers are authoritative. Main-thread proxies and mirrors
  are bridges, not interchangeable manager instances.
- Verify both dispatchers and listeners before relying on a `rootScope` event.
  Dev HMR can create multiple `rootScope` instances; confirm a problem exists
  in a production build before adding production defenses for that symptom.
- Nostra peer/message mirrors must stay coherent with IndexedDB. A UI-only
  update is not sufficient for persistence, cross-tab behavior, or reload.
- `VirtualPeersDB` owns stable peer mappings. Preserve transaction and
  concurrency semantics; never generate replacement mappings casually.
- NIP-17 gift-wrap, NIP-44 encryption, event identity, deduplication, receipts,
  and replay handling are one integrity boundary. Validate untrusted relay
  input before it reaches stores or UI.
- Delivery tracking uses the application message ID in the relevant paths, not
  an arbitrary rumor/event ID. Read the subsystem rules before changing it.
- Service Workers have no `localStorage` and do not share the page lifecycle.
  Keep SW-safe identity/storage code free of window-only dependencies.
- IndexedDB deletion can block while connections remain open. Use centralized
  cleanup and close all singleton connections instead of deleting databases
  ad hoc.
- Logout and reset are distinct: reset may preserve the Nostra identity. Use
  the centralized cleanup and popup flows.
- No non-intercepted method may silently fall through to Telegram MTProto.
- The controlled-update path is consent gated. Never activate unsigned,
  unverified, downgraded, partially downloaded, or mismatched artifacts.
- Manifest paths may include a leading `./`; normalize before comparison. Do
  not derive production update conclusions from Vite development output.

Read `docs/SUBSYSTEM-RULES.md` before changing messaging, bridge, worker, cleanup,
push, update, fuzzer, or bubble-rendering code. Read `docs/ARCHITECTURE.md` before
changing Tor, profiles, testing infrastructure, or controlled updates.

## Fragile areas

- `src/components/chat/bubbles.ts`
- `src/components/chat/input.ts`
- `src/lib/appManagers/appMessagesManager.ts`
- `src/index.ts` and boot/splash ordering
- `src/lib/nostra/` messaging, storage, relay, and peer-mapping paths
- `src/lib/serviceWorker/` and `src/lib/update/`
- build manifest generation/signing and release workflows

For these areas, add characterization or regression tests first and prefer
small extractions over broad rewrites. Confirm that a component is mounted and
an event is consumed; file presence alone is not evidence of production use.

## Generated, vendored, and special files

- `src/layer.d.ts` and generated language/schema/icon outputs must be changed
  through their generator unless the documented workflow says otherwise.
- `src/vendor/solid/` and `src/vendor/solid-transition-group/` are deliberate
  forks. Do not replace them with npm packages as incidental cleanup.
- Do not remove the tracked `public/recorder.min.js` exception from `.gitignore`.
- Do not put screenshots or temporary binary artifacts in the repository root;
  use `/tmp` for transient evidence.
- Build output under `dist/` is derived. Do not treat it as the source fix.

## Safety, release, and repository hygiene

- Inspect `git status` before editing and preserve unrelated user changes.
- Never restore, overwrite, stage, or commit unrelated modifications.
- Do not use destructive git commands or bypass hooks.
- Do not edit `package.json` version or `CHANGELOG.md` to publish a release.
- Do not run `pnpm version` as a normal release path. Release Please owns
  version bumps, changelog generation, tags, and release PRs.
- Do not deploy, push, merge, publish, rotate keys, edit real secrets, or create
  a release without explicit authorization.
- The deploy workflow is tag-triggered and security-sensitive. Preserve the
  single built artifact across mirrors so hashes remain identical.
- Use separate git worktrees for concurrent agent sessions; do not run multiple
  writers in the same working directory.

## Documentation maintenance

Update documentation with behavior changes. Architecture documents describe
durable design; planning files describe status and future work; verification
documents record reproducible evidence. Keep chronology out of invariant lists,
and do not mark a feature complete without a passing test, runtime evidence, or
another explicit verification artifact appropriate to the claim.
