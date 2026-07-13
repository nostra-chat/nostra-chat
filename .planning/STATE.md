---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: baseline-v1
status: verified
current_workstream: maintenance
last_updated: "2026-07-12"
released_version: 0.25.3
---

# Project state

**As of:** 2026-07-12
**Update rule:** revise this file whenever the active workstream, verified
baseline, release version, or requirement state changes.

## Project reference

See `.planning/PROJECT.md` for the product definition and durable decisions.

**Core value:** private, censorship-resistant messaging that feels as good as
Telegram.

## Current position

The repository has shipped through version 0.25.3. Identity, encrypted 1:1
messaging, multi-relay transport, Telegram MTProto isolation, groups,
controlled updates, push notifications, fuzzing, and the agentic explorer all
have substantial production implementations and automated coverage.

The v1 baseline and hardening workstream completed its ordered local gates on
2026-07-12:

1. shared agent instructions;
2. documentation alignment;
3. reproducible local and pull-request baseline;
4. messaging, storage, and relay hardening;
5. controlled PWA update hardening;
6. critical-flow E2E consolidation;
7. Broadcast Channels;
8. measured incremental refactoring and performance work.

`AGENTS.md` is the operational entry point for this workstream. A subsystem is
not considered reverified merely because it shipped previously; current test
or runtime evidence is required by the corresponding gate.

## Capability status

| Area | Implementation evidence | Current verification state |
|---|---|---|
| Build and multi-mirror distribution | release workflow and releases through 0.25.3 | local baseline PASS; PR workflow added |
| Identity and encrypted key storage | identity modules and Nostra tests | local baseline PASS; broader manual security review remains periodic |
| Multi-relay and Tor transport | relay/Tor modules and regression tests | resource/input hardening and baseline PASS |
| 1:1 NIP-17 messaging and media | production modules, unit tests, curated bilateral E2E | critical flows PASS; broader legacy E2E remains separate |
| Telegram MTProto isolation | guarded dispatch and VMT invariant tests | quick/full baseline PASS |
| Private groups | production fixes and bilateral create/send/receive E2E | extended management UI E2E remains separate |
| Controlled PWA updates | signed updater, threat model, recovery docs, 92 tests, production hash validation | controller-change browser matrix remains long E2E |
| Background push | client/SW implementation and dedicated tests | live service E2E remains separate |
| Fuzzer and explorer | committed harnesses, reports, and test suites | all 15 Explorer unit files PASS; driver/fuzz remain separate long gates |
| Broadcast Channels | owner-only NIP-28 API/store, bounded relay sync, virtual chat rendering and browser E2E | CHN-01–04 verified; richer info/share UI deferred |

## Sources of truth

- Requirements and traceability: `.planning/REQUIREMENTS.md`
- Future sequence and completion criteria: `.planning/ROADMAP.md`
- Durable subsystem invariants: `docs/SUBSYSTEM-RULES.md`
- Architecture and harness behavior: `docs/ARCHITECTURE.md`
- User-visible capability audit: `docs/FEATURE_MATRIX.md`
- Reproducible verification evidence: verification documents and current
  command output, not unchecked historical plan boxes
- Release behavior: `docs/RELEASE.md` and `.github/workflows/`

When these disagree, code, tests, workflow configuration, and runtime evidence
win; update the stale document in the same workstream.

## Known risks and deferred verification

- Pull-request CI is defined but has not yet produced a remote GitHub run in
  this worktree; deployment remains tag-only.
- Historical planning checkboxes do not consistently match completed plans.
- `docs/FEATURE_MATRIX.md` records audited evidence boundaries; broader legacy
  browser flows remain separate from the passing critical suite.
- Several manual verification checklists contain unticked historical gates;
  they are evidence protocols, not proof that the checks passed.
- The current user modification in `docs/FUZZ-FINDINGS.md` must be preserved
  and treated as authoritative for the active fuzz findings.
- Broadcast Channels use public NIP-28 and owner-only publishing for v1;
  dedicated metadata/share/avatar UX remains deferred.
- Large inherited UI/manager files remain high-risk and should only be
  refactored incrementally after characterization tests and measurements.

## Historical planning

Detailed plans, research, summaries, and verification notes under
`.planning/phases/` and `docs/superpowers/` are historical records. Preserve
them, but do not use their unchecked boxes as current status. Git history and
the current files above are authoritative for ongoing work.
