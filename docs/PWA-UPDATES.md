# PWA update security and recovery

**Authority:** security model and recovery procedure for controlled PWA updates.
**Last reviewed:** 2026-07-13.

## Trust boundaries and threat model

The currently installed bundle and its effective Ed25519 public key are the
root of trust. CDN, GitHub Pages, IPFS gateways, relay/network paths, browser
HTTP cache, and downloaded artifacts are untrusted. IndexedDB, Cache Storage,
localStorage, and another same-origin tab can fail or race, but must not turn an
unverified download into executable code.

Threats considered here are a compromised mirror, stale/replayed release data,
path traversal or cross-origin entries, partial downloads, corrupted caches,
storage exhaustion, interrupted activation, an unexpected Service Worker, and
two tabs attempting the same update. Full compromise of the installed origin or
release signing key remains outside what an in-origin updater can contain.

## Invariants

1. Consent precedes `UPDATE_APPROVED`; neither a probe nor a cross-source match
   activates code.
2. The exact manifest bytes are verified with the installed Ed25519 key inside
   the active Service Worker, not only in the page.
3. Every bundle path is relative, traversal-free, bounded, same-origin, and
   covered by a SHA-256 digest. The release validator re-hashes every real file.
4. Every artifact is placed into a manifest-digest-addressed prepared cache and
   verified before the active-version pointer changes. Bytes may be reused from
   the previous cache only after their SHA-256 digest is recomputed and matches
   the newly signed manifest.
5. A normal signed downgrade is rejected again inside the Service Worker.
   An intentional security rollback must be explicitly marked in the signed
   manifest.
6. A key rotation is accepted only with a cross-certificate signed by the
   currently installed key; the effective new public key is persisted.
7. The approved hashed Service Worker is explicitly registered with
   `updateViaCache: 'none'`, allowed to reach `waiting`, then promoted with the
   consent-only `SKIP_WAITING` message.
8. The update lock is exclusive across tabs where the Web Locks API is
   available. A second tab reports `update-in-progress` and does not download or
   swap.
9. Failure deletes the pending cache where possible and leaves the last active
   shell available. It never falls back to running a hash-mismatched response.
10. The approved worker install re-verifies the persisted exact manifest,
    signature, worker URL, and every prepared-cache byte locally. It does not
    refetch the app shell from the network. The browser still necessarily
    fetches the registered Service Worker script itself once.

## Release artifact path

`pnpm build` emits `dist/update-manifest.json` after the production bundle and
then validates schema, safe paths, version/commit coherence, complete file
coverage, hash format, and the recomputed hash of every covered file. Signing is
a separate authorized release operation (`pnpm sign-manifest`); local builds do
not create or modify a real signing secret.

The client probe downloads the exact manifest text and detached signature. A
verified update is offered through the consent popup. Acceptance sends both the
parsed object and original bytes to the active Service Worker, which repeats
signature, schema, path, downgrade, rotation, and artifact checks before the
cache commit. Verification runs with a bounded worker pool. Matching bytes from
the active shell are re-hashed and copied into the prepared cache; only missing
or changed bytes are downloaded. The prepared cache is already complete, so a
single IndexedDB active-pointer commit replaces the old copy-based swap. The
page then registers/promotes the manifest's verified worker, whose install step
revalidates that same approved cache without downloading the shell again.

Progress messages are coalesced to at most one every 100 ms. The page's
two-minute watchdog measures inactivity rather than total elapsed time: each
progress message resets it. On inactivity the page asks the worker to cancel,
retains the exclusive update lock during a ten-second cleanup grace period, and
then reports a timeout.

## Recovery

- Network interruption, bad hash, invalid signature, invalid manifest, quota
  exhaustion, registration failure, or timeout: keep using the current version,
  free storage/check connectivity if relevant, and retry from App Updates.
- Interrupted after cache swap but before worker promotion: the pending
  finalization record is retained for the next boot; the old controlling worker
  remains usable until reload/activation completes.
- Corrupt or evicted active cache: the strict cache-miss overlay offers the
  reinstall/recovery path instead of silently executing an unverified network
  response.
- Unexpected worker URL or unconsented waiting worker: stop normal boot and show
  the compromise alert. Verify the published release independently before using
  baseline reset/reinstall.
- A failed update must never require clearing identity/message data. Update
  baseline recovery and application-data cleanup are separate operations.

## Verification and remaining limits

Unit/integration coverage includes valid and invalid signatures, exact manifest
byte propagation, hash mismatch, downgrade rejection, key rotation certificate,
safe/reserved paths, prepared-cache commit, verified reuse, bounded concurrency,
in-flight failure draining, MIME preservation, approved install without network
refetch, inactivity cancellation, consent state, snooze, registration URL, boot
ordering, and multi-tab lock contention. Production `pnpm build` validates the
real release paths and hashes.

Long browser E2E remains the authority for controller-change timing, browser
quota behavior, interrupted downloads, cache eviction, and differences among
Cloudflare, GitHub Pages, and IPFS. Browsers without Web Locks retain the
cryptographic/idempotent gates but do not yet have a cross-tab fallback lease;
this is a documented compatibility risk rather than permission to bypass them.
