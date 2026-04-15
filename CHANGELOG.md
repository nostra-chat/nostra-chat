# Changelog

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
