# Broadcast Channels (NIP-28)

**Status:** implemented and verified for the v1 owner-only model. **Last
reviewed:** 2026-07-12.

Nostra channels are public NIP-28 streams. Kind 40 creates the immutable root,
kind 41 updates metadata, kind 42 publishes a post, and owner-signed kind 5
events delete posts. Content is intentionally not encrypted; joining a channel
is a local subscription, not an access-control boundary.

For the v1 security model only the kind-40 signer is allowed to publish posts,
change metadata, or delete posts. Historical planning notes proposed delegated
admins, but that expands authorization and key-revocation semantics and is not
part of the current goal. Subscriber clients verify the Nostr signature and the
owner pubkey before persisting any kind 41/42/5 event.

`ChannelAPI` provides create, subscribe/unsubscribe, owner post, metadata,
delete, relay backfill, and bounded live subscriptions. `ChannelStore` keeps
subscribed metadata and downloaded posts in IndexedDB for offline reading.
Channel IDs are the 64-hex kind-40 event IDs; a bech32 presentation layer can be
added without changing the stored identity.

Relay filters are scoped to the selected root (`#e`) and capped during backfill;
the app does not subscribe globally to every public channel event. Raw live
events are structurally validated by the relay layer and signature-verified
before the channel callback runs. Multi-relay callbacks deduplicate by event ID.

The existing New Channel flow now uses `ChannelAPI`; Join Channel accepts the
shared 64-hex root ID. Subscribed channels are mapped to a dedicated virtual
peer range and mirrored as read-only broadcast dialogs/messages in the retained
chat UI. The owner can publish through the normal composer. Creation copies the
channel ID to the clipboard when browser permission allows it.

Automated evidence is split by layer: `channel-api.test.ts` covers protocol,
storage and owner authorization; `relay-input-validation.test.ts` covers raw
relay validation and deduplication; `virtual-mtproto-server.test.ts` covers the
send bridge; and `e2e-broadcast-channel.ts` exercises two browser identities
against a local relay (create, subscribe, live post, metadata propagation and
subscriber write denial).

Deferred UX polish is not part of CHN-01–04: a dedicated channel-info editor,
a richer share sheet, avatar publishing, and bech32 presentation. Metadata
updates are currently exposed by `ChannelAPI`; the minimal retained-client UI
only covers creation, joining, reading and owner posting.
