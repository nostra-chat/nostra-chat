# CLAUDE.md — Nostra.chat

## Table of Contents

- [Project Overview](#project-overview) · [Tech Stack](#tech-stack) · [Development](#development) · [Directory Structure](#directory-structure) · [Path Aliases](#path-aliases)
- [Code Style](#code-style-enforced-by-eslint) · [TypeScript Notes](#typescript-notes) · [Key Patterns](#key-patterns) · [Important Files](#important-files) · [What NOT to Do](#what-not-to-do)
- [Release & Deployment](#release--deployment) (full: [`docs/RELEASE.md`](docs/RELEASE.md))
- Architecture: [Tor WASM](#tor-wasm-runtime-webtor-rs) · [Worker Context](#worker-context) · [Peer Mirroring](#peer-mirroring) · [Virtual MTProto](#virtual-mtproto-architecture-messageport-bridge) · [VMT Middleware Rules](#virtual-mtproto-middleware-rules) · [Message Receive](#message-receive-pipeline) · [Delivery Receipts](#delivery-tracker--receipts)
- [Logout & Cleanup](#logout--data-cleanup) · [UI Components](#ui-components) · [Nostra Modules](#nostra-module-architecture) · [MTProto Intercept](#mtproto-intercept-apimanagerts) · [Own Profile Sync](#own-profile-sync-cache-first-swr) · [Profile Tab](#profile-tab-structure-editprofile) · [Blossom Upload](#blossom-avatar-upload)
- Testing: [P2P Code](#testing-p2p-code) · [E2E (Playwright)](#e2e-testing-playwright) · [Bubble Rendering](#bubble-rendering)

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
pnpm lint           # ESLint on src/**/*.ts
```

Debug query params: `?test=1` (test DCs), `?debug=1` (verbose logging), `?noSharedWorker=1` (disable shared worker).

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
- **Object/array spacing**: no spaces inside braces/brackets
  - `{a: 1}` not `{ a: 1 }`
  - `[1, 2]` not `[ 1, 2 ]`
- **Keyword spacing**: no space after `if`, `for`, `while`, `switch`, `catch`
  - `if(condition)` not `if (condition)`
  - `for(...)` not `for (...)`
- **Function paren**: no space before paren — `function foo()` not `function foo ()`
- **No `return await`**: use `return promise` directly
- **Max 2 consecutive blank lines**
- **`prefer-const`** with destructuring: `all`

## TypeScript Notes

- `strict: true` but `strictNullChecks: false` and `strictPropertyInitialization: false`
- `useDefineForClassFields: false` — important for class field behavior
- `jsxImportSource: solid-js` — JSX is Solid.js, not React
- MTProto types live in `src/layer.d.ts` (664KB, auto-generated); import from `@layer`
- Utility types (AuthState, WorkerTask, etc.) live in `src/types.d.ts`; import from `@types`

## Key Patterns

### Solid.js Components

Components are in `.tsx` files. Props typed inline. Use `classNames()` helper for class composition:

```typescript
import {JSX} from 'solid-js';
import classNames from '@helpers/string/classNames';

export default function MyComponent(props: {
  class?: string,
  children: JSX.Element
}) {
  return (
    <div class={classNames('my-class', props.class)}>
      {props.children}
    </div>
  );
}
```

### CSS Modules

Scoped styles use `.module.scss` files. Import as `styles`:

```typescript
import styles from '@components/chat/bubbles/service.module.scss';
// Usage: <div class={styles.wrap}>
```

### Solid.js Stores

Stores in `src/stores/` use `createRoot` + `createSignal` and export a hook:

```typescript
import {createRoot, createSignal} from 'solid-js';
import rootScope from '@lib/rootScope';

const [value, setValue] = createRoot(() => createSignal(initialValue));
rootScope.addEventListener('some_event', setValue);

export default function useValue() {
  return value;
}
```

### App Managers

Business logic lives in `AppManager` subclasses in `src/lib/appManagers/`. They communicate via `rootScope` events and are accessed via `rootScope.managers`:

```typescript
import {AppManager} from '@appManagers/manager';

export class AppSomethingManager extends AppManager {
  protected after() {
    // Initialization after state loaded
    this.apiUpdatesManager.addMultipleEventsListeners({...});
  }
}
```

### rootScope

Global event bus and context. Available everywhere:

```typescript
import rootScope from '@lib/rootScope';

rootScope.addEventListener('premium_toggle', handler);
rootScope.managers.appChatsManager.getChat(chatId);
```

### Imports from `@layer`

All MTProto types come from `@layer`:

```typescript
import {Message, Chat, User, InputPeer} from '@layer';
```

## CSS / SCSS

- Global styles in `src/scss/`
- Component-scoped styles in `.module.scss` next to component files
- BEM-like class naming convention
- CSS variables used for theming

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
| `docs/CHECKLIST_v2.md` | P2P feature status, bug reports, verification commands |
| `docs/RALPH_PROMPT_v2.md` | Automated bug fixing prompt for ralph-loop |

## What NOT to Do

- Do not add `eslint-disable` without a reason
- Do not use `return await` (rule enforced)
- Do not use spaces inside `{}` for objects or `[]` for arrays
- Do not use `if (` with a space — use `if(`
- Do not import from `react` or use React patterns — this is Solid.js
- Do not use relative `../../` imports when an alias exists
- Do not use `var` — use `const`/`let`
- Do not add trailing commas in arrays/objects
- **Ternary operators**: `?` and `:` go at END of line, not start of next: `condition ?\n  value1 :\n  value2` not `condition\n  ? value1\n  : value2`
- Do not save screenshots/images in the project root — use `/tmp/`. `.gitignore` blocks `*.png` at root.
- Do not assume a component is mounted just because the file exists — grep for imports (`MessageRequests.tsx` existed but was never mounted).
- Do not assume a `rootScope.dispatchEvent('foo')` is wired — grep for listeners before relying on it.
- Do not edit `package.json` version manually — use `pnpm version` or release-please.
- Do not open two Claude Code instances in the same working directory — use `git worktree add ../nostra.chat-wt/<name> -b <branch> main`, one Claude per worktree.
- Do not remove the `!public/recorder.min.js` exception in `.gitignore` — it's a third-party UMD imported statically from `src/components/chat/input.ts`.

## Running Tests

```bash
pnpm test                  # all tests
pnpm test src/tests/foo    # specific test file
```

Vitest config: `threads: false`, `globals: true`, jsdom environment, setup in `src/tests/setup.ts`.

## Release & Deployment

Full reference: [`docs/RELEASE.md`](docs/RELEASE.md). Day-to-day rules:

- Pipeline triggers **only on `v*` tags** (`.github/workflows/deploy.yml`). Push to `main` directly — no CI on main.
- Two release paths: merge the open `chore(main): release X.Y.Z` PR from release-please, OR run `pnpm version patch|minor|major` locally. Never edit `package.json` version or `CHANGELOG.md` by hand.
- Conventional Commits: `feat:`/`fix:`/`perf:`/`revert:` bump version; everything else is hidden from changelog.
- Do NOT enable auto-merge on the release-please PR (accumulates commits, merge manually when releasing).
- Do NOT re-add `push: branches: main` / `pull_request:` triggers to `deploy.yml`.

## Nostra.chat Architecture Notes

### Tor WASM runtime (webtor-rs)
- `ChatAPI` owns its OWN `NostrRelayPool` separate from `NostraBridge._relayPool`. Privacy/startup gates must touch BOTH — `chatAPI.initGlobalSubscription()` bypasses the bridge pool.
- `PrivacyTransport.waitUntilSettled()` is the authoritative gate (resolves on `active`/`direct`/`failed`). Defer ALL network-touching init behind it when Tor is enabled — no WebSocket must leak the user's IP during the 30-40s bootstrap window.
- Tor consensus files: `public/webtor/consensus.br.bin` + `microdescriptors.br.bin`. Refresh with `pnpm run update-tor-consensus` (runs in prebuild hook). **Do NOT rename to `.br`** — Vite auto-sets `Content-Encoding: br` for `.br` files, the browser pre-decompresses before the WASM fetch shim sees the bytes, and consensus load fails with `Invalid Data`.
- `webtor-fallback.ts` rewrites stale `privacy-ethereum.github.io/webtor-rs/*` URLs to local `/webtor/*.br.bin` and caches them in `CacheStorage` (2h TTL via `tor-consensus-cache.ts`). Staleness symptom: `Failed to extend to middle: Circuit-extension handshake authentication failed`.
- **Never timeout `WebtorClient.fetch()` with `Promise.race`** — arti serializes concurrent callers inside WASM and abandoned promises don't free the stream, wedging the client. Bootstrap retries only via fresh `WebtorClient` (not `abort()`); `PrivacyTransport.bootstrap()` already retries 4× with new clients.
- Tor HTTP polling (`NostrRelay.startHttpPolling`) chains via `setTimeout` in a `finally` block, never `setInterval` — a 3s interval with 45s per-fetch timeouts saturates the WASM tunnel.
- Debug handles: `window.__nostraTransport`, `__nostraPool`, `__nostraPrivacyTransport`. Access private `webtorClient` via `(t as any).webtorClient`.

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
- E2E: `npx tsx src/tests/e2e/e2e-logout.ts`.

### UI Components
- The active "Add Contact" dialog is in `src/components/sidebarLeft/tabs/contacts.ts` (imperative DOM), NOT `src/components/nostra/AddContact.tsx` (Solid.js — unused).
- `bubbles.ts` is 11000+ lines. `appMessagesManager.ts` is 8500+ lines. Changes to these files risk cascading side effects.
- All `notDirect` flags were removed from `contextMenu.ts` — all chats are Nostra, there are no Telegram DMs. The type field, invocation logic, and all 10 button properties were deleted.

### Nostra Module Architecture
`nostra-onboarding-integration.ts` is a thin orchestrator (~240 lines) wiring: `nostra-message-handler.ts` (incoming message builder), `nostra-pending-flush.ts` (queue for closed-chat peers), `nostra-read-receipts.ts` (batch on peer open), `nostra-delivery-ui.ts` (bubble sent/delivered/read icons). `chat-api-receive.ts` extracts `handleRelayMessage` with `ReceiveContext` DI as pure step functions (`isDeleteNotification`, `parseMessageContent`, `extractFileMetadata`, `isDuplicate`). All Nostra rootScope events are typed in `BroadcastEvents` (rootScope.ts) — no `as any` casts.

### MTProto Intercept (`apiManager.ts`)
- `nostraIntercept()` tries dynamic server first (main thread only), then checks `NOSTRA_STATIC`, then `NOSTRA_BRIDGE_METHODS` (Worker→Main via MessagePort), then action prefixes, then fallback `{pFlags: {}}`.
- `NOSTRA_STATIC` must return properly shaped responses — `{pFlags: {}}` causes "Cannot read properties" errors in managers.
- `messages.getDialogFilters` must return `{filters: []}` not `[]` — `filtersStorage` calls `.filters` on the result.
- `stories.getAllStories` must include `peer_stories: []`, `stealth_mode: {}` — `appStoriesManager` iterates these.
- `users.getFullUser` must include `profile_photo: {_: 'photoEmpty'}` — `appProfileManager` accesses it.

### Testing P2P Code

**Commands:**
- TS check: `npx tsc --noEmit 2>&1 | grep "error TS"` (Vite checker may show stale cached errors). Expect ~30 pre-existing errors from `@vendor/emoji`, `@vendor/bezierEasing`.
- Unit tests: `npx vitest run src/tests/nostra/` — peer mapper, VMT server, sync, relay pool, crypto.
- `pnpm test:nostra:quick` lists files explicitly — add new tests there or they won't run in the fast path. It exits code 1 due to 2 pre-existing unhandled rejections in `tor-ui.test.ts`; verify the `Tests N passed (N)` line, not the exit code.

**Vitest quirks** (`isolate: false` + `threads: false` — shared module registry across files):
- `vi.mock()` factories persist across files. Use `mockImplementation()` in `beforeEach`, not shared state.
- Always pair `vi.mock('@lib/rootScope')` with `afterAll(() => { vi.unmock('@lib/rootScope'); vi.restoreAllMocks(); })` — else later tests get the mock instead of real rootScope and cascade-fail.
- `fake-indexeddb/auto`: use unique IDs per test (e.g. `uniqueConvId()`) — IndexedDB state persists across files.
- Don't mock `MOUNT_CLASS_TO` via `vi.mock('@config/debug')` — it's a mutable singleton. Set `MOUNT_CLASS_TO.apiManagerProxy = {...}` directly in `beforeEach`.

**Worktrees:**
- Need `pnpm install` + both `.env.local` AND `.env.local.example` copied from main repo (Vite fails with ENOENT otherwise).
- Parallel dev servers: `pnpm exec vite --force --port <8090-8099> --strictPort`.

**Runtime access:**
- Use `rs.managers.appMessagesManager.*` (imported from `@lib/rootScope`). `apiManagerProxy.managers` is the IPC proxy class, NOT the namespace. `rs.managers` is undefined during early boot — wait for `window.__nostraChatAPI` first.
- Injecting synthetic P2P peers needs `storeMapping(pubkey, peerId, displayName)` from `virtual-peers-db.ts`. Without persistence, VMT's `getPubkey(peerId)` returns null and bridge calls silently return `emptyUpdates`.
- Playwright console filter must exclude `MTPROTO`, `relay_state`, `nostra_relay_state` noise. Include only: `[ChatAPI]`, `[NostrRelay]`, `[NostraSync]`, `[NostraOnboarding`, `[VirtualMTProto`.

### E2E Testing (Playwright)

**Running tests:**
- `pnpm test:e2e:all` (bail on first failure) / `:all:no-bail` / `pnpm test:e2e <file>` / `pnpm test:e2e:debug <file>`.
- Launch via `launchOptions` from `helpers/launch-options.ts`. Env: `E2E_HEADED=1`, `E2E_SLOWMO=N`, `E2E_DEVTOOLS=1`. Never hardcode `headless: true`.
- New tests must be added to `TESTS` array in `src/tests/e2e/run-all.sh` or they're skipped silently.
- `// @ts-nocheck` at top of E2E files (playwright types not in tsconfig).
- `APP_URL`/`E2E_APP_URL` env var for worktree runs on alternate ports (`e2e-p2p-edit.ts` / `e2e-bug-regression.ts` reference pattern).

**Page boot:**
- **Vite HMR fails on first headless load** (`ERR_NETWORK_CHANGED`). Pattern: `goto({waitUntil: 'load'})` → `waitForTimeout(5000)` → `reload({waitUntil: 'load'})` → `waitForTimeout(15000)`.
- Wait on selectors, not fixed timeouts: onboarding `button:has-text("Create New Identity")` (30s); post-onboarding `.sidebar-header .btn-menu-toggle`. Fresh worktrees compile slower.
- "Get Started" onboarding button may hang on relay publish — click `SKIP` link as fallback.
- Dismiss overlays via shared helper: `import {dismissOverlays} from './helpers/dismiss-overlays'`. `BLOCKING_SELECTORS` is the single source of truth — add new blocking overlays there. Tests that need an overlay present (e.g. `e2e-tor-privacy-flow.ts` querying `.tor-startup-banner`) must NOT call it.

**Clicking in Solid.js (critical):**
Solid uses event delegation, so **synthetic clicks do not fire delegated handlers**. This covers `element.dispatchEvent(new MouseEvent('click'))`, `HTMLElement.click()` inside `page.evaluate()`, and raw `page.mouse.down/up` at computed coordinates. Always either (a) use Playwright's `locator.click()`, or (b) compute `getBoundingClientRect()` in `page.evaluate()` and then `await page.mouse.click(x, y)` from the test side. Also: never wrap popup containers with `onClick={e => e.stopPropagation()}` — it breaks delegation for all descendants; handle dismiss-on-outside-click elsewhere.

**Input handling:**
- `msgArea.pressSequentially(text)` does NOT clear input. Between sends: `Control+A` → `Backspace` → `type(text)`. **Never use `Delete`** after `Control+A` — it eats the first char of the next `type()` call.
- **Markdown italic trap:** underscores in test strings (e.g. `Bug3_reply_`) get parsed as `<i>`. Use dashes: `Bug1-first-msg-${Date.now()}`.

**Assertions & selectors:**
- NEVER `document.body.textContent.includes()` — matches chat list preview. Use `.bubble .message, .bubble .inner, .bubble-content`.
- **Bubble text extraction:** `.message` contains `.time`, `.time-inner`, `.reactions`, `.bubble-pin`. Clone + `querySelectorAll('.time, .time-inner, .reactions, .bubble-pin').forEach(e => e.remove())` before reading text.
- Count unique bubbles via `.bubble[data-mid]` + `Set<mid>`. Filter `.message` selectors with `.closest('.reply, .quote') == null` to skip quoted text.
- Open chats via `appImManager.setPeer({peerId})` — headless click on `.chatlist-chat a` is unreliable.
- `peer_changing`/`peer_changed` dispatch on `appImManager`, not `rootScope` (`MOUNT_CLASS_TO.appImManager.addEventListener`).
- To trigger edit mode: call `appImManager.chat.input.initMessageEditing(mid)` directly, then fill input and click `button.btn-send`.

**Local relay & network:**
- `LocalRelay` (`src/tests/e2e/helpers/local-relay.ts`) manages a strfry Docker container on `ws://localhost:7777`. `relay.injectInto(ctx)` overrides `DEFAULT_RELAYS` via `window.__nostraTestRelays` (set before page load via `addInitScript`). Uses `--user $(id -u):$(id -g)` + `--tmpfs /app/strfry-db` (RAM-backed, no stale data, no root cleanup).
- Public relay propagation needs **30s** timeout. damus.io + nos.lol reliable; snort.social + nostr.band frequently down.
- Bidirectional tests need two separate `browser.newContext()` for isolated storage.
- When filtering WebSocket traffic (`page.on('websocket')`), exclude `ws://localhost:*` — Vite HMR pollutes assertions.
- `MutationObserver` for transient DOM (toasts, overlays) must be registered BEFORE the triggering action.
- ALWAYS run `e2e-bidirectional.ts` after pipeline changes — sender-only tests don't verify receive.
- Canonical regression suite: `e2e-bug-regression.ts` (4 P2P bugs).

**Manual alternative:** When Playwright LocalRelay harness is flaky, use chrome-devtools MCP with `new_page({url, isolatedContext: "userA"})` + `new_page({url, isolatedContext: "userB"})` — isolated contexts give fully separate storage, faster and more deterministic for one-off verification.

### Bubble Rendering
- Kind 0 profile must be PUBLISHED during onboarding (not just saved locally) for other users to fetch it.
- P2P messages are populated in mirrors automatically via the bridge pipeline (Worker calls getHistory → saveMessages → mirror).
- Calling `appMessagesManager.getHistory({peerId, limit: 1})` from the main thread **pollutes the Worker's history cache** — it marks the slice as `SliceEnd.Both` fulfilled, causing subsequent larger-limit fetches to return the cached (incomplete) result without re-fetching. For P2P message injection, skip `getHistory` and inject directly into `apiManagerProxy.mirrors.messages[${peerId}_history][mid]` instead.
- `history_append` is a one-shot event that only fires when the chat is open with an active `bubbles.ts` listener. For messages arriving while the chat is closed, use a pending-messages queue and flush on `appImManager.addEventListener('peer_changed')` with retry delays (500ms, 1500ms, 3000ms) to wait for `loadedAll.bottom=true`.
- When auto-adding an unknown sender as a contact from `handleRelayMessage`, also inject the User object into `apiManagerProxy.mirrors.peers[peerId]` + call `reconcilePeer` + `appUsersManager.injectP2PUser` — otherwise the chat list title shows but preview text fails to render.
- For new dialogs from unknown senders, `dialogs_multiupdate` must be dispatched TWICE: first dispatch adds the dialog via `sortedList.add()` (returns early, skips `setLastMessageN`), second dispatch hits the "existing dialog" branch which renders the preview text. A single dispatch shows the peer title but no message preview.

### Own Profile Sync (cache-first SWR)
- Source of truth: relay. Cache: `localStorage.nostra-profile-cache` (`{profile, created_at}`).
- `src/lib/nostra/own-profile-sync.ts` exposes `hydrateOwnProfileFromCache()` (sync read + dispatch `nostra_identity_updated`), `refreshOwnProfileFromRelays(pubkey)` (background fetch, newest `created_at` wins), `saveOwnProfileLocal(profile, created_at)` (optimistic update before publish).
- Boot: `nostra-onboarding-integration.ts` hydrates then refreshes in background. Save: `editProfile` calls `saveOwnProfileLocal` before `publishKind0Metadata`.
- `useNostraIdentity()` exposes `about`, `website`, `lud16`, `banner` alongside `npub`, `displayName`, `nip05`, `picture` — driven by `nostra_identity_loaded`/`_updated` in `src/stores/nostraIdentity.ts`.
- Conflict resolution: `fetchOwnKind0(pubkey)` queries all relays in parallel, returns highest `created_at`; cache updates only when relay is newer.
- **Do NOT add plain localStorage stopgaps** for new profile fields — they must flow through `saveOwnProfileLocal` → kind 0 publish to survive multi-device.
- Legacy `nostra-profile-extras` key auto-migrates and deletes on first read.

### Profile Tab Structure (`editProfile/`)
- `src/components/sidebarLeft/tabs/editProfile/` is a directory; consumers still `import from '@components/sidebarLeft/tabs/editProfile'` (resolves to `index.ts`).
- Files: `index.ts` (orchestrator — boot, save, focus, pubkey row) / `basic-info-section.ts` (Name/Bio/Website/Lightning via `createBasicInfoSection`) / `nip05-section.ts` (alias + setup + verify).
- Add a new input: extend `BasicInfoSection` (or new section file), wire via `setInitialValues`/`getValues`, extend `publishKind0Metadata` in `index.ts` `save()`.

### Blossom Avatar Upload
- `src/lib/nostra/blossom-upload.ts` → `uploadToBlossom(blob, privkeyHex)`. Signs NIP-24242 (kind 24242), PUTs to fallback chain: `blossom.primal.net` → `cdn.satellite.earth` → `blossom.band`.
- Avatar `Blob` exposed via `EditPeer.lastAvatarBlob` (widened `AvatarEdit.onChange`). `EditPeer.uploadAvatar()` is MTProto-only, NOT used here.
- SHA-256 via Web Crypto (`crypto.subtle.digest`), no `@noble/hashes` / `blossom-client-sdk` deps.

### Ralph Loop Integration
- `docs/RALPH_PROMPT_v2.md` — master prompt for automated bug fixing. `docs/CHECKLIST_v2.md` — single source of truth for P2P feature status, bugs, verification commands. Completion uses `<promise>TAG</promise>` exact match.