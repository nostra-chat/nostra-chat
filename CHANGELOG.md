# Changelog

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
