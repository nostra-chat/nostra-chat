# CLAUDE.md — Nostra.chat

## Project Overview

**Nostra.chat** is a decentralized messaging client (https://nostra.chat/) built with Solid.js and TypeScript. Forked from Telegram Web K, it replaces the Telegram backend with peer-to-peer encrypted chat over Nostr relays. The codebase is large (~100k+ lines excluding vendor), mature, and highly performance-oriented. License: GPL v3.

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | Solid.js (custom fork in `src/vendor/solid/`) |
| Language | TypeScript 5.7 |
| Build | Vite 5 |
| CSS | SCSS (sass) |
| Testing | Vitest (unit) + Playwright (E2E) |
| Package Manager | pnpm 9 |
| Protocol | Nostr (NIP-06, NIP-17, NIP-44, NIP-59, NIP-65) |
| Storage | IndexedDB + CacheStorage + localStorage |
| Workers | SharedWorker + ServiceWorker |

## Development

```bash
pnpm install
pnpm start          # Dev server on :8080
pnpm build          # Production build → dist/
pnpm test           # Run tests (Vitest)
pnpm test:nostra:quick  # Critical P2P tests only (~160 tests in <2s)
pnpm test:nostra        # Full P2P test suite
pnpm lint           # ESLint on src/**/*.{ts,tsx}
```

**Pre-commit hook:** husky + lint-staged runs `eslint` on staged `src/**/*.{ts,tsx}` files. Do NOT use `--no-verify` — fix the lint error instead.

**Debug query params:** `?test=1` (test DCs), `?debug=1` (verbose logging), `?noSharedWorker=1` (disable shared worker).

**Dev-mode gotchas (`pnpm start` only, do NOT fight them):**
- `updateBootstrap()` in `src/index.ts:405` is guarded by `import.meta.env.PROD` — Vite HMR regenerates the SW hash each session, so running the Phase A bootstrap in dev false-positives Step 1a and shows the "possibile compromissione rilevata" alert. Build + serve from `dist/` to test the update flow.
- `resetLocalData.ts` lazy-imports `confirmationPopup` and `clearAllExceptSeed`. Static imports pull in `popups/index` → `popups/peer`, causing a circular-init race: `ReferenceError: Cannot access 'PopupPeer' before initialization`.
- **Multi-instance rootScope**: HMR/dynamic imports can create separate `rootScope` instances. Listeners registered on one won't receive dispatches on another. Before adding defenses for a "missing listener" bug, verify the listeners actually exist on the rootScope the app dispatches on. Production builds don't hit this.
- Regression coverage: `src/tests/e2e/e2e-dev-boot-smoke.ts` asserts the dev server boots without TDZ or the compromise banner.

## Directory Structure

```
src/
├── components/       # Solid.js UI components (.tsx)
│   ├── chat/         # Chat bubbles, topbar, sidebars
│   ├── popups/       # Modal/popup components
│   ├── mediaEditor/  # Media editing UI
│   └── ...           # 200+ feature folders
├── lib/
│   ├── appManagers/  # 55+ domain managers (chats, users, messages, etc.)
│   ├── nostra/       # P2P messaging (Virtual MTProto server, sync, ChatAPI, relay pool, crypto)
│   ├── mtproto/      # MTProto protocol implementation
│   ├── storages/     # IndexedDB/localStorage wrappers
│   ├── rootScope.ts  # Global event emitter & app context
│   └── mainWorker/   # Background worker logic
├── stores/           # Solid.js reactive stores (13 stores)
├── helpers/          # 145+ utility functions
├── hooks/            # Solid.js hooks
├── pages/            # Auth pages (login, signup, etc.)
├── config/           # App constants, state schema, emoji, currencies
├── environment/      # Browser feature detection (39 modules)
├── scss/             # Global stylesheets
├── vendor/           # Third-party forks (solid, solid-transition-group)
├── scripts/          # Build & codegen scripts
└── tests/            # Test files
```

## Path Aliases

Always use these aliases instead of relative paths:

```typescript
@components/*   → src/components/
@helpers/*      → src/helpers/
@hooks/*        → src/hooks/
@stores/*       → src/stores/
@lib/*          → src/lib/
@appManagers/*  → src/lib/appManagers/
@environment/*  → src/environment/
@config/*       → src/config/
@vendor/*       → src/vendor/
@layer          → src/layer.d.ts    (MTProto API types)
@types          → src/types.d.ts    (utility types)
@/*             → src/

// Solid.js resolves to the custom fork:
solid-js        → src/vendor/solid
solid-js/web    → src/vendor/solid/web
solid-js/store  → src/vendor/solid/store
```

## Code Style (enforced by ESLint)

- **Indent**: 2 spaces (no tabs)
- **Quotes**: single quotes; template literals allowed
- **Line endings**: Unix (LF); file must end with newline
- **No trailing spaces**
- **Comma dangle**: never (`{a: 1, b: 2}` not `{a: 1, b: 2,}`)
- **Object/array spacing**: no spaces inside `{}` or `[]` (`{a: 1}` not `{ a: 1 }`)
- **Keyword spacing**: no space after `if`, `for`, `while`, `switch`, `catch` (`if(condition)` not `if (condition)`)
- **Function paren**: no space before paren — `function foo()` not `function foo ()`
- **No `return await`**: use `return promise` directly
- **Max 2 consecutive blank lines**
- **`prefer-const`** with destructuring: `all`
- **Ternary operators**: `?` / `:` go at END of line, not start of next: `condition ?\n  value1 :\n  value2` — never `condition\n  ? value1`

## TypeScript Notes

- `strict: true` but `strictNullChecks: false` and `strictPropertyInitialization: false`
- `useDefineForClassFields: false` — important for class field behavior
- `jsxImportSource: solid-js` — JSX is Solid.js, not React
- MTProto types live in `src/layer.d.ts` (664KB, auto-generated); import from `@layer`
- Utility types (AuthState, WorkerTask, etc.) live in `src/types.d.ts`; import from `@types`

## Key Patterns

- **Solid components** live in `.tsx` files. Props typed inline. Use `classNames()` from `@helpers/string/classNames` for class composition. JSX resolves to the custom Solid fork — NO React imports, NO React patterns.
- **Scoped styles**: `.module.scss` next to the component, imported as `styles` (e.g. `<div class={styles.wrap}>`). Global styles in `src/scss/`. BEM-like naming. CSS variables drive theming.
- **Stores** in `src/stores/` use `createRoot` + `createSignal`, subscribe to `rootScope` events at module top-level, and export a hook returning the signal getter.
- **App managers** in `src/lib/appManagers/` subclass `AppManager` and init in their `after()` hook. They run Worker-side, communicate via `rootScope` events, and are accessed as `rootScope.managers.appSomethingManager`.
- **Global bus**: `rootScope` from `@lib/rootScope` is the event emitter and context. Events typed in `BroadcastEvents` — no `as any` casts.

## Important Files

| File | Purpose |
|---|---|
| `src/index.ts` | App entry point, account/auth init |
| `src/lang.ts` | All i18n strings (232KB) |
| `src/layer.d.ts` | MTProto API types (auto-generated, 664KB) |
| `src/types.d.ts` | Utility/app types |
| `src/global.d.ts` | Global interface augmentations |
| `src/config/state.ts` | Application state schema |
| `src/config/app.ts` | App constants |
| `src/lib/rootScope.ts` | Global event emitter |
| `vite.config.ts` | Build configuration |
| `eslint.config.mjs` | ESLint flat config |
| `src/lib/nostra/virtual-mtproto-server.ts` | Virtual MTProto Server — intercepts MTProto calls, returns native responses |
| `src/lib/nostra/nostra-sync.ts` | Incoming message persistence + event dispatch |
| `src/lib/nostra/nostra-peer-mapper.ts` | Creates tweb-native User/Chat/Message/Dialog objects |
| `src/lib/nostra/chat-api.ts` | ChatAPI — relay pool, gift-wrap, send/receive |
| `src/lib/nostra/nostr-relay-pool.ts` | Multi-relay connection pool |
| `src/lib/apiManagerProxy.ts` | Main-thread proxy to Worker managers |
| `docs/ARCHITECTURE.md` | Deep architecture notes (Tor, Vitest/E2E quirks, profile sync, Phase A) |
| `docs/RELEASE.md` | Release pipeline reference |

## What NOT to Do

- Do not add `eslint-disable` without a reason
- Do not use `return await` (rule enforced)
- Do not use spaces inside `{}` for objects or `[]` for arrays
- Do not use `if (` with a space — use `if(`
- Do not import from `react` or use React patterns — this is Solid.js
- Do not use relative `../../` imports when an alias exists
- Do not use `var` — use `const`/`let`
- Do not add trailing commas in arrays/objects
- Do not save screenshots/images in the project root — use `/tmp/`. `.gitignore` blocks `*.png` at root.
- Do not assume a component is mounted just because the file exists — grep for imports (`MessageRequests.tsx` existed but was never mounted).
- Do not assume a `rootScope.dispatchEvent('foo')` is wired — grep for listeners before relying on it.
- Do not edit `package.json` version manually — use `pnpm version` or release-please.
- Do not open two Claude Code instances in the same working directory — use `git worktree add ../nostra.chat-wt/<name> -b <branch> main`, one Claude per worktree.
- Do not remove the `!public/recorder.min.js` exception in `.gitignore` — it's a third-party UMD imported statically from `src/components/chat/input.ts`.
- Do NOT narrow the `lint` / `lint-staged` globs back to `src/**/*.ts` — must be `src/**/*.{ts,tsx}`. Solid components live in `.tsx` files; the narrow glob lets indent/formatting errors reach CI where `vite-plugin-checker` catches them, blocking release.

## Release & Deployment

Full reference: [`docs/RELEASE.md`](docs/RELEASE.md). Day-to-day rules:

- Pipeline triggers **only on `v*` tags** (`.github/workflows/deploy.yml`). Push to `main` directly — no CI on main.
- Two release paths: merge the open `chore(main): release X.Y.Z` PR from release-please, OR run `pnpm version patch|minor|major` locally. Never edit `package.json` version or `CHANGELOG.md` by hand.
- Conventional Commits: `feat:`/`fix:`/`perf:`/`revert:` bump version; everything else is hidden from changelog. **PR titles must also be Conventional** — squash-merge uses the PR title as the single commit on `main`, and release-please parses only that. Non-Conventional titles silently skip release-please (no release PR, no CHANGELOG entry). Recovery: `pnpm version patch` locally — but CHANGELOG will be empty for that bump.
- Do NOT enable auto-merge on the release-please PR (accumulates commits, merge manually when releasing).
- Do NOT re-add `push: branches: main` / `pull_request:` triggers to `deploy.yml`.
- `pnpm version` runs `preversion = pnpm lint && npx tsc --noEmit` — **any pre-existing lint error anywhere in `src/**/*.ts` blocks the release**, even if unrelated to your change. Fix and push before re-running `pnpm version`.
- `.release-please-manifest.json` is release-please's sole source of truth for "last released version" (it does NOT read git tags or `package.json`). Out-of-sync manifest = release-please proposes an already-shipped version and the release PR collides with the existing tag (PR #33 incident). The `version` lifecycle hook auto-syncs it on `pnpm version`, and `preversion` guards against an already-drifted manifest via `node src/scripts/sync-release-manifest.mjs --check` — so normally you don't touch this file. Only manual intervention is when release-please's own merge path is bypassed in a way the hook can't see (e.g. hand-editing `package.json`, which policy forbids anyway).
- **IPFS stable URL** `https://ipfs.nostra.chat` is served by `cloudflare-worker/` (DoH DNSLink lookup + proxy to `<cid>.ipfs.dweb.link`). Do NOT `CNAME ipfs → <any public gateway>` — Cloudflare error 1014 (CNAME Cross-User Banned) when proxied, 403 when DNS-only. The Worker route intercepts before CNAME resolution, so the `ipfs` DNS record content is irrelevant as long as it exists with orange proxy. `CLOUDFLARE_API_TOKEN` (Pages token) also has Workers:Edit → reused by the `deploy-worker` job.

## Nostra.chat Architecture Notes

For deep subsystem notes (Tor runtime, Vitest/E2E test quirks, profile sync internals, Phase A update system, profile tab layout, Blossom upload) see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Topics below stay in CLAUDE.md because they're **rules** that apply broadly across any change — not just when you're working on one subsystem.

### Worker Context
- Managers run in a DedicatedWorker even with `noSharedWorker=true`. `src/lib/appManagers/` + `src/lib/storages/` run Worker-side where `window` is undefined — never import window-touching modules there without `typeof window !== 'undefined'` guards.
- `getSelf()` returns `undefined` in Nostra mode (no MTProto auth) — guard all `.id` access.
- `rootScope.myId === NULL_PEER_ID` (0) → `isOurMessage()` uses `pFlags.out` as fallback.
- Worker `rootScope` events don't cross to main thread (separate instances). Only `message_sent`/`messages_pending` are mirrored via MessagePort.

### Peer Mirroring
Storing a user in Worker's `appUsersManager.users[]` is NOT enough — call `this.mirrorUser(user)` to sync to `apiManagerProxy.mirrors.peers` and the Solid `peers` store. Without mirroring, `getPeer()`/`usePeer()` return `undefined` on main thread.

### Virtual MTProto Architecture (MessagePort Bridge)
`nostraIntercept()` in `apiManager.ts` routes Worker method calls: **Static** (`NOSTRA_STATIC` — `help.getConfig`, `updates.getState`, `account.*`, `stories.*`) return shaped stubs; **Bridge** (`NOSTRA_BRIDGE_METHODS` — getHistory, getDialogs, search, deleteMessages, sendMessage, sendMedia, getContacts, getUsers, getFullUser, editMessage) forward via `port.invoke('nostraBridge', ...)` to main-thread `apiManagerProxy` → `NostraMTProtoServer.handleMethod()` → `message-store.ts` (IndexedDB) → native MTProto response. Worker processes normally via `saveMessages()` → `setMessageToStorage()` → mirror → UI. `NostraSync` handles incoming ChatAPI messages → persist → dispatch `nostra_new_message`. Design principle: vanilla tweb code works unchanged; the bridge is transparent. Debug: `window.__nostraMTProtoServer`.

### Virtual MTProto Middleware Rules

| Rule | Why |
|---|---|
| `createTwebUser()` in `virtual-mtproto-server.ts` MUST pass `firstName: mapping?.displayName` via `getMapping()` | Omitting → hex fallback names overwrite correct names after reload |
| `NOSTRA_ACTION_PREFIXES` in `apiManager.ts` must NOT contain `.get` or `.check` | Query methods need shaped responses, not `return true` |
| P2P send shortcut in `appMessagesManager.ts` must dispatch `message_sent` (not just `messages_pending`) AND call `setMessageToStorage()` | Needed for bubble ⏳→✓ transition + context menu |
| `window.__nostraOwnPubkey` must be set in `nostra-onboarding-integration.ts` | `contacts.ts` needs it to persist conversations |
| `saveApiUser()` preserves P2P synthetic user's `first_name` | Prevents bridge responses overwriting nicknames with hex fallbacks |
| `nostra_new_message` handler must build messages via `mapper.createTwebMessage()` directly | Never re-read from message-store — IndexedDB round-trip has 0-5s latency and silently drops messages |
| Call `rs.managers.appMessagesManager.invalidateHistoryCache(peerId)` after `nostra_new_message` arrives | Resets `SlicedArray`; without it, reopened chats return stale history |
| Synthetic dialogs via `dialogs_multiupdate` must carry `(dialog as any).topMessage = msg` (full object) | Else `setLastMessage` falls back to `getMessageByPeer` and fails when `hasReachedTheEnd=false` |
| `NostraSync.onIncomingMessage()` MUST save with `eventId = msg.relayEventId \|\| msg.id` | Mismatched eventIds (parsed `chat-XXX-N` vs rumor hex) → duplicate rows → two bubbles |
| `ChatAPI.connect(peerPubkey)` MUST be a lightweight `activePeer` switch, NOT `disconnect()` + reconnect | `disconnect()` tears down the relay pool and kills the self-echo subscription |
| `inputMessagesFilterPinned` intercepted in BOTH `searchMessages` AND `getHistory`, return empty | `ChatPinnedMessage` routes via either depending on context |
| VMT `sendMessage` must return `nostraMid` + `nostraEventId` | Worker's P2P shortcut renames temp mid `0.0001` → real timestamp mid; without this, outgoing bubbles sort wrong |
| `generateTempMessageId` MUST use `base + 1` (integer) for `base >= 2^50`, NOT `base + 0.0001` | Float precision collapses for P2P virtual mids ≈1.78e15 → tempMid == topMessage → `message_sent` overwrites incoming bubble's `data-mid` → dup-mid (FIND-cfd24d69) |
| `beforeMessageSending` MUST skip `history_append` dispatch for P2P peers (`peerId >= 1e15`) | Main-thread `injectOutgoingBubble` is sole render path; dual dispatch → duplicate DOM |
| Main-thread VMT code MUST use `rs.dispatchEventSingle(...)`, never `rs.dispatchEvent(...)` | The latter forwards via `MTProtoMessagePort` and throws unhandled rejections in vitest |
| `messages.editMessage` MUST be in `NOSTRA_BRIDGE_METHODS` | Otherwise `.edit` action prefix short-circuits it |

**P2P edit protocol**: edits are new NIP-17 gift-wraps carrying `['nostra-edit', '<originalAppMessageId>']` — the `chat-XXX-N` form, NOT rumor hex. Sender rows use it as `eventId`, receiver rows as `appMessageId`, so a single `getByAppMessageId` lookup works on both sides. Receive handler upserts the original row preserving `mid`/`twebPeerId`/`timestamp`; only `content` + `editedAt` change. Author verification mandatory: drop edits where `rumor.pubkey !== original.senderPubkey`.

### Message Receive Pipeline
- `initGlobalSubscription()` in `chat-api.ts` subscribes to kind 1059 on all relays at boot. Without it, only peers from `chatAPI.connect()` are heard.
- **Receive chain**: relay WS → `NostrRelay.handleEvent()` → gift-wrap decrypt → `RelayPool.handleIncomingMessage()` → `ChatAPI.handleRelayMessage()` → `NostraSync.onIncomingMessage()` → `message-store` → `nostra_new_message` → `history_append` → bubble.
- **Relay echo**: own sent messages come back via subscription. `handleRelayMessage` checks `msg.from === this.ownId` — same-device echoes skipped via `store.getByEventId()`, cross-device saved as `isOutgoing: true` (multi-device ready).
- `NostrRelay.handleDisconnect()` uses infinite backoff: `1s, 2s, 4s, …` then steady 10s. Only explicit `disconnect()` stops retries.

### Delivery Tracker & Receipts
- `DeliveryTracker.states` is keyed by app messageId (`chat-XXX-N`), NOT rumor hex. Receipts from `handleRelayMessage` must use `chatMessage.id` (parsed from content), not `msg.id` — else `handleReceipt` silently no-ops.
- `deliveryTracker` must be initialized in BOTH `ChatAPI.connect(peer)` AND `initGlobalSubscription()` — else reload-then-receive-receipt drops all receipts silently.
- `chatAPI.markRead(eventId, senderPubkey)` exists but no production code calls it — sender bubbles stay at ✓✓ (delivered) instead of blue (read). A `peer_changed` listener should iterate visible `is-in` bubbles and call it.
- `nostra_delivery_update` handled by `nostra-delivery-ui.ts`, maps `eventId → mid` via `NostraPeerMapper.mapEventId(eventId, timestamp)`.

### Logout & Data Cleanup
- Settings logout calls `showLogOutPopup()` from `@components/popups/logOut` — never inline `indexedDB.deleteDatabase + reload`. `nostra-cleanup.ts` is the centralized module.
- Cleanup MUST run in the main thread (Worker has no `localStorage`). `apiManager.logOut()` only handles `deleteEncryptedIdentity()`.
- `indexedDB.deleteDatabase()` blocks silently if any connection is open. Close singletons via `destroy()` first, then `forceCloseDB()` for orphan connections (`key-storage.ts`, `identity.ts` open DBs on-demand).
- `VirtualPeersDB` has TWO connections (`this._db` class-level + `_dbPromise` module-level singleton) — `destroy()` must close both.
- Nostra IndexedDB: `nostra-messages`, `nostra-message-requests`, `nostra-virtual-peers`, `nostra-groups`, `NostraPool`, `Nostra.chat`.
- Nostra localStorage: `nostra_identity`, `nostra-relay-config`, `nostra-last-seen-timestamp`, `nostra:read-receipts-enabled`.
- `.toasts-container` has `z-index: 5` — too low for popup transitions. Use a dedicated overlay with `z-index: 9999` for destructive-action feedback.
- **Reset Local Data** (sibling of logout): `showResetLocalDataPopup()` in `src/components/popups/resetLocalData.ts` wipes everything except the seed via `clearAllExceptSeed()` in `nostra-cleanup.ts` and calls `apiManager.logOut(undefined, {keepNostraIdentity: true})` so the Worker-side `deleteEncryptedIdentity()` is skipped. A `sessionStorage` marker (`nostra-just-reset`) triggers a confirmation toast on the next boot via `maybeShowResetToast()` called from `src/index.ts`.

### UI Components
- The active "Add Contact" dialog is in `src/components/sidebarLeft/tabs/contacts.ts` (imperative DOM), NOT `src/components/nostra/AddContact.tsx` (Solid.js — unused).
- `bubbles.ts` is 11000+ lines. `appMessagesManager.ts` is 8500+ lines. Changes to these files risk cascading side effects.
- All `notDirect` flags were removed from `contextMenu.ts` — all chats are Nostra, there are no Telegram DMs. The type field, invocation logic, and all 10 button properties were deleted.
- Hamburger profile entry (`buildNostraProfileMenuContent` in `sidebarLeft/index.ts`): the async storage-read path must generate a dicebear avatar from the stored npub *before* calling `fetchOwnKind0`, otherwise fresh-onboarding (no cache, no kind 0 picture) leaves `avatar.src=""` until the user opens the profile tab.

### Nostra Module Architecture
`nostra-onboarding-integration.ts` is a thin orchestrator (~240 lines) wiring: `nostra-message-handler.ts` (incoming message builder), `nostra-pending-flush.ts` (queue for closed-chat peers), `nostra-read-receipts.ts` (batch on peer open), `nostra-delivery-ui.ts` (bubble sent/delivered/read icons). `chat-api-receive.ts` extracts `handleRelayMessage` with `ReceiveContext` DI as pure step functions (`isDeleteNotification`, `parseMessageContent`, `extractFileMetadata`, `isDuplicate`). All Nostra rootScope events are typed in `BroadcastEvents` (rootScope.ts) — no `as any` casts.

### MTProto Intercept (`apiManager.ts`)
- `nostraIntercept()` tries dynamic server first (main thread only), then checks `NOSTRA_STATIC`, then `NOSTRA_BRIDGE_METHODS` (Worker→Main via MessagePort), then action prefixes, then fallback `{pFlags: {}}`.
- `NOSTRA_STATIC` must return properly shaped responses — `{pFlags: {}}` causes "Cannot read properties" errors in managers.
- `messages.getDialogFilters` must return `{filters: []}` not `[]` — `filtersStorage` calls `.filters` on the result.
- `stories.getAllStories` must include `peer_stories: []`, `stealth_mode: {}` — `appStoriesManager` iterates these.
- `users.getFullUser` must include `profile_photo: {_: 'photoEmpty'}` — `appProfileManager` accesses it.

### Bug Fuzzer (stateful property-based)

`pnpm fuzz` runs a long-running fuzzer that generates random action sequences across 2 Playwright contexts + LocalRelay and verifies tiered invariants (cheap + medium + regression) after every action. Findings are appended (deduplicated by signature) to `docs/FUZZ-FINDINGS.md`; minimal replay traces live in `docs/fuzz-reports/FIND-<sig>/trace.json`.

- `pnpm fuzz --duration=2h` — overnight run
- `pnpm fuzz --replay=FIND-<sig>` — deterministic replay of a finding
- `pnpm fuzz --replay-baseline` — 30s regression check (baseline `baseline-seed42-v2b2.json` pending live emit — see `docs/VERIFICATION_2B2B.md`)
- `pnpm fuzz --headed --slowmo=200` — watch the fuzzer in a real browser
- `pnpm fuzz` runs preserve `docs/FUZZ-FINDINGS.md` curation automatically (T1 of 2b.2b). No `git restore` workaround needed.
- Spec Phase 1: `docs/superpowers/specs/2026-04-17-bug-fuzzer-design.md`
- Spec Phase 2a: `docs/superpowers/specs/2026-04-18-bug-fuzzer-phase-2a-design.md`

**Fuzz operational notes:**
- Each fuzz iter ≈ 66s harness boot + 30-60s actions — minimum useful budget is 3min.
- Hook Worker-side managers (not main-thread wrappers like `chat.sendReaction`); fuzz actions and programmatic callers reach managers via `rs.managers.X` proxy and bypass UI entry points.
- Stop a hung fuzz: `pkill -9 -f "tsx.*fuzz"; pkill -9 -f chromium` (regular `pkill -f` may miss the inner tsx node child).
- New tests in `src/tests/fuzz/` are auto-discovered; new tests in `src/tests/nostra/` must be appended to the explicit file list in `package.json` `test:nostra:quick`.

**Adding a fuzz artifact** — `src/tests/fuzz/invariants/<tier>.ts` (one file per tier: `console.ts`, `bubbles.ts`, `delivery.ts`, `avatar.ts` = cheap; `state.ts`, `queue.ts` = medium; `regression.ts` = regression). Register in `invariants/index.ts`. Add a Vitest in the same directory. Same additive pattern for `postconditions/<category>.ts`.

**Phase 2a closed** three P2P blockers (`FIND-cfd24d69` dup-mid, `FIND-676d365a` delete, `FIND-1526f892` react sender-side). Receive-side reactions still deferred to Phase 2b. A committed regression baseline was shipped in 2a (seed=42, deleted during the 2b.1 merge) and is pending re-emit in 2b.2b after the cold-start flakes are resolved.

**Phase 2b.1 closed** the NIP-25 reactions RX bilateral path (publish+receive+remove+multi-emoji+aggregation), 5 open FINDs from Phase 2a overnight, and applied an architectural fix to enforce the message identity triple `{eventId, timestampSec, mid}` as immutable across all write paths (no recomputation downstream). New modules: `src/lib/nostra/nostra-reactions-{store,publish,receive}.ts`. Relay subscription extended to `{kinds: [1059, 7, 5], '#p': [ownPubkey]}`. **Baseline v2b1 emit deferred to 2b.2** — the new action registry surfaced 3 pre-existing bugs (bubble chronology, multi-emoji render aggregation, input-cleared postcondition) that block the `findings === 0` emit gate. All 3 logged as open in `docs/FUZZ-FINDINGS.md` for 2b.2 scope. Spec: `docs/superpowers/specs/2026-04-19-bug-fuzzer-phase-2b-design.md` §5 (including §5.7).

**Phase 2b.2a closed** the 3 carry-forward FINDs (`FIND-c0046153` bubble chronological ordering — surgical sort-key switch in `bubbleGroups.ts` for P2P peers; `FIND-bbf8efa8` multi-emoji aggregation — fixed a ChatAPI wiring race in `chat-api.ts` constructor + a cache-read race via new `getReactionsFresh` in `nostra-reactions-local.ts`; `FIND-eef9f130` input-cleared — patient postcondition polling). Added lifecycle fuzz coverage: `reloadPage` (pure + during-pending-send variants), `deleteWhileSending` race action, 4 new lifecycle invariants + 1 postcondition, and activated `INV-virtual-peer-id-stable` (scaffolded in `regression.ts`, activated by the mere existence of `reloadPage`).

**Baseline v2b1 emit deferred to 2b.2b** — two cold-start postcondition flakes surfaced during the 2b.2a smoke pass and block the `findings === 0` emit gate: `POST_deleteWhileSending_consistent` (boot-time relay-delivery race; partially mitigated via tempMid-null skip + 6s poll window but still flaky on seed=42 first-action) and `POST_react_peer_sees_emoji` (peer-side reception race on first reaction action after boot). Both are cold-start issues that need warmup guards (skip first N actions after harness boot) — not production bugs. Logged in `docs/FUZZ-FINDINGS.md` as carry-forward. Until baseline is emitted in 2b.2b, `--replay-baseline` has no file to load.

Carry-forward open FIND (`FIND-chrono-v2`) — `INV-bubble-chronological` flake on high-concurrency traces, same-second same-user tempMid race distinct from c0046153. Closed in 2b.2b via `mid` tiebreaker in `src/helpers/array/insertSomethingWithTiebreak.ts`.

**Phase 2b.2b closed** reporter clobber bug (curated Fixed sections preserved automatically via parse-merge), cold-start races (`FIND-cold-deleteWhileSending`, `FIND-cold-reactPeerSeesEmoji`) via multi-kind deterministic warmup in `bootHarness`, same-second tempMid race (`FIND-chrono-v2`) via `mid` tiebreaker, added UI-driven `reactViaUI` action + `INV-reactions-picker-nonempty` (would have caught PR #47 empty-stub bug), profile scope (editName/editBio/uploadAvatar/setNip05 + Blossom mock + 3 invariants + 3 postconditions). Baseline `baseline-seed42-v2b2.json` emit pending user live run — see `docs/VERIFICATION_2B2B.md`. Groups scope moves to **Phase 2b.3**.

### Bubble Rendering
- Kind 0 profile must be PUBLISHED during onboarding (not just saved locally) for other users to fetch it.
- P2P messages are populated in mirrors automatically via the bridge pipeline (Worker calls getHistory → saveMessages → mirror).
- Calling `appMessagesManager.getHistory({peerId, limit: 1})` from the main thread **pollutes the Worker's history cache** — it marks the slice as `SliceEnd.Both` fulfilled, causing subsequent larger-limit fetches to return the cached (incomplete) result without re-fetching. For P2P message injection, skip `getHistory` and inject directly into `apiManagerProxy.mirrors.messages[${peerId}_history][mid]` instead.
- `history_append` is a one-shot event that only fires when the chat is open with an active `bubbles.ts` listener. For messages arriving while the chat is closed, use a pending-messages queue and flush on `appImManager.addEventListener('peer_changed')` with retry delays (500ms, 1500ms, 3000ms) to wait for `loadedAll.bottom=true`.
- When auto-adding an unknown sender as a contact from `handleRelayMessage`, also inject the User object into `apiManagerProxy.mirrors.peers[peerId]` + call `reconcilePeer` + `appUsersManager.injectP2PUser` — otherwise the chat list title shows but preview text fails to render.
- For new dialogs from unknown senders, `dialogs_multiupdate` must be dispatched TWICE: first dispatch adds the dialog via `sortedList.add()` (returns early, skips `setLastMessageN`), second dispatch hits the "existing dialog" branch which renders the preview text. A single dispatch shows the peer title but no message preview.
