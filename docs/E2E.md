# End-to-end verification

**Authority:** browser-suite entry points, environment requirements, and current
long-test status. **Last reviewed:** 2026-07-12.

## Commands

- `pnpm test:e2e:critical` starts a local Vite server on port 8080 when needed,
  runs the curated release-critical scripts sequentially, and stops its server.
- `pnpm test:e2e:all` is the broader legacy suite and may use live relays or
  optional services. Add `--no-bail` to collect all failures.
- `pnpm test:e2e:push` is online-only and requires the push service plus a live
  relay. It is intentionally separate.

Set `E2E_APP_URL` to reuse an already running app. Media tests start an isolated
local relay and mock Blossom server. Browser binaries must already be installed
for the pinned Playwright version.

## Critical suite coverage

The curated runner covers dev/cold boot, identity creation and recovery phrase,
contact creation and reload persistence, bilateral text/edit/reaction/read
receipt flows, encrypted image and file transfer with caption, bilateral group
creation/message delivery, signed-update consent/snooze, cross-source manifest
agreement/conflict/insufficient states, and a network guard that fails on any
Telegram-origin request. It also covers two-identity Broadcast Channels over a
local relay: create, subscribe, live post, metadata propagation and subscriber
write denial.

The test scripts use visible readiness selectors or state polling where those
signals exist. Some older bilateral scripts still contain bounded waits because
public relay propagation has no deterministic acknowledgement exposed to the
browser; these are isolated from PR CI.

## Verification snapshot

On 2026-07-12 the following were executed successfully after harness fixes:

- dev boot and no-Telegram network guard;
- recovery phrase/key protection (21/21);
- contacts, reload persistence, send state and preview (8/8);
- bilateral edit (7/7) and NIP-25 reaction;
- bilateral read receipt (4/4), including the active-chat arrival regression;
- encrypted image with caption (5/5) and PDF/file (5/5);
- bilateral group create/send/receive;
- NIP-28 channel create/subscribe/post/metadata/owner authorization;
- update consent/snooze and controlled source verdicts.

The read-receipt run exposed and fixed a product bug: messages arriving while
the conversation was already open sent only `delivered`, never `read`. The
receive path now emits both receipts for the active peer and has unit regression
coverage.

## Remaining long-suite scope

The broader suite still contains historical scripts with fixed sleeps, direct
production-module calls, or assertions that only prove an API exists. Treat
those as characterization, not release evidence, until migrated into the
critical runner. Full UI-only reply/delete, group rename/leave/member removal,
recipient-offline recovery, relay failover, multi-tab cold start, and production
Service Worker controller-change recovery remain explicit long-E2E follow-ups;
their protocol/store paths retain unit and integration coverage in the baseline.
