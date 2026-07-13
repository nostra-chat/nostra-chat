# Nostra.chat capability matrix

**Last evidence audit:** 2026-07-12
**Update rule:** update a row only when implementation and its cited evidence
change. A committed test script is coverage, not proof of a current passing
run; current baseline results belong in `.planning/STATE.md` and CI artifacts.

## Status vocabulary

| Status | Meaning |
|---|---|
| Implemented | Production path and focused automated coverage exist |
| Implemented, E2E gate pending | Production path and an E2E scenario exist, but the current consolidated gate has not run |
| Partial | Some production behavior exists, but the stated user capability is incomplete or lacks adequate evidence |
| Inherited only | Telegram Web K UI/code remains but has no complete Nostra transport path |
| Planned | Requirement/research exists without a production implementation |
| Not applicable | The Telegram capability does not fit Nostra's identity/transport model |

## V1 capabilities

| Area | Capability | Status | Evidence |
|---|---|---|---|
| Identity | Create/import NIP-06 identity and show npub | Implemented, E2E gate pending | `nostr-identity.test.ts`, `onboarding-npub.test.ts`, `e2e-seed-recovery.ts` |
| Identity | Encrypted key storage with PIN/passphrase | Implemented, E2E gate pending | `key-storage.test.ts`, `lock-screen.test.ts`, `e2e-pin-passphrase-tab.ts` |
| Identity | NIP-05 and kind-0 profile metadata | Implemented, E2E gate pending | `nip05.test.ts`, `kind0-fetch.test.ts`, `e2e-user-info-kind0.ts` |
| Contacts | Add by npub/QR and persist peer mapping | Implemented, E2E gate pending | `add-contact.test.ts`, `virtual-peers-db.test.ts`, `e2e-qr-key-exchange.ts` |
| Messaging | Encrypted NIP-17/NIP-44 1:1 text | Implemented, E2E gate pending | `nip17-messaging.test.ts`, `nip44-crypto.test.ts`, `e2e-p2p-messaging.ts` |
| Messaging | Offline queue, relay backfill, cold-start readiness | Implemented, hardening pending | `offline-queue.test.ts`, `nostr-relay.test.ts`, `nostra-pending-flush.test.ts` |
| Messaging | Delivery/read states and read cursor | Implemented, E2E gate pending | `delivery-tracker.test.ts`, `nostra-read-receipts.test.ts`, `e2e-read-receipts.ts`, `e2e-read-cursor.ts` |
| Messaging | Reply, edit, reactions, delete | Implemented, E2E gate pending | `edit-message.test.ts`, `delete-messages-p2p.test.ts`, reaction tests, focused E2E scripts |
| Messaging | Forwarding | Partial | inherited UI and guarded Nostra fallback; no focused bilateral E2E evidence |
| Messaging | Search in P2P history | Partial | inherited search paths; no current focused P2P search gate |
| Media | Encrypted image/file upload and receive | Implemented, E2E gate pending | `file-crypto.test.ts`, `nostra-send-file.test.ts`, `e2e-send-image.ts`, `e2e-send-file.ts` |
| Media | Image/file captions | Implemented, E2E gate pending | `dm-image-caption.test.ts`, `e2e-send-image.ts` |
| Media | Video playback and voice notes | Partial | media pipeline and `e2e-send-voice.ts` exist; consolidated cross-peer evidence pending |
| Groups | Create and display private NIP-17 group | Implemented, E2E gate pending | group store/display/UI tests, `e2e-groups-bilateral.ts` |
| Groups | Add/remove/leave and admin transfer | Implemented, E2E gate pending | `group-management.test.ts`; consolidated lifecycle E2E pending |
| Groups | Group edit/reply/reactions/rename | Implemented, E2E gate pending | group reaction/VMT tests and May 2026 production fixes |
| Relays | Multi-relay publish, failover, NIP-65 | Implemented, hardening pending | `nostr-relay-pool.test.ts`, `relay-failover.test.ts`, `nip65.test.ts` |
| Privacy | Tor modes and explicit direct fallback | Implemented, E2E gate pending | Tor/privacy tests and `e2e-tor-privacy-flow.ts` |
| Isolation | No Telegram MTProto fallback | Implemented, baseline pending | `boot-no-mtproto.test.ts`, `mtproto-stub.test.ts`, VMT invariant tests |
| Push | Background Web Push with privacy levels | Implemented, live E2E separate | push client/storage/SW tests; `e2e-push-bilateral.ts` requires live services |
| Updates | Consent-gated signed PWA updates | Implemented, hardening pending | `src/tests/update/`, `e2e-update-controlled.ts` |
| Distribution | Cloudflare, GitHub Pages, and IPFS from one artifact | Implemented, baseline pending | `.github/workflows/deploy.yml`, build-output/update tests |
| Channels | NIP-28 Broadcast Channels | Implemented | Owner-only API/store, bounded relay sync, virtual chat rendering and two-browser local-relay E2E; metadata editor/share-sheet polish remains deferred |

## Additional and inherited capabilities

| Capability | Status | Notes |
|---|---|---|
| Message requests and blocking | Implemented, E2E gate pending | focused store/UI tests and `e2e-message-requests.ts`; enforcement remains in hardening scope |
| Contact/profile refresh | Implemented, E2E gate pending | peer-profile and own-profile sync tests |
| Nostra emoji/reaction assets | Implemented | synthetic emoji pack and reaction guards have regression coverage |
| Chat folders | Partial | local/default-folder persistence and sync tests exist; broad product E2E is not in the critical gate |
| Themes and language | Inherited only | expected to work in the retained client UI; not part of the current Nostra transport verification |
| Stories and bots | Inherited only | MTProto-backed behavior is not a v1 Nostra capability |
| Voice/video calls | Planned for v2 | WebRTC/TURN privacy and infrastructure work remains deferred |
| Phone/SMS login and remote Telegram sessions | Not applicable | replaced by local Nostr key identity |

## Evidence boundaries

- Unit and integration tests prove the isolated contract they assert, not the
  full user journey.
- E2E files excluded from `src/tests/e2e/run-all.sh` are not part of the
  consolidated suite until deliberately added or documented as separate.
- Manual verification checklists with unchecked boxes are protocols, not pass
  records.
- Release history shows that code shipped, not that the current worktree
  passes today's baseline.
- Broad claims such as “offline delivery”, “multi-tab update”, and “failover”
  require scenario-level evidence matching the claim.

## Deferred product scope

The detailed v2 and out-of-scope requirements remain in
`.planning/REQUIREMENTS.md`. The immediate product gap for the v1 roadmap is
Broadcast Channels, after baseline, hardening, and critical-flow E2E gates.
