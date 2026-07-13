# Repository verification baseline

**Verified:** 2026-07-12
**Runtime:** local Linux workspace, Node.js 24.10.0, pinned pnpm 9 package
manager. CI uses Node.js 20 as declared in `.github/workflows/ci.yml`.

Long browser coverage and its environment boundaries are tracked separately in
[`E2E.md`](./E2E.md).

## Passing gate

| Check | Result | Evidence |
|---|---|---|
| `pnpm lint` | PASS | ESLint exited 0 |
| `npx tsc --noEmit` | PASS | TypeScript exited 0 |
| `pnpm test:nostra:quick` | PASS | 42 files, 514 tests, plus 9 channel/relay pre-gate tests |
| `pnpm test:nostra` | PASS | 112 eligible files, each in a clean process |
| `pnpm test:explorer` | PASS | 15 eligible files, each in a clean process |
| `pnpm build` | PASS | 2,104 modules; manifest v0.25.3 covers 4,241 files |
| update unit/integration suite | PASS | 19 files, 92 passed and 1 explicit skip |
| critical browser suite | PASS | self-starting local server/relay flows documented in `E2E.md` |
| `.github/workflows/ci.yml` | syntax PASS | parsed as YAML; workflow runtime awaits first PR/manual run |

## Baseline corrections made

- Kind-0 relay fixtures now use genuinely signed events matching the requested
  pubkey instead of bypassing the production signature/pubkey checks.
- Group fixtures now use 64-character lowercase hex pubkeys accepted by the
  production validation boundary.
- Edit-message fixtures now use current-window timestamps and valid hex event
  IDs, exercising replay-window enforcement rather than failing before the
  edit contract.
- The Playwright NIP-25 test was moved from the Vitest Nostra directory into
  `src/tests/e2e/`.
- tweb numeric ID helpers required by manager tests are installed once in the
  shared test setup.
- Full Nostra and Explorer unit/integration suites run files in isolated child
  processes. The prior shared module graph leaked incompatible mocks and open
  asynchronous resources across files, causing order-dependent failures and
  non-terminating runs.

## Separate environment-dependent checks

These are intentionally not part of the dependency-free unit baseline:

- `pnpm test:explorer:driver` starts the Explorer driver and requires the app
  to be available on `http://localhost:8080`.
- `pnpm test:e2e:all` runs the long browser suite and manages additional local
  relay/harness requirements per script.
- `pnpm test:e2e:push` depends on the live push service and a live Nostr relay.
- `pnpm fuzz --duration=3m` is the minimum useful stateful fuzzer run; baseline
  replay status is tracked in `docs/FUZZ-FINDINGS.md`.

## Non-blocking warnings retained

- Vite's CJS Node API and two handlebars plugin options are deprecated.
- Browserslist data is outdated.
- Several inherited font/image URLs remain runtime-resolved during the build.
- Some production chunks exceed 500 kB, notably the inherited app manager
  bundle; this is evidence for the later measured performance phase.
- The quick suite intentionally logs simulated error paths and some incomplete
  mocks to stderr even while assertions pass. Hardening should reduce
  misleading noise without hiding real failures.

## CI boundary

The pull-request workflow is read-only, uses frozen lockfile installation,
runs no deploy job, and receives no production secrets. Deployment remains
exclusively tag-triggered in `deploy.yml`.
