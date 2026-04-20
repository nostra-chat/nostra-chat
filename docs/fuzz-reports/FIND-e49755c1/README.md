# FIND-e49755c1 — Mirror/IDB coherence drift (sent + received messages)

Status: **FIXED** in Phase 2b.1 — closed by three fix waves. The third wave
landed the architectural invariant that prevents regressions.

## Symptom

`INV-mirrors-idb-coherent` (tier: medium) fired on `userA` after a
`waitForPropagation(2716ms)` following a burst of text sends and replies:

```
mirror mids not in idb on userA: 1776598357119890, 1776598357119891
```

The mirror (`apiManagerProxy.mirrors.messages.<peerId>_history`) contained
integer mids that had no corresponding row in the `nostra-messages` IndexedDB
— or rows existed but their `mid` field was `null`.

## Root cause (architectural)

A message's identity is the triple `{eventId, mid, timestampSec}` (plus
`twebPeerId` for dialog routing). These fields must be generated **ONCE** at
message creation and travel **IMMUTABLE** through every layer. The codebase
repeatedly violated this rule:

- `StoredMessage.mid` and `twebPeerId` were OPTIONAL, so rows could be
  persisted without them.
- Five read paths (`virtual-mtproto-server.ts:369, 433, 520, 586` and
  `nostra-delivery-ui.ts:57`) fell back to `row.mid ?? await
  mapEventId(row.eventId, row.timestamp)` when a row was partial. If the
  partial row's `timestamp` differed (by even one second) from the
  authoritative writer's `now`, the fallback hashed to a DIFFERENT mid
  and the mirror gained a ghost mid with no IDB counterpart.
- Two write paths (chat-api-receive self-echo, chat-api.ts partial send)
  could land a row without mid, feeding the ghost-mid fallback.

The previous fix waves (commits `4aa59b8f` add `twebPeerId` opts chain,
`f046c2b3` pin `timestampSec`) addressed the observed symptoms case-by-case
but did NOT enforce the invariant architecturally. This third wave does.

### User's architectural principle

> "Il timestamp di creazione deve essere unico, e generato al momento della
> creazione del messaggio e non ricalcolato in futuro, è come il contenuto del
> messaggio accompagna l'oggetto del messaggio con tutte le sue proprietà."
>
> (The creation timestamp must be unique, generated at message creation time,
> and NEVER recalculated later. Like message content, it accompanies the
> message object as an immutable property.)

## Fix (Phase 2b.1 wave 3 — architectural)

### Rule 1: Identity triple is required

`StoredMessage.mid` and `twebPeerId` are now required fields. A narrow
`PartialStoredMessage` type remains only for in-place updates (spread existing
row + mutate deliveryState). All first-time writers must supply the full
triple.

### Rule 2: No fallback recomputes in read paths

The 5 `row.mid ?? await mapEventId(...)` fallbacks are replaced with throw
(read paths) or early-return (UI refresh). If `row.mid` is null at read time,
that's now loud — an upstream write-path bug, not a silent ghost-mid source.

### Rule 3: Single authoritative timestampSec

`VMT.sendMessage` captures `now = Math.floor(Date.now()/1000)` ONCE and passes
it to `chatAPI.sendText` as `timestampSec`. ChatAPI pins its internal timestamp
to this value so the partial row's timestamp matches VMT's authoritative
timestamp — no inter-writer drift.

### Rule 4: Mid is computed at creation, stored, never re-derived

`ChatAPI.sendMessage` now computes the mid via `NostraBridge.mapEventIdToMid`
BEFORE its first save, using the authoritative `timestampSec`. The row is
born authoritative — no more partial row that downstream readers would
fall back on.

`updateMessageStatus` is explicit about preserving identity: it reads the
full row, spreads it, mutates only `deliveryState`, saves back.

### Rule 5: Receive paths compute identity once or skip

`chat-api-receive.ts` main incoming save path and `handleSelfEcho` both
compute mid+twebPeerId via the bridge before saving. If the bridge fails,
they skip the save entirely rather than land a partial row that would feed
ghost mids.

## Files changed (Phase 2b.1 wave 3)

- `src/lib/nostra/message-store.ts` — `mid`/`twebPeerId` required;
  `PartialStoredMessage` introduced; doc updated.
- `src/lib/nostra/chat-api.ts` — `sendMessage` computes mid locally via
  bridge; `updateMessageStatus` explicitly preserves identity.
- `src/lib/nostra/chat-api-receive.ts` — main save path and self-echo both
  skip on bridge-resolve failure; no more partial rows.
- `src/lib/nostra/virtual-mtproto-server.ts` — 4 `?? mapEventId(...)`
  fallbacks replaced with throw-on-null (getDialogs 1:1, getDialogs groups,
  getHistory, searchMessages).
- `src/lib/nostra/nostra-delivery-ui.ts` — refreshDialogPreview bails out
  on partial row instead of recomputing from stale timestamp.
- `src/lib/nostra/nostra-send-file.ts` — `realMid` renamed to `timestampSec`
  with documenting comment; no behaviour change.

## Regression tests

- `src/tests/nostra/message-identity-triple.test.ts` — 5 unit tests covering
  the type contract, upsert identity preservation, and the update pattern.
- `src/tests/fuzz/invariants/state.ts` — `INV-stored-message-identity-complete`
  (medium tier): scans `nostra-messages` on both fuzz users after every
  medium-tier check; fails fast when any row is missing `mid`, `twebPeerId`,
  or `timestamp`.
- `src/tests/fuzz/invariants/state.test.ts` — 4 vitests for the new invariant.
- `src/tests/nostra/mirror-idb-coherent.test.ts` — kept and expanded.
- `test:nostra:quick` curated list now includes the two new suites.

## Verification

- `pnpm test:nostra:quick` — 401/401 pass (before: 393/393, after: 401/401).
- `npx vitest run src/tests/fuzz/` — 50/50 pass.
- `npx tsc --noEmit` — clean.
- `pnpm lint` — clean.
- `pnpm fuzz --seed=48 --duration=3m --max-commands=40` — 3 iterations,
  **0 findings**. The original seed that reproduced FIND-e49755c1 no longer
  trips any invariant.
- `pnpm fuzz --replay=FIND-e49755c1` — hits an unrelated environmental
  failure (SW registration in Playwright dev-server) at action 1, before
  reaching the original `waitForPropagation` step. The `INV-mirrors-idb-coherent`
  signature itself does NOT fire.

## Audit summary

See `audit-identity-triple.md` for the diagnostic audit that drove this
wave: 5 read-path fallback violations fixed, 2 write-path violations fixed,
4 creation points confirmed sound.

## Related

- `docs/fuzz-reports/FIND-cfd24d69/` — dup-mid blocker (Phase 2a).
- `docs/fuzz-reports/FIND-676d365a/` — delete-side race (Phase 2a).
- Invariants: `src/tests/fuzz/invariants/state.ts` — `mirrorsIdbCoherent`
  (symptom), `storedMessageIdentityComplete` (cause guard).
