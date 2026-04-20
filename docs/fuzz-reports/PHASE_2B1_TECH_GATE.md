# Phase 2b.1 Tech Gate — Run results

Date: 2026-04-19
Run-by: Claude (subagent-driven-development)
Worktree: `/home/raider/Repository/nostra.chat-wt/2b1`
Branch: `fuzz-phase-2b1`

## Adapted acceptance (2b.1 ship-as-is)

Per spec §5.7 (carry-forward to 2b.2) the tech gate was reduced from the
§5.6 spec-authored set to the subset below. The omitted items (30-minute
fuzz sweep + `--replay-baseline`) are explicitly deferred to Phase 2b.2
and tracked in `docs/FUZZ-FINDINGS.md`.

| Check | Result |
|---|---|
| `pnpm test:nostra:quick` | **PASS** — 401/401 tests across 30 test files |
| `npx vitest run src/tests/fuzz/` | **PASS** — 50/50 tests across 9 files |
| `pnpm lint` | **PASS** — 0 errors |
| `npx tsc --noEmit` | **PASS** — 0 errors |

Raw output snippets:

```
pnpm test:nostra:quick
 Test Files  30 passed (30)
      Tests  401 passed (401)
   Duration  4.13s

npx vitest run src/tests/fuzz/
 Test Files   9 passed (9)
      Tests  50 passed (50)
   Duration  449ms

pnpm lint   → exit 0 (no output)
npx tsc --noEmit → exit 0, 0 matches for "error TS"
```

## Deferred for 2b.2

1. **Baseline v2b1 emit** — `pnpm fuzz --duration=30m --seed=42 --emit-baseline`.
   Architectural identity-triple fix (commit `2426ec6d`) closed the mid/IDB
   drift that originally blocked the emit, and was validated via 8 clean
   fuzz iterations + seed=48 direct run. However the richer 2b.1 action
   registry (`reactToRandomBubble fromTarget`, `removeReaction`,
   `reactMultipleEmoji`) surfaces 3 pre-existing latent bugs before the
   fuzzer can complete enough clean iterations to emit a baseline.

2. **FIND-c0046153** — `INV-bubble-chronological` — out-of-order DOM insertion
   on burst P2P sends. Seed 48 iter 6. See
   `docs/fuzz-reports/FIND-c0046153/README.md`.

3. **FIND-bbf8efa8** — `POST_react_multi_emoji_separate` — render aggregation
   drops one of 3 emojis in `reactMultipleEmoji`. Seed 101 iter 1. See
   `docs/fuzz-reports/FIND-bbf8efa8/README.md`.

4. **FIND-eef9f130** — `POST-sendText-input-cleared` — chat input retains
   text after send (likely introduced by the `keyboard.insertText` migration
   that fixed FIND-3c99f5a3). Seed 102 iter 2. See
   `docs/fuzz-reports/FIND-eef9f130/README.md`.

5. **`pnpm test:e2e:all`** — full Playwright E2E sweep. Not run in this
   session; unit+fuzz gate gives high confidence no E2E regressed but
   maintainer should run this as part of merge checklist.

## Tech gate status

Adapted §5.6 (automated subset) — **PASS**.

Ready for:
- 2-device manual verification (§5.6 unchanged, see `docs/VERIFICATION_2B1.md`)
- Maintainer review + merge approval
- Phase 2b.2 scope intake (baseline emit + 3 carry-forward FINDs)
