# Changelog

## [0.9.1](https://github.com/nostra-chat/nostra-chat/compare/v0.9.0...v0.9.1) (2026-04-20)


### Bug Fixes

* **update:** register popup listeners before updateBootstrap dispatches ([5372da1](https://github.com/nostra-chat/nostra-chat/commit/5372da124098b364ea3bb617cc254dbe4d6e5244))

## [0.9.0](https://github.com/nostra-chat/nostra-chat/compare/v0.8.3...v0.9.0) (2026-04-20)


### Features

* **settings:** mount App Updates tab with diagnostics, reset baseline, and inline explainer ([#49](https://github.com/nostra-chat/nostra-chat/issues/49)) ([f268022](https://github.com/nostra-chat/nostra-chat/commit/f268022cdb156b5f725530e62c414a4b67b20407))

## [0.8.3](https://github.com/nostra-chat/nostra-chat/compare/v0.8.2...v0.8.3) (2026-04-20)


### Bug Fixes

* **nostra:** populate getAvailableReactions stub so reactions menu renders ([#47](https://github.com/nostra-chat/nostra-chat/issues/47)) ([0a0f38a](https://github.com/nostra-chat/nostra-chat/commit/0a0f38a15989120ecc1695e91aaa45e8faafb7fb))

## [0.8.2](https://github.com/nostra-chat/nostra-chat/compare/v0.8.1...v0.8.2) (2026-04-20)


### Bug Fixes

* **update:** register already-installed SW URL to stop false compromise alerts on every deploy ([#45](https://github.com/nostra-chat/nostra-chat/issues/45)) ([ff6550f](https://github.com/nostra-chat/nostra-chat/commit/ff6550f6370dbb1d0e35c20ad328ea6c11337499))

## [0.8.1](https://github.com/nostra-chat/nostra-chat/compare/v0.8.0...v0.8.1) (2026-04-20)


### Bug Fixes

* **build:** apply solid plugin to worker bundle so TSX dynamic imports parse ([331b9ae](https://github.com/nostra-chat/nostra-chat/commit/331b9aee92aefe41e8cbe69a2f526df53b1b8275))

## [0.8.0](https://github.com/nostra-chat/nostra-chat/compare/v0.7.5...v0.8.0) (2026-04-20)


### Features

* **folders:** rename default folder to People, add icon picker, remove premium limit ([#40](https://github.com/nostra-chat/nostra-chat/issues/40)) ([7309b9e](https://github.com/nostra-chat/nostra-chat/commit/7309b9e1043e8708d50e7bfb139303e9dc74a671))
* **fuzz:** bug fuzzer phase 1 MVP — stateful property-based testing harness ([ef69141](https://github.com/nostra-chat/nostra-chat/commit/ef69141ddc46164f0f47707e5afba5960c8d2852))
* **fuzz:** phase 2a — stability pass (close 3 P2P blockers + medium/regression invariants + baseline) ([#41](https://github.com/nostra-chat/nostra-chat/issues/41)) ([596977e](https://github.com/nostra-chat/nostra-chat/commit/596977eb67add583711bb49610ba34520d1b3c06))
* **fuzz:** phase 2b.1 — reactions NIP-25 RX + 5 Phase-2a FINDs closed + identity triple architecture ([#42](https://github.com/nostra-chat/nostra-chat/issues/42)) ([da0f156](https://github.com/nostra-chat/nostra-chat/commit/da0f156863797c3f94268ea52183e9a17bfd46e2))
* **fuzz:** phase 2b.2a — lifecycle + 3 carry-forward FINDs closed + baseline v2b1 deferred to 2b.2b ([#43](https://github.com/nostra-chat/nostra-chat/issues/43)) ([8343763](https://github.com/nostra-chat/nostra-chat/commit/83437633134bccaf2c14a082c39cfdae5cbb224a))


### Bug Fixes

* **bubbles:** guard wrapSticker against undefined doc in empty-chat placeholder ([99301ac](https://github.com/nostra-chat/nostra-chat/commit/99301ace7f0b2778b73022baa867bcf177477760))
* **fuzz:** allowlist PEER_CHANGED_ERROR pageerror — intentional by-design cancellation ([10c7c2c](https://github.com/nostra-chat/nostra-chat/commit/10c7c2cefcd754a3f0675260fac575f407c829c2))
* **fuzz:** broaden internal-logger allowlist for ANSI-prefixed variants ([105a7c4](https://github.com/nostra-chat/nostra-chat/commit/105a7c4598c4a20f52017a7012e654227c89a4ff))
* **fuzz:** broaden Solid dev-warning allowlist to cover cleanups/effects/etc ([e749ed1](https://github.com/nostra-chat/nostra-chat/commit/e749ed12c0f82cc4eb9c3934b424d531e3a506df))
* **fuzz:** clear console ring after harness boot so startup noise isn't flagged ([3877bbc](https://github.com/nostra-chat/nostra-chat/commit/3877bbc227b0ec25267daef1ab76550ea6186892))
* **fuzz:** INV-sent-bubble-visible-after-send uses trimmed text (same as postcondition) ([633aed7](https://github.com/nostra-chat/nostra-chat/commit/633aed7816aba1b05ba85e99b775755930cec4a8))
* **fuzz:** mute INV-no-dup-mid, restore reply action ([2901536](https://github.com/nostra-chat/nostra-chat/commit/290153678437fbbe9eb828293dfe180efb732434))
* **fuzz:** mute react + delete postconditions — dominated signal, deferred to Phase 2 ([a80685b](https://github.com/nostra-chat/nostra-chat/commit/a80685b0be5edb4c053dd5cf95eed0fb0f54d146))
* **fuzz:** mute replyToRandomBubble pending dup-mid investigation ([079446f](https://github.com/nostra-chat/nostra-chat/commit/079446f629267100a02883c60924e1172d513439))
* **fuzz:** peer-changed allowlist regex — match multi-line pageerror (stack trace follows) ([d82c0b8](https://github.com/nostra-chat/nostra-chat/commit/d82c0b8561b4421c277f5938ce4bdb69fc9e6bcf))
* **fuzz:** POST_sendText_bubble_appears uses trimmed text — tweb trims whitespace on send ([0ac0c9f](https://github.com/nostra-chat/nostra-chat/commit/0ac0c9f918c3d628b972a0087fdfe8c7923418d0))
* **fuzz:** signature normalisation + broaden internal-logger allowlist ([0d739be](https://github.com/nostra-chat/nostra-chat/commit/0d739beb7aac7831a2c5753c1c20c7a3c0703210))
* **fuzz:** signature normalise — collapse emoji + decimal mid + HEX ordering ([d6dbdc9](https://github.com/nostra-chat/nostra-chat/commit/d6dbdc92b3bf8a0eb6887d1ca3d680dcb2ea1d5d))
* **reaction:** guard center_icon access when availableReaction is missing (Nostra stub) ([8dc2c86](https://github.com/nostra-chat/nostra-chat/commit/8dc2c86cacc06fbb074dd06ee20c00a91bfb41b1))
* **reaction:** skip around-animation when reaction + sticker + effect all missing ([ea3ea98](https://github.com/nostra-chat/nostra-chat/commit/ea3ea983426616aeb3ed851759d1b5b74dd14af8))
* **security:** verify inbound sigs, bind seal↔rumor pubkey, zero keys on logout ([954d5bc](https://github.com/nostra-chat/nostra-chat/commit/954d5bc75004c1d86e95ff793be674dfc6f0f7e9))
* **stickers:** don't throw NO_STICKERS when sticker backend is empty (Nostra) ([e600677](https://github.com/nostra-chat/nostra-chat/commit/e60067732b9de24481b8ebb9ac087b7e352fac58))
* **vmtproto:** static response for messages.getMessageReactionsList ([04d07ff](https://github.com/nostra-chat/nostra-chat/commit/04d07ffd322088720f00047fb31c865b1d95cc5a))
* **vmtproto:** static responses for chat-open MTProto methods + diagnostic fallback log ([fbd8b56](https://github.com/nostra-chat/nostra-chat/commit/fbd8b56b3aeae5d0536377aec2c7c05345ecdee5))


### Performance

* **build:** drop prod sourcemaps, slim prism, gate visualizer ([5f9b01f](https://github.com/nostra-chat/nostra-chat/commit/5f9b01f9932cba49baa752d9ecd8551260359bdd))

## [0.7.5](https://github.com/nostra-chat/nostra-chat/compare/v0.7.4...v0.7.5) (2026-04-17)


### Bug Fixes

* **contacts:** consolidate P2P contact add into single robust helper ([c10fc89](https://github.com/nostra-chat/nostra-chat/commit/c10fc89bf6c4f5d530a5dd6abf16a20d7680c9a2))

## [0.7.4](https://github.com/nostra-chat/nostra-chat/compare/v0.7.3...v0.7.4) (2026-04-17)


### Bug Fixes

* **boot:** skip update-bootstrap in dev; lazy-load confirmationPopup in resetLocalData ([b1c4721](https://github.com/nostra-chat/nostra-chat/commit/b1c4721c784d1c5fd13449e784bc55acb63b8483))

## [0.7.3](https://github.com/nostra-chat/nostra-chat/compare/v0.7.2...v0.7.3) (2026-04-17)


### Bug Fixes

* **update:** capture bundle SW URL in Step 0 + catch unexpected waiting SW ([06bbbe5](https://github.com/nostra-chat/nostra-chat/commit/06bbbe5497aea861763874d5d6d69bb306335297))

## [0.7.1](https://github.com/nostra-chat/nostra-chat/compare/v0.7.0...v0.7.1) (2026-04-16)


### Bug Fixes

* **lint:** fix eslint errors and add pre-commit hook ([e1e782a](https://github.com/nostra-chat/nostra-chat/commit/e1e782a0d29d0db599ea977f0c2e70c5536a0d61))
* **tests:** repair all nostra test failures and unhandled rejections ([f4b76a5](https://github.com/nostra-chat/nostra-chat/commit/f4b76a54ad4a54faa21cf4efc6e4e207411ba882))

## [0.7.0](https://github.com/nostra-chat/nostra-chat/compare/v0.6.0...v0.7.0) (2026-04-16)


### Features

* **relay-ui:** add card-based SCSS for relay settings restyle ([a74dee5](https://github.com/nostra-chat/nostra-chat/commit/a74dee5be579956d6b6c370c2d02635a2bcb3f70))
* **relay-ui:** restyle relay settings with card layout and pill chips ([01889f6](https://github.com/nostra-chat/nostra-chat/commit/01889f626392ecf56babc4765cdde848752ffb75))
* **tor-ui:** add nostra_tor_enabled_changed event and shared TorUiState helper ([84e7af6](https://github.com/nostra-chat/nostra-chat/commit/84e7af6d530da77ff464ab839f30831d91e20fcc))
* **tor-ui:** disabled state on Status tab + shortcut links to Privacy and Relays ([44fd678](https://github.com/nostra-chat/nostra-chat/commit/44fd678de242340348eb5c22c5058bb95683f136))
* **tor-ui:** show 'Disabilitato' in TorStatus popup when Tor is off ([9be8154](https://github.com/nostra-chat/nostra-chat/commit/9be81542470f3fb8129a6d431437a452fde76f0c))
* **tor-ui:** show grey disabled onion icon when Tor is off ([f051240](https://github.com/nostra-chat/nostra-chat/commit/f0512409962ca5638e25883c750f2bfc3cd52910))

## [0.6.0](https://github.com/nostra-chat/nostra-chat/compare/v0.5.0...v0.6.0) (2026-04-16)


### Features

* **auth:** add keepNostraIdentity flag to logOut() ([b0c963d](https://github.com/nostra-chat/nostra-chat/commit/b0c963d1e2368e3aad426262919506b4f92cca6b))
* **boot:** surface Reset Local Data confirmation toast ([3c1e89c](https://github.com/nostra-chat/nostra-chat/commit/3c1e89cb4e20e64b5d234caa00861677974a8835))
* **nostra:** add per-peer kind 0 profile cache with SWR refresh ([bf95604](https://github.com/nostra-chat/nostra-chat/commit/bf956043897cb6b3388475ff2a5160f2737eae8b))
* **nostra:** add usePeerNostraProfile Solid store ([703f654](https://github.com/nostra-chat/nostra-chat/commit/703f65429816435b611cbb93c7aa8dffd080197d))
* **nostra:** hydrate UserFull.about from peer profile cache ([b74ce5d](https://github.com/nostra-chat/nostra-chat/commit/b74ce5d96e7589f25fc1aab8da0a53a284a15e76))
* **nostra:** P2P media send — images, files, voice notes via AES-GCM E2EE + Blossom ([be2f720](https://github.com/nostra-chat/nostra-chat/commit/be2f720ff75aa117bb183189f4912a9731bf7e26))
* **nostra:** wipe peer profile cache on logout ([d7bbbc9](https://github.com/nostra-chat/nostra-chat/commit/d7bbbc956ff89bd29d2dd14e44927285fb8d5398))
* **popups:** add Reset Local Data popup ([a3f1213](https://github.com/nostra-chat/nostra-chat/commit/a3f1213440b8bfff1ff6ed13be974c332cfce4dd))
* **profile:** render peer kind 0 website/lud16/nip05 rows ([eaf09ec](https://github.com/nostra-chat/nostra-chat/commit/eaf09ec638ced8e94eef5ae12a2cc03dc69351e0))
* **settings:** add Reset Local Data menu entry above Logout ([fcf46c8](https://github.com/nostra-chat/nostra-chat/commit/fcf46c80660aab9409ff0f523b0796909b3b4fe0))

## [0.5.0](https://github.com/nostra-chat/nostra-chat/compare/v0.4.2...v0.5.0) (2026-04-15)


### Features

* **bugs:** in-app bug reporter with public & private paths ([9e5318f](https://github.com/nostra-chat/nostra-chat/commit/9e5318f7476f77aeb0cc1f4709562041cd51984d))


### Bug Fixes

* **nostra:** upgrade chat-list peer title with kind 0 display name ([c58c5c3](https://github.com/nostra-chat/nostra-chat/commit/c58c5c3a78290fdffb73a5450f8f885da2bfe0e2))

## [0.4.2](https://github.com/nostra-chat/nostra-chat/compare/v0.4.1...v0.4.2) (2026-04-15)


### Bug Fixes

* **nostra:** dedup relay replays against persistent store ([d9c8c45](https://github.com/nostra-chat/nostra-chat/commit/d9c8c459de2cd4b611423ff8d36c9a24297d8cd1))

## [0.4.1](https://github.com/nostra-chat/nostra-chat/compare/v0.4.0...v0.4.1) (2026-04-15)


### Bug Fixes

* **qr:** seed npub from storage on QR tab open ([312d500](https://github.com/nostra-chat/nostra-chat/commit/312d500f422775471d450baae2c5f484bd797ab4))

## [0.4.0](https://github.com/nostra-chat/nostra-chat/compare/v0.3.0...v0.4.0) (2026-04-15)


### Features

* **ipfs:** cloudflare worker gateway for ipfs.nostra.chat ([df9d3ac](https://github.com/nostra-chat/nostra-chat/commit/df9d3ac02a252477e55bfd9d82a6aeb40fea7768))
* **ipfs:** stable ipfs.nostra.chat URL via Cloudflare DNSLink ([3943c45](https://github.com/nostra-chat/nostra-chat/commit/3943c4546b84f6ef5910a52130bc3488e763294a))
* **ui:** move My QR Code from settings to hamburger menu ([42820e4](https://github.com/nostra-chat/nostra-chat/commit/42820e44bd9e64c127144051a24505e1871c0a21))


### Bug Fixes

* **mobile:** keep chat topbar visible when virtual keyboard opens ([ebc8198](https://github.com/nostra-chat/nostra-chat/commit/ebc819811349bc0f5b82bccd2329765d8cd2c0a0))
* **tor-status:** show real relay latency instead of -1ms ([68d0f80](https://github.com/nostra-chat/nostra-chat/commit/68d0f80293a0115ab21ba6fddffc3dcb9ad5a21d))

## [0.3.0](https://github.com/nostra-chat/nostra-chat/compare/v0.2.1...v0.3.0) (2026-04-15)


### Features

* QR key exchange (display + scanner + FAB Add Contact) ([#18](https://github.com/nostra-chat/nostra-chat/issues/18)) ([6acea14](https://github.com/nostra-chat/nostra-chat/commit/6acea14b0ceda108f2fc26b06a005eea3e588b84))

## [0.2.1](https://github.com/nostra-chat/nostra-chat/compare/v0.2.0...v0.2.1) (2026-04-14)


### Bug Fixes

* **tor-banner:** prevent app bottom overflow when banner is visible ([8d07c22](https://github.com/nostra-chat/nostra-chat/commit/8d07c22bd8db46d2889c4d1fc4188d730f871cf1))
* **unread:** track P2P unread count per peer and clear on chat open ([ae4cdfb](https://github.com/nostra-chat/nostra-chat/commit/ae4cdfbe7b48a158ef48379a99df20cb22b06229))

## [0.2.0](https://github.com/nostra-chat/nostra-chat/compare/v0.1.0...v0.2.0) (2026-04-14)


### Features

* **folders:** default folders (All/Persons/Groups) + Nostr multi-device sync ([#14](https://github.com/nostra-chat/nostra-chat/issues/14)) ([9a2318d](https://github.com/nostra-chat/nostra-chat/commit/9a2318d9cadb17e26de3263efcb032f8fe350b20))
* **settings:** add Notifications entry with not-implemented markers ([a05e0a5](https://github.com/nostra-chat/nostra-chat/commit/a05e0a5a7aa58895dc9d02be860d8b43f398f162))
* **settings:** profile row with avatar and click-to-copy npub ([0475a1b](https://github.com/nostra-chat/nostra-chat/commit/0475a1b63320ef74b677c88a31f63b61fada84d0))
* **tor:** show real circuit relays and redesign Tor Circuit dashboard ([1c68189](https://github.com/nostra-chat/nostra-chat/commit/1c68189db43d4612c97bdc59a2387b67770e1bb4))


### Bug Fixes

* **e2e:** stabilize bug-regression test (Tor stall + input races) ([#16](https://github.com/nostra-chat/nostra-chat/issues/16)) ([6f407a1](https://github.com/nostra-chat/nostra-chat/commit/6f407a1917d88784b70b0c33f085c0719c8bc4a3))
* **folders:** allow editing protected Persons/Groups folders via context menu ([3f7ecc3](https://github.com/nostra-chat/nostra-chat/commit/3f7ecc3e3bf75e7b66e3c3c8ba8d1537600bce31))
* **folders:** default tabsInSidebar to true so desktop shows folders on the left ([872f442](https://github.com/nostra-chat/nostra-chat/commit/872f442a945f4e2f5a8138c414577fcb1f242c58))
* **folders:** drop LANGPACK sentinel, seed default folders with literal titles ([698b7c6](https://github.com/nostra-chat/nostra-chat/commit/698b7c632232cdbfb4fc2f1e234271e33552c058))
* **profile:** preserve picture/about/website on kind 0 republish ([003ee4d](https://github.com/nostra-chat/nostra-chat/commit/003ee4d348c3ddb176d3efa7101e5d15b9de83c7))
* **pwa:** set manifest href at HTML parse time so Chrome Android shows Install app ([e889310](https://github.com/nostra-chat/nostra-chat/commit/e88931068b8032831f9e41923c0736c8c0ee4efc))
* **sidebar:** flatten More submenu into hamburger and fix Report Bug URL ([a4e938d](https://github.com/nostra-chat/nostra-chat/commit/a4e938d8c24dd6d425e4569c70d4683791fe23fb))
* **ui:** correct relay/Tor status icons and swap in Nostrich logo ([c70e746](https://github.com/nostra-chat/nostra-chat/commit/c70e746dd3171016894e369d6cae17240d03462e))

## [0.1.0](https://github.com/nostra-chat/nostra-chat/compare/v0.0.2...v0.1.0) (2026-04-13)


### Features

* **p2p:** edit-message protocol primitives + ChatAPI.editMessage ([d61c9fe](https://github.com/nostra-chat/nostra-chat/commit/d61c9fef1a2ed7f5c2d46388d4101fb4ff25fffe))
* **p2p:** receive-side handling for edit messages ([b931de4](https://github.com/nostra-chat/nostra-chat/commit/b931de4381813e8b0c673baef84be40389243dbb))
* **p2p:** wire editMessage through Virtual MTProto ([840dd45](https://github.com/nostra-chat/nostra-chat/commit/840dd45297a12afa1acd447e47d1d02532391709))
* **profile:** cache-first own profile sync with relay refresh ([#12](https://github.com/nostra-chat/nostra-chat/issues/12)) ([a0cb1f3](https://github.com/nostra-chat/nostra-chat/commit/a0cb1f372470c4bc57a5407cbefca99843f7bcc0))
* **profile:** drop last_name, add website and lud16 nostr fields ([#11](https://github.com/nostra-chat/nostra-chat/issues/11)) ([cbe9b37](https://github.com/nostra-chat/nostra-chat/commit/cbe9b37d58086a7204ecaef4368849cb578a72e0))
* **profile:** sidebar profile row + merged edit tab + blossom avatar upload ([#10](https://github.com/nostra-chat/nostra-chat/issues/10)) ([2e67aaa](https://github.com/nostra-chat/nostra-chat/commit/2e67aaa8968ed3430091384309f3976cefe42dfc))
* **security:** dedicated Recovery Phrase tab with styled 12-word grid ([71d98f5](https://github.com/nostra-chat/nostra-chat/commit/71d98f50e5c0176a36292112dd3535036631f31e))
* **tor:** real Tor WASM runtime with fresh consensus and e2e coverage ([a8b2fb1](https://github.com/nostra-chat/nostra-chat/commit/a8b2fb1d435adea629e7d2019d6c98ddc9b2ee55))
* **tor:** Tor-first connection flow with consensus cache and startup UI ([619feac](https://github.com/nostra-chat/nostra-chat/commit/619feace8691720257533251be9df9eeca8e8e55))


### Bug Fixes

* **build:** inject package.json version into VITE_VERSION ([d4b5dce](https://github.com/nostra-chat/nostra-chat/commit/d4b5dce47c2f75e28d802ee7ab01ef47c634d4f4))
* **p2p:** blue read receipts now render on sender bubbles ([b952e7f](https://github.com/nostra-chat/nostra-chat/commit/b952e7f5dffcc0e46075ee025f53536db1cd1fe2))
* **p2p:** guard nostra-mode crashes and refresh default relay list ([bb24f32](https://github.com/nostra-chat/nostra-chat/commit/bb24f327745e414637fff3e067287f0926275d69))
* **sidebar:** read version from App.version and link to release notes ([7a56f43](https://github.com/nostra-chat/nostra-chat/commit/7a56f4332a5fe558ad11172f1aa8729a8ca4350c))
* **tor-ui:** theme popup colors, fix empty relay rows, hydrate circuit dashboard ([31d1fe6](https://github.com/nostra-chat/nostra-chat/commit/31d1fe6564ef2d6877dc754d57a1d928fecc9878))
* **tor:** reserve layout space for startup banner so it no longer overlaps UI ([b482ae9](https://github.com/nostra-chat/nostra-chat/commit/b482ae97573ccc8599224f5bf68d6c8d391b9113))
* **ui:** visible mesh icon + clip-free recovery word grid ([3ac9620](https://github.com/nostra-chat/nostra-chat/commit/3ac9620dd0b43f98cfd93f4bbbc2377b7776cc12))

## [0.0.2](https://github.com/nostra-chat/nostra-chat/compare/v0.0.1...v0.0.2) (2026-04-12)


### Documentation

* add feature comparison table vs other messengers ([#2](https://github.com/nostra-chat/nostra-chat/issues/2)) ([c8dd32a](https://github.com/nostra-chat/nostra-chat/commit/c8dd32a0047ec8c437ee894e0d8c4f14e057bab4))
* remove redundant 'signup without email' row from comparison table ([#4](https://github.com/nostra-chat/nostra-chat/issues/4)) ([37e7fa3](https://github.com/nostra-chat/nostra-chat/commit/37e7fa3c23ac335e04e13512f75c0238b747d543))
