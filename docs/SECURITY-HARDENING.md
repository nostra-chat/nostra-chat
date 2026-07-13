# Security hardening status

Updated: 2026-07-12. This is a current risk register, not a claim of a completed
security audit. Re-run the checks after changes to relay parsing, persistence,
identity, dependencies, or the PWA updater.

## Messaging, storage, and relay controls

- Relay input is rejected before signature verification when its frame, event
  content, tags, or tag fields exceed bounded limits. HTTP polling also caps the
  response body and number of events processed per cycle.
- Offline queue restoration completes before mutations. A queued send is not
  reported as durable until its IndexedDB write succeeds.
- A relay-accepted immediate send is no longer retained for a later duplicate
  flush. During a flush, the accepted relay event ID is persisted before the row
  is deleted, so interrupted cleanup does not republish a fresh NIP-17 event.
- Offline payloads are NIP-44 encrypted at rest when the initialized relay pool
  exposes the identity key. Migrated queue rows carry an explicit
  `payloadEncrypted` marker and are decrypted only immediately before publish.
- Retry state and durable deletion errors are awaited or logged as errors rather
  than being silently discarded.

Regression coverage lives in `relay-input-validation.test.ts`,
`offline-queue.test.ts`, and `migration.test.ts`.

## Residual risks and deferred work

- If the identity key is unavailable while a message is queued, the queue keeps
  a plaintext-compatible row so the message is not lost. The UI should prevent
  sending before identity initialization; converting this fallback into a hard
  failure needs a product decision about recovery and locked identities.
- `message-store.ts` intentionally caches decrypted conversation history in
  IndexedDB. Browser/profile access therefore exposes message content. Encrypting
  all history requires a versioned migration, unlock UX, search/index changes,
  quota testing, and a recovery design; it is not safe as a small patch.
- IndexedDB operations still depend on browser transaction completion and do not
  share a project-wide timeout/quota abstraction. Storage pressure and forced
  transaction aborts need browser E2E coverage.
- Cross-tab coordination for queue flush and message-store writers is incomplete;
  the PWA update phase and multi-tab E2E must verify single-writer/lease behavior.
- Time-window replay policy for old but valid Nostr events is feature-dependent.
  Signature, event ID, structural validation, and existing ID deduplication are
  enforced, but a universal age cutoff could discard legitimate cold-start
  backfill and must not be added without protocol-specific rules.

## Dependency audit snapshot

`pnpm audit` on 2026-07-12 reported 97 advisories (3 critical, 32 high, 49
moderate, 13 low). The inspected critical paths are development/test tooling:

- `form-data@4.0.0` via `jsdom@22.1.0` and Vitest;
- `handlebars@4.7.8` via `vite-plugin-handlebars@1.6.0`;
- the legacy `vitest@0.34.6` toolchain itself.

These findings are not evidence that production runtime code is unaffected, but
blind lockfile overrides would risk an invalid or incompatible build. Upgrade
Vitest/jsdom and the Handlebars build plugin as an isolated toolchain change,
then rerun the full baseline and inspect the production dependency graph again.
Do not suppress the advisories or treat the current snapshot as accepted risk.

## Verification

For this hardening group the following passed:

- targeted relay validation tests;
- offline queue tests (23 tests);
- identity migration tests (9 tests);
- `pnpm lint`;
- `npx tsc --noEmit`.

The full reproducible baseline and environment notes are recorded in
`docs/BASELINE.md`.
