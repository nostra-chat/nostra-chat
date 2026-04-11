# Nostra.chat

Privacy-first decentralized messaging with end-to-end encryption and anonymous relay-based delivery.

## About

**Nostra.chat** is a 100% client-side Progressive Web App for decentralized messaging, forked from [Telegram Web K](https://github.com/nicegram/nicegram-web-z). It replaces the Telegram backend with peer-to-peer encrypted chat over [Nostr](https://nostr.com/) relays and integrates [Tor](https://www.torproject.org/) via WASM for network-level privacy.

No servers. No accounts. No install. Just cryptographic keys and a browser.

### How it works

Every message is end-to-end encrypted using [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) v2 and wrapped in [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) / [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) gift-wrap envelopes — a three-layer scheme (Rumor → Seal → Gift-Wrap) so relay operators see only opaque blobs with no readable metadata: not the sender, not the recipient, not the content.

Messages are delivered through a configurable set of Nostr relays published via [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md). If one relay goes down, the others keep working. There is no central server that can be shut down, censored, or compelled to hand over data.

### Identity

Your identity is a [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) / [NIP-06](https://github.com/nostr-protocol/nips/blob/master/06.md) seed phrase that derives a Nostr keypair. You can generate one on the spot or import an existing one. There is no phone number, no email, no username registry. You own your identity because you hold the private key — not because a company's database says so.

Keys are stored locally in IndexedDB with AES-GCM encryption, protected by an optional PIN or passphrase with PBKDF2 (600,000 iterations). You can set a [NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md) human-readable alias (user@domain) and share your identity via QR code.

### Privacy

Tor integration runs entirely in the browser via a WASM build of [Arti](https://gitlab.torproject.org/tpo/core/arti) (webtor-rs). When enabled, all relay connections are routed through Tor circuits using Snowflake bridges, hiding your IP address from relay operators and bypassing national firewalls. If Tor fails, the app asks before falling back to a direct connection — there is no silent privacy degradation.

### Features

**Messaging**
- 1:1 encrypted text messaging with real-time delivery over Nostr relays
- Group chats up to 12 members using NIP-17 multi-recipient gift-wrap — relay operators cannot determine group membership
- Photo and video sharing via [Blossom](https://github.com/hzrd149/blossom) encrypted blob storage (AES-256-GCM)
- Message deletion (local and remote via [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md) kind 5)
- In-chat message search
- Message requests for unknown senders — strangers cannot message you directly

**Delivery & status**
- Four-state delivery indicators: sending → sent to relay → delivered → read
- Gift-wrapped delivery and read receipts (togglable per user)
- Offline message queue with relay backfill on reconnect
- Multi-relay redundancy — messages deliver even when some relays are down

**Identity & contacts**
- Deterministic [DiceBear](https://www.dicebear.com/) fun-emoji avatars generated from each pubkey
- Kind 0 profile fetch from relays (display name, avatar)
- Presence indicators via kind 30315 heartbeats
- Contact management by npub or QR code scan

**Privacy & security**
- Tor toggle with circuit status dashboard (guard → middle → exit)
- Tor latency overhead indicators per relay
- Read receipts privacy toggle
- Group invite privacy (Everyone / Contacts / Nobody)
- Passcode lock screen

**Infrastructure**
- Multi-relay pool with configurable relay list and NIP-65 publication
- Real-time relay status page (connected / disconnected / latency / R/W)
- Status icons in the search bar for Tor and relay health at a glance
- PWA installable on mobile and desktop, works offline for cached conversations
- Deployable from any origin — Cloudflare Pages, GitHub Pages, IPFS — for censorship resistance

### Architecture

The app runs Telegram Web K's full UI stack (Solid.js, TypeScript, Vite) but replaces the MTProto backend with a **Virtual MTProto Server** — an in-browser layer that intercepts all MTProto API calls and serves responses from local IndexedDB storage populated by Nostr relays. The Worker-based architecture (SharedWorker + ServiceWorker) is preserved. Zero connections are made to Telegram servers.

```
Nostr Relays (via Tor)
       |
   ChatAPI  <-  gift-wrap decrypt
       |
  message-store (IndexedDB)
       |
  Virtual MTProto Server  <-  intercepts getHistory, getDialogs, etc.
       |
  tweb Worker (appManagers)
       |
  Solid.js UI (unchanged)
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9

### Development

```bash
pnpm install
pnpm start
```

Open http://localhost:8080/ in your browser.

### Production build

```bash
pnpm build
```

The output is in the `dist/` folder. Copy its contents to any static web server.

### Docker

**Development:**
```bash
docker-compose up tweb.dependencies
docker-compose up tweb.develop
```
Open http://localhost:8080/

**Production:**
```bash
docker-compose up tweb.production -d
```
Open http://localhost:80/

You can also build a standalone image:
```bash
docker build -f ./.docker/Dockerfile_production -t nostra-chat:latest .
```

### Tests

```bash
pnpm test                     # all tests (Vitest)
pnpm test:nostra:quick        # critical P2P tests (~160 tests in <2s)
pnpm test:nostra              # full P2P test suite
pnpm lint                     # ESLint
```

### Debug query parameters

| Parameter | Effect |
|-----------|--------|
| `?test=1` | Use test data centers |
| `?debug=1` | Enable verbose logging |
| `?noSharedWorker=1` | Disable SharedWorker (useful for debugging) |

Example: `http://localhost:8080/?debug=1`

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI Framework | Solid.js (custom fork) |
| Language | TypeScript 5.7 |
| Build | Vite 5 |
| CSS | SCSS |
| Testing | Vitest + Playwright (E2E) |
| Package Manager | pnpm 9 |
| Protocol | Nostr (NIP-06, NIP-17, NIP-44, NIP-59, NIP-65) |
| Encryption | NIP-44 v2 + AES-256-GCM (media) |
| Storage | IndexedDB + CacheStorage + localStorage |
| Workers | SharedWorker + ServiceWorker |
| Privacy | Tor via webtor-rs (Arti WASM) |
| Media | Blossom encrypted blob storage |
| Avatars | DiceBear fun-emoji |

## Roadmap

- [x] Build pipeline & multi-mirror PWA distribution (Cloudflare, GitHub Pages, IPFS)
- [x] Crypto foundation — NIP-06 identity, NIP-44 encryption, AES-GCM key storage
- [x] Multi-relay pool with Tor privacy transport
- [x] 1:1 messaging — NIP-17 gift-wrap DMs, media, delivery tracking, message requests
- [x] Telegram MTProto fully disabled — zero server connections
- [x] Group messaging — NIP-17 multi-recipient groups with admin controls
- [ ] Broadcast channels — NIP-28 one-to-many channels
- [ ] Tor UI improvements — toggle, circuit dashboard, latency indicators
- [ ] In-browser mini-relay with store-and-forward capability
- [ ] P2P mesh — WebRTC DataChannel between contacts, tunneled through Tor

## Nostr NIPs implemented

| NIP | Purpose |
|-----|---------|
| [NIP-06](https://github.com/nostr-protocol/nips/blob/master/06.md) | Key derivation from BIP-39 seed phrase |
| [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md) | Event deletion (kind 5) |
| [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) | Private direct messages (gift-wrap) |
| [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) | Versioned encryption (v2) |
| [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) | Gift-wrap envelope (Rumor → Seal → Gift-Wrap) |
| [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) | Relay list metadata |

## Dependencies

* [BigInteger.js](https://github.com/peterolson/BigInteger.js) ([Unlicense](https://github.com/peterolson/BigInteger.js/blob/master/LICENSE))
* [fflate](https://github.com/101arrowz/fflate) ([MIT License](https://github.com/101arrowz/fflate/blob/master/LICENSE))
* [cryptography](https://github.com/spalt08/cryptography) ([Apache License 2.0](https://github.com/spalt08/cryptography/blob/master/LICENSE))
* [emoji-data](https://github.com/iamcal/emoji-data) ([MIT License](https://github.com/iamcal/emoji-data/blob/master/LICENSE))
* [emoji-test-regex-pattern](https://github.com/mathiasbynens/emoji-test-regex-pattern) ([MIT License](https://github.com/mathiasbynens/emoji-test-regex-pattern/blob/main/LICENSE))
* [rlottie](https://github.com/nicegram/nicegram-web-z.github.io) ([MIT License](https://github.com/nicegram/nicegram-web-z/blob/master/licenses/COPYING.MIT))
* [fast-png](https://github.com/image-js/fast-png) ([MIT License](https://github.com/image-js/fast-png/blob/master/LICENSE))
* [opus-recorder](https://github.com/chris-rudmin/opus-recorder) ([BSD License](https://github.com/chris-rudmin/opus-recorder/blob/master/LICENSE.md))
* [Prism](https://github.com/PrismJS/prism) ([MIT License](https://github.com/PrismJS/prism/blob/master/LICENSE))
* [Solid](https://github.com/solidjs/solid) ([MIT License](https://github.com/solidjs/solid/blob/main/LICENSE))
* [TinyLD](https://github.com/komodojp/tinyld) ([MIT License](https://github.com/komodojp/tinyld/blob/develop/license))
* [libwebp.js](https://libwebpjs.appspot.com/)
* fastBlur
* [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) ([MIT License](https://github.com/Vanilagy/mp4-muxer/blob/main/LICENSE))
* [nostr-tools](https://github.com/nbd-wtf/nostr-tools) ([Unlicense](https://github.com/nbd-wtf/nostr-tools/blob/master/LICENSE))
* [DiceBear](https://github.com/dicebear/dicebear) ([MIT License](https://github.com/dicebear/dicebear/blob/main/LICENSE))

## License

The source code is licensed under GPL v3. License is available [here](/LICENSE).
