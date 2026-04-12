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
| Testing | Vitest |
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
- Do not save screenshots or images in the project root — use `/tmp/` for temporary test artifacts. The `.gitignore` blocks `*.png` at root level
- Do not assume a component exists in the UI just because the file exists. Grep for the import: `grep -rn 'import.*MessageRequests' src/` — `MessageRequests.tsx` is written but never mounted, so routing messages there made them invisible.
- Do not assume a `rootScope.dispatchEvent('foo')` call is wired to a listener. Grep for the listener: `grep -rn "addEventListener('foo'" src/` — `nostra_delivery_update` had dispatches but no production listeners.
- Do not run `eslint --fix` on `src/**/**.ts` broadly — 13 pre-existing lint errors live in `nostraMeshSettings.ts`, `mesh-manager.ts`, `mesh-signaling.ts`, `relay-store.ts`. Lint only the files you modified, or `git checkout --` the unrelated fixes before committing.
- Do not edit `package.json` version manually — use `pnpm version patch|minor|major` (runs the `preversion` gate locally: lint + tsc) or let release-please manage it via its release PR. Either path, never by hand.
- Do not open two Claude Code instances in the same working directory — `git worktree add ../nostra.chat-wt/<name> -b <branch> main && cd ../nostra.chat-wt/<name> && pnpm install` isolates them. One Claude per worktree.
- Do not remove the `!public/recorder.min.js` exception in `.gitignore` — the file is a third-party UMD bundle imported statically from `src/components/chat/input.ts` and the build fails without it.

## Running Tests

```bash
pnpm test                  # all tests
pnpm test src/tests/foo    # specific test file
```

Vitest config: `threads: false`, `globals: true`, jsdom environment, setup in `src/tests/setup.ts`.

## Release & Deployment

- **Pipeline**: `.github/workflows/deploy.yml` triggers ONLY on `push: tags: v*`. Daily commits to `main` do NOT run CI or deploy — the branch is unprotected, push directly. Tag push fires `pnpm lint` → `npx tsc --noEmit` → `pnpm build` as a server-side gate, then the 4 mirrors.
- **Live mirrors**: `https://nostra.chat` (Cloudflare, primary) · `https://nostra-chat.pages.dev` (Cloudflare fallback) · `https://nostra-chat.github.io/nostra-chat/` (GitHub Pages) · IPFS CID per release (Filebase).
- **Two release paths**: (a) merge the open `chore(main): release X.Y.Z` PR that `release-please` maintains — creates the tag and triggers deploy with full CHANGELOG; (b) `pnpm version patch|minor|major` locally — the `preversion` script runs lint + tsc first (local gate), then bumps `package.json`, tags, and `postversion` auto-pushes commit + tag. Never edit `package.json` version or `CHANGELOG.md` manually — one of these two paths always owns them.
- **Conventional Commits drive release triggers**: `feat:` / `fix:` / `perf:` / `revert:` bump the version; `docs:` / `chore:` / `style:` / `build:` / `ci:` / `refactor:` / `test:` are hidden from the changelog and non-releasing. Breaking change: `feat!:` or `BREAKING CHANGE:` footer.
- **Release-please PRs still don't trigger CI** (`GITHUB_TOKEN` anti-recursion). Under tag-triggered deploy this is harmless — there's no `build` required check to wait for on the PR itself, so you can merge it immediately.
- **Do NOT re-add `push: branches: main` or `pull_request:` to `deploy.yml`** — the pipeline is intentionally tag-triggered. Every production update must flow through a version tag.
- **Do NOT enable auto-merge on the release-please release PR** — it accumulates commits and you merge it manually when you want to release. Auto-merge on it = release-per-commit, which defeats the point.
- **Required CI secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET`. Do NOT re-add Pinata: `ipshipyard/ipfs-deploy-action@v1` rejects it as sole provider and requires a CAR upload provider (Filebase works).
- **`deploy-ipfs` job permissions**: needs explicit `permissions: contents: read, statuses: write` — without `statuses: write` the IPFS upload succeeds but the job fails when posting the CID as a commit status.
- **Repo settings**: "Allow GitHub Actions to create and approve pull requests" MUST stay enabled (Settings → Actions → General → Workflow permissions) or release-please can't open its release PR. "Allow auto-merge" is also on, usable on feature PRs via `gh pr merge N --auto --squash --delete-branch`, never on the release-please PR.

## Nostra.chat Architecture Notes

### Worker Context
- tweb runs managers in a DedicatedWorker even with `noSharedWorker=true`. Code in `src/lib/appManagers/` and `src/lib/storages/` runs in Worker context where `window` is undefined.
- Never import modules that use `window` directly into Worker-context code. Use `typeof window !== 'undefined'` guards or keep window-dependent code in main-thread-only files (`src/components/`, `src/pages/`).
- `getSelf()` returns `undefined` in Nostra.chat mode (no MTProto auth). Guard all `.id` access on its result.
- `rootScope.myId` is `NULL_PEER_ID` (0) in Nostra.chat mode — `isOurMessage()` uses `pFlags.out` as fallback.
- `rootScope` events dispatched in Worker don't reach main thread directly (separate instances). Use `message_sent`, `messages_pending` which are mirrored via MessagePort.

### Peer Mirroring
- Storing a user in Worker's `appUsersManager.users[]` is NOT enough — call `this.mirrorUser(user)` to sync to main thread's `apiManagerProxy.mirrors.peers` and Solid.js `peers` store.
- Without mirroring, `apiManagerProxy.getPeer()`, `usePeer()`, and all main-thread peer lookups return `undefined`.

### Virtual MTProto Architecture (MessagePort Bridge)
- Worker calls `nostraIntercept()` in `apiManager.ts` which routes methods two ways:
  - **Static** (`NOSTRA_STATIC`): methods that don't need real data (help.getConfig, updates.getState, account.*, stories.*)
  - **Bridge** (`NOSTRA_BRIDGE_METHODS`): methods routed via `port.invoke('nostraBridge', {method, params})` to main thread
- Main thread's `apiManagerProxy` receives bridge calls, forwards to `NostraMTProtoServer.handleMethod()`.
- Server reads from `message-store.ts` (IndexedDB) and returns native MTProto response shapes.
- Worker processes bridge responses normally via `saveMessages()` → `setMessageToStorage()` → mirror pipeline → UI.
- Bridge methods: getHistory, getDialogs, search, deleteMessages, sendMessage, sendMedia, getContacts, getUsers, getFullUser.
- `NostraSync` receives ChatAPI messages, persists to message-store, dispatches `nostra_new_message` rootScope event.
- Server registered on `apiManagerProxy.setNostraMTProtoServer()`, also on `window.__nostraMTProtoServer` for debugging.
- Design principle: tweb vanilla code should work unchanged — the bridge is transparent to the Worker.

### Virtual MTProto Middleware Rules
- ALL `createTwebUser()` calls in `virtual-mtproto-server.ts` MUST pass `firstName: mapping?.displayName` via `getMapping()` — omitting it causes hex fallback names that overwrite correct names after reload.
- `NOSTRA_ACTION_PREFIXES` in `apiManager.ts` must NOT contain `.get` or `.check` — these are query methods that need proper response shapes, not `return true`.
- P2P send shortcut in `appMessagesManager.ts` must dispatch `message_sent` (not just `messages_pending`) and call `setMessageToStorage()` — needed for bubble ⏳→✓ transition and context menu.
- `window.__nostraOwnPubkey` must be set in `nostra-onboarding-integration.ts` — `contacts.ts` needs it to persist conversations in message-store.
- `saveApiUser()` in `appUsersManager.ts` preserves P2P synthetic user's `first_name` to prevent bridge responses from overwriting nicknames with hex fallbacks.
- `invalidateHistoryCache(peerId)` on `appMessagesManager` resets `SlicedArray` for a peer — call from main thread via `rootScope.managers.appMessagesManager.invalidateHistoryCache(peerId)` after `nostra_new_message` arrives. Without this, reopened chats return stale cached history.
- `nostra_new_message` handler must build tweb messages directly from event data via `mapper.createTwebMessage()` — never re-read from message-store via `server.handleMethod('messages.getHistory')`. The IndexedDB round-trip has 0-5s variable latency and can return empty (silent message drop).
- Synthetic dialogs dispatched via `dialogs_multiupdate` must have `(dialog as any).topMessage = msg` (the message object, not just `top_message` ID). Without this, `setLastMessage` → `getLastMessageForDialog` falls back to `getMessageByPeer` which fails when `hasReachedTheEnd` is false on the dialog list.
- `NostraSync.onIncomingMessage()` MUST save with `eventId = msg.relayEventId || msg.id` — NOT `msg.id` alone. The ChatMessage's `msg.id` is the parsed `chat-XXX-N` from content, while `chat-api-receive` stores with rumor hex. Mismatched eventIds create duplicate rows in message-store → two bubbles per incoming message.
- `ChatAPI.connect(peerPubkey)` MUST be a lightweight `activePeer` switch when a global subscription is already active. Do NOT call `disconnect()` — it tears down the relay pool and kills the subscription that the sender's self-echo depends on for bubble rendering.
- Pinned-message filter (`inputMessagesFilterPinned`) must be intercepted in BOTH `searchMessages` AND `getHistory` in `virtual-mtproto-server.ts`. Return empty `{messages: [], users: [], chats: [], count: 0}`. tweb's `ChatPinnedMessage` uses `getHistory` with `inputFilter`, which `requestHistory` routes to `messages.search` OR `messages.getHistory` depending on context.
- Virtual MTProto Server's `sendMessage` must return `nostraMid` and `nostraEventId` in the response object so the Worker's P2P shortcut in `appMessagesManager.ts` can rename the temp mid (`0.0001`) to the real timestamp-based mid. Without this, outgoing bubbles sort incorrectly among received messages.
- P2P outgoing bubble rendering: `beforeMessageSending` in `appMessagesManager.ts` MUST skip its `history_append` dispatch for P2P peers (`Number(peerId) >= 1e15`). The main-thread VMT Server's `injectOutgoingBubble` is the sole render path — dispatching from both causes duplicate DOM elements.
- Main-thread code in `virtual-mtproto-server.ts` that dispatches rootScope events MUST use `rs.dispatchEventSingle(...)` not `rs.dispatchEvent(...)`. The latter forwards via `MTProtoMessagePort.invokeVoid('event', ...)` which throws unhandled rejections in vitest environments.

### Message Receive Pipeline
- At boot, `initGlobalSubscription()` in `chat-api.ts` subscribes to gift-wrap events (kind 1059) on all relays. Without this, only peers connected via `chatAPI.connect()` are heard.
- Relay echo handling: own sent messages come back via relay subscription. `handleRelayMessage` checks `msg.from === this.ownId` early. Same-device echoes are skipped via `store.getByEventId()`. Cross-device echoes are saved as `isOutgoing: true` and fire `onMessage` for real-time bubble rendering. This is multi-device ready.
- Full receive chain: relay WebSocket → `NostrRelay.handleEvent()` → gift-wrap decrypt → `RelayPool.handleIncomingMessage()` → `ChatAPI.handleRelayMessage()` → `NostraSync.onIncomingMessage()` → `message-store` → `nostra_new_message` event → `history_append` → bubble render.
- `NostrRelay.handleDisconnect()` uses infinite backoff: fast burst (1s, 2s, 4s) then steady 10s retries. Only explicit `disconnect()` stops retries. A relay glitch should never permanently kill the subscription.

### Delivery Tracker & Receipts
- `DeliveryTracker.states` Map is keyed by the app messageId (`chat-XXX-N`), NOT the Nostr rumor ID. When sending a delivery/read receipt from `handleRelayMessage`, use `chatMessage.id` (parsed from content) not `msg.id` (the rumor ID) — otherwise the sender's tracker can't find the entry and `handleReceipt` silently no-ops.
- `deliveryTracker` must be initialized in BOTH `ChatAPI.connect(peer)` AND `initGlobalSubscription()`. Without the second init, reload-then-receive-receipt drops all receipts silently.
- `chatAPI.markRead(eventId, senderPubkey)` exists but no production code calls it — the receiver never publishes read receipts, so the sender's bubble stays at "delivered" (✓✓) instead of blue "read". A listener on `peer_changed` should iterate visible `is-in` bubbles and call `markRead` per message.
- `nostra_delivery_update` events are handled by `nostra-delivery-ui.ts` (extracted module). It maps `eventId → mid` via `NostraPeerMapper.mapEventId(eventId, timestamp)` and updates the bubble's class + icon.

### Logout & Data Cleanup
- Settings logout button in `settings.ts` calls `showLogOutPopup()` from `@components/popups/logOut` — never inline `indexedDB.deleteDatabase + reload`.
- `nostra-cleanup.ts` is the centralized cleanup module. It closes singleton DB connections, force-closes orphan connections (version upgrade trick), deletes all 6 Nostra IndexedDB databases, and clears 4 localStorage keys.
- Nostra DB cleanup MUST run in the main thread — the Worker has no `localStorage` and can't close main-thread DB connections. `apiManager.logOut()` (Worker) only handles `deleteEncryptedIdentity()`.
- `indexedDB.deleteDatabase()` blocks silently if any connection is open. Always close connections first via `destroy()` on singletons, then `forceCloseDB()` for orphan connections (`key-storage.ts`, `identity.ts` open DBs on-demand without closing).
- `VirtualPeersDB` has TWO DB connections: `this._db` (class-level, from constructor) and `_dbPromise` (module-level singleton). `destroy()` must close both.
- Nostra IndexedDB databases: `nostra-messages`, `nostra-message-requests`, `nostra-virtual-peers`, `nostra-groups`, `NostraPool`, `Nostra.chat`.
- Nostra localStorage keys: `nostra_identity`, `nostra-relay-config`, `nostra-last-seen-timestamp`, `nostra:read-receipts-enabled`.
- `.toasts-container` has `z-index: 5` — too low for feedback during popup transitions. Use a dedicated overlay with `z-index: 9999` for critical full-screen feedback (logout, destructive actions).
- E2E logout test: `npx tsx src/tests/e2e/e2e-logout.ts` — verifies popup → overlay → reload → onboarding → DB cleanup.

### UI Components
- The active "Add Contact" dialog is in `src/components/sidebarLeft/tabs/contacts.ts` (imperative DOM), NOT `src/components/nostra/AddContact.tsx` (Solid.js — unused).
- `bubbles.ts` is 11000+ lines. `appMessagesManager.ts` is 8500+ lines. Changes to these files risk cascading side effects.
- All `notDirect` flags were removed from `contextMenu.ts` — all chats are Nostra, there are no Telegram DMs. The type field, invocation logic, and all 10 button properties were deleted.

### Nostra Module Architecture
- `nostra-onboarding-integration.ts` is a thin orchestrator (~240 lines) that imports and wires these extracted modules:
  - `nostra-message-handler.ts` — incoming message builder (buildTwebMessage, injectIntoMirrors, dispatchDialogUpdate, handleIncomingMessage)
  - `nostra-pending-flush.ts` — pending message queue for peers whose chat isn't open (createPendingFlush → enqueue/flush/attachListener)
  - `nostra-read-receipts.ts` — batch read receipts on peer open (createReadReceiptSender → sendForPeer)
  - `nostra-delivery-ui.ts` — sent/delivered/read bubble UI updates (createDeliveryUI → attach)
- `chat-api-receive.ts` — extracted handleRelayMessage logic with ReceiveContext DI. Pure step functions: isDeleteNotification, parseMessageContent, extractFileMetadata, isDuplicate.
- All Nostra rootScope events are typed in BroadcastEvents (rootScope.ts) — no `as any` casts needed. Events: nostra_new_message, nostra_delivery_update, nostra_profile_update, nostra_presence_update, nostra_backfill_complete, nostra_conversation_deleted, nostra_message_request, nostra_recovery_requested, nostra_read_receipts_toggle, nostra_relay_state, nostra_relay_list_changed, nostra_tor_state, nostra_message_queued, nostra_identity_loaded/locked/unlocked/updated, nostra_contact_accepted.

### MTProto Intercept (`apiManager.ts`)
- `nostraIntercept()` tries dynamic server first (main thread only), then checks `NOSTRA_STATIC`, then `NOSTRA_BRIDGE_METHODS` (Worker→Main via MessagePort), then action prefixes, then fallback `{pFlags: {}}`.
- `NOSTRA_STATIC` must return properly shaped responses — `{pFlags: {}}` causes "Cannot read properties" errors in managers.
- `messages.getDialogFilters` must return `{filters: []}` not `[]` — `filtersStorage` calls `.filters` on the result.
- `stories.getAllStories` must include `peer_stories: []`, `stealth_mode: {}` — `appStoriesManager` iterates these.
- `users.getFullUser` must include `profile_photo: {_: 'photoEmpty'}` — `appProfileManager` accesses it.

### Testing P2P Code
- Always check TS errors with `npx tsc --noEmit 2>&1 | grep "error TS"` — Vite checker may show stale cached errors.
- P2P unit tests: `npx vitest run src/tests/nostra/` — covers peer mapper, virtual MTProto server, sync, relay pool, crypto.
- Worktrees need `pnpm install` before running tests. Expect ~30 pre-existing TS errors from `@vendor/emoji`, `@vendor/bezierEasing` (missing vendor builds).
- When extracting files from a worktree/branch to main, use `git show <commit>:<path> > <path>` — never `cp` from a worktree directory, which may contain unresolved merge conflict markers from aborted merges.
- Worktrees also need `.env.local.example` copied from main repo — Vite config copies it to `.env.local` on start and fails with ENOENT if missing.
- Vitest runs with `isolate: false` + `threads: false` — all test files share one module registry. `vi.mock()` factories persist across files. Use `mockImplementation()` in `beforeEach` instead of relying on shared mock state. Tests may pass individually but fail in batch due to mock contamination.
- When `vi.mock('@lib/rootScope')` is used in a test file, add `afterAll(() => { vi.unmock('@lib/rootScope'); vi.restoreAllMocks(); })` — without this, later test files in the shared registry get the mock instead of the real rootScope, causing cascading failures (e.g. `MTProtoMessagePort.getInstance().invokeVoid` undefined).
- For `fake-indexeddb/auto` tests: use unique IDs per test (e.g. `uniqueConvId()`) instead of shared constants — with `isolate: false`, IndexedDB state persists across test files and stale data causes count mismatches.
- Don't mock `MOUNT_CLASS_TO` via `vi.mock('@config/debug')` — it's a mutable singleton. Set `MOUNT_CLASS_TO.apiManagerProxy = {...}` directly in `beforeEach` instead.
- Playwright console capture filter must exclude `MTPROTO`, `relay_state`, `nostra_relay_state` noise — Worker floods these on every relay state change. Include only explicit prefixes: `[ChatAPI]`, `[NostrRelay]`, `[NostraSync]`, `[NostraOnboarding`, `[VirtualMTProto`.

### E2E Testing (Playwright)
- **Launch options:** All E2E tests use `launchOptions` from `helpers/launch-options.ts`. Env vars: `E2E_HEADED=1` (visible browser), `E2E_SLOWMO=N` (slow motion ms), `E2E_DEVTOOLS=1` (open DevTools, implies headed). Never hardcode `headless: true` in test files.
- **Vite HMR fails on first headless load** with `ERR_NETWORK_CHANGED`. Workaround: `page.goto(APP_URL, {waitUntil: 'load'})` → `waitForTimeout(5000)` → `page.reload({waitUntil: 'load'})` → `waitForTimeout(15000)`. See `e2e-bug-regression.ts` for the pattern.
- **tweb markdown italic trap:** underscores in message text (e.g. `Bug3_reply_reply_...`) are parsed as italic (`_reply_`), which wraps them in `<i>` and breaks `textContent.includes(msg)` assertions. Always use dashes in test message strings (`Bug1-first-msg-${Date.now()}`).
- **Bubble text extraction** for assertions: `.message` contains `.time`, `.time-inner`, `.reactions`, `.bubble-pin` children that pollute `textContent`. Clone the element and `.querySelectorAll('.time, .time-inner, .reactions, .bubble-pin').forEach(e => e.remove())` before reading text.
- `e2e-bug-regression.ts` is the canonical regression suite for the 4 P2P bugs (duplicate first message, missing reply bubble, out-of-order, auto-pin). Run it after any change to the message pipeline or virtual-mtproto-server.
- **Run all E2E:** `pnpm test:e2e:all` (bail on first failure), `pnpm test:e2e:all:no-bail` (run all). Single test: `pnpm test:e2e src/tests/e2e/e2e-foo.ts`. Debug: `pnpm test:e2e:debug src/tests/e2e/e2e-foo.ts`.
- NEVER use `document.body.textContent.includes()` to check received messages — it matches chat list preview. Use `.bubble .message, .bubble .inner, .bubble-content` selectors.
- Relay propagation needs 30s timeout (not 15s). damus.io and nos.lol are reliable; snort.social and nostr.band are frequently offline.
- Two separate `browser.newContext()` for bidirectional tests (isolated IndexedDB/localStorage).
- Dismiss Vite overlay first: `page.evaluate(() => document.querySelector('vite-plugin-checker-error-overlay')?.remove())`
- Open chats via `appImManager.setPeer({peerId})` not click — headless Chromium click on `.chatlist-chat a` doesn't navigate reliably.
- ChatAPI publish log is `[ChatAPI] message published` not `[NostraSendBridge] text sent` (old bridge was removed).
- ALWAYS run `e2e-bidirectional.ts` after changes — it's the only test that verifies actual message delivery between two users. Sender-only tests (`e2e-contacts-and-sending.ts`) do NOT verify the receive pipeline.
- Use `// @ts-nocheck` at top of E2E files (playwright types not in tsconfig).
- `msgArea.pressSequentially(text)` does NOT clear the input. Before each new message, press `Control+A` then `Delete` — otherwise consecutive sends concatenate the previous text and produce merged bubbles.
- Use `.bubble[data-mid]` + `Set<mid>` dedup for counting unique bubbles. Plain `.bubble` catches nested reply/reaction elements. Filter `.message` selectors with `.closest('.reply, .quote') == null` to skip quoted text.
- P2P mids encode timestamp in high bits: `mid = timestamp * 1_000_000 + (hash % 1_000_000)`. This guarantees chronological ordering in SlicedArray's descending sort. `mapEventIdToMid(eventId, timestamp)` and `mapEventId(eventId, timestamp)` both require the message timestamp.
- `peer_changing`/`peer_changed` are dispatched on `appImManager`, not `rootScope`. Access via `MOUNT_CLASS_TO.appImManager.addEventListener(...)`.
- **Local relay for E2E:** `LocalRelay` class in `src/tests/e2e/helpers/local-relay.ts` manages a strfry Docker container on `ws://localhost:7777`. Use `relay.injectInto(ctx)` to override `DEFAULT_RELAYS` via `window.__nostraTestRelays`. Requires Docker installed. Uses `--user $(id -u):$(id -g)` and `--tmpfs /app/strfry-db` — data files are owned by host user (no root cleanup issues) and stored in RAM (no stale data between runs).
- `nostr-relay-pool.ts` checks `window.__nostraTestRelays` at module init — set it via Playwright `addInitScript` before page load. Production ignores the property.
- `keyboard.press('Delete')` after `Control+A` can eat the first character of the NEXT `keyboard.type()` call. Use `Backspace` instead: `Control+A` → `Backspace` → `type(text)`.
- E2E onboarding "Get Started" button may hang (profile publish to relays). Click the "SKIP" link below it as fallback: `page.getByText('SKIP').click()`.
- Solid.js uses event delegation — `dispatchEvent(new MouseEvent('click'))` does NOT trigger Solid onClick handlers. Use `page.mouse.click(x, y)` with coordinates from `getBoundingClientRect()` for SVG/icon clicks in E2E tests.
- To catch transient DOM elements in E2E (overlays, toasts that vanish on reload), register a `MutationObserver` via `page.evaluate()` BEFORE the triggering action, not after — otherwise the element may appear and disappear between the action and the check.

### Bubble Rendering
- Kind 0 profile must be PUBLISHED during onboarding (not just saved locally) for other users to fetch it.
- P2P messages are populated in mirrors automatically via the bridge pipeline (Worker calls getHistory → saveMessages → mirror).
- Calling `appMessagesManager.getHistory({peerId, limit: 1})` from the main thread **pollutes the Worker's history cache** — it marks the slice as `SliceEnd.Both` fulfilled, causing subsequent larger-limit fetches to return the cached (incomplete) result without re-fetching. For P2P message injection, skip `getHistory` and inject directly into `apiManagerProxy.mirrors.messages[${peerId}_history][mid]` instead.
- `history_append` is a one-shot event that only fires when the chat is open with an active `bubbles.ts` listener. For messages arriving while the chat is closed, use a pending-messages queue and flush on `appImManager.addEventListener('peer_changed')` with retry delays (500ms, 1500ms, 3000ms) to wait for `loadedAll.bottom=true`.
- When auto-adding an unknown sender as a contact from `handleRelayMessage`, also inject the User object into `apiManagerProxy.mirrors.peers[peerId]` + call `reconcilePeer` + `appUsersManager.injectP2PUser` — otherwise the chat list title shows but preview text fails to render.
- For new dialogs from unknown senders, `dialogs_multiupdate` must be dispatched TWICE: first dispatch adds the dialog via `sortedList.add()` (returns early, skips `setLastMessageN`), second dispatch hits the "existing dialog" branch which renders the preview text. A single dispatch shows the peer title but no message preview.

### Ralph Loop Integration
- `docs/RALPH_PROMPT_v2.md` contains the master prompt for automated bug fixing via ralph-loop.
- `docs/CHECKLIST_v2.md` is the single source of truth for all P2P feature status, bug reports, file references, and verification commands.
- Ralph-loop completion uses `<promise>TAG</promise>` exact string matching.