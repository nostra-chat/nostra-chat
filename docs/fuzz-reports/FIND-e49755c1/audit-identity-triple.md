# Audit: Identity Triple (eventId, mid, timestampSec) in Nostra P2P

## Goal
Verify every write produces a row with `{eventId, mid, timestampSec, twebPeerId}` filled
once at creation, and every consumer reads the row without re-deriving identity.

## mapEventId / mapEventIdToMid call sites

| # | Location | Classification | Notes |
|---|---|---|---|
| 1 | `virtual-mtproto-server.ts:369` | **FALLBACK** | `getDialogs`: `latest.mid ?? mapEventId(latest.eventId, latest.timestamp)` — VIOLATION. Replace with throw. |
| 2 | `virtual-mtproto-server.ts:433` | **FALLBACK** | `getDialogs` (groups branch). VIOLATION. Replace with throw. |
| 3 | `virtual-mtproto-server.ts:520` | **FALLBACK** | `getHistory`: same pattern. VIOLATION. Replace with throw. |
| 4 | `virtual-mtproto-server.ts:586` | **FALLBACK** | `searchMessages`: same pattern. VIOLATION. Replace with throw. |
| 5 | `virtual-mtproto-server.ts:756` | **CREATION** | `sendMessage`: `mapEventId(eventId, now)` — OK. Single authoritative compute. |
| 6 | `nostra-sync.ts:41` | **CREATION** | `onIncomingMessage`: `mapEventId(storageEventId, Math.floor(msg.timestamp))` — OK, receive-side single compute. |
| 7 | `chat-api-receive.ts:387` | **CREATION** | `bridge.mapEventIdToMid(msg.id, Math.floor(msg.timestamp))` — OK. |
| 8 | `add-p2p-contact.ts:121` | **CREATION** | `mapEventId(initEventId, seedTimestamp)` — OK for synthetic contact-init. |
| 9 | `nostra-delivery-ui.ts:57` | **FALLBACK** | `refreshDialogPreview`: `latest.mid ?? mapEventId(latest.eventId, latest.timestamp)`. VIOLATION. Fix by trusting stored mid. |
| 10 | `nostra-delivery-ui.ts:130` | **DERIVE** (tolerable) | `handleDeliveredOrRead`: lookup by eventId → if missing mid, re-compute. Only fires for delivery UI. Acceptable — but we can preserve `stored.mid` check + warn. |
| 11 | `nostra-peer-mapper.ts:193` | **DEFINITION** | `mapEventId()` — the function itself. OK. |
| 12 | `nostra-bridge.ts:326` | **DEFINITION** | `mapEventIdToMid()` — the function itself. OK. |

Total **fallback violations to remove**: 5 (lines 369, 433, 520, 586 in VMT; 57 in delivery-ui).
Creation points: 4 (OK).

## stored.mid / row.mid consumers

| # | Location | Classification | Notes |
|---|---|---|---|
| 1 | `chat-api-receive.ts:413` | WRITE | `row.mid = resolvedMid` — OK (creation; conditional assign). |
| 2 | `virtual-mtproto-server.ts:520` | READ+FALLBACK | see above. |
| 3 | `virtual-mtproto-server.ts:586` | READ+FALLBACK | see above. |
| 4 | `chat-api.ts:333` | READ | reactions receiver guard — returns undefined if row.mid missing. OK. |
| 5 | `chat-api.ts:334` | READ | `{mid: row.mid, peerId: row.twebPeerId}`. OK. |
| 6 | `chat-api.ts:556` | WRITE | `if(opts?.mid !== undefined) row.mid = opts.mid`. OK (creation). |
| 7 | `virtual-mtproto-server.ts:369` | READ+FALLBACK | see above. |
| 8 | `virtual-mtproto-server.ts:433` | READ+FALLBACK | see above. |

## saveMessage call sites (12 total)

| # | Location | Saves with mid? | Notes |
|---|---|---|---|
| 1 | `virtual-mtproto-server.ts:763` | YES | VMT sendMessage authoritative save. OK. |
| 2 | `virtual-mtproto-server.ts:1159` | YES | VMT nostraSendFile. OK. |
| 3 | `chat-api.ts:562` | CONDITIONAL | `if opts.mid !== undefined row.mid = opts.mid`. Must ensure callers always pass mid (send + sendFile do). |
| 4 | `chat-api.ts:663` | YES | `editMessage` spreads `...existing`, preserves mid. OK. |
| 5 | `chat-api.ts:811` | CONDITIONAL (preserve) | `updateMessageStatus` fire-and-forget: uses `stored` object, mutates only `deliveryState`. OK (doesn't touch identity). |
| 6 | `nostra-send-file.ts:246` | YES | passes mid = realMid. OK. |
| 7 | `nostra-sync.ts:47` | YES | onIncomingMessage. OK. |
| 8 | `chat-api-receive.ts:234` | YES | edit handling: `...original`. OK. |
| 9 | `chat-api-receive.ts:416` | CONDITIONAL | Only sets mid if resolvedMid defined. If bridge fails we save WITHOUT mid → triggers fallback later. Need to always succeed or throw. |
| 10 | `chat-api-receive.ts:465` | NO | self-echo handler: saves without mid/twebPeerId. VIOLATION. |
| 11 | `add-p2p-contact.ts:122` | YES | contact-init seed. OK. |

## Summary

- 5 **?? fallback violations** in read paths (VMT x4, delivery-ui x1).
- 2 **write paths without mid**: chat-api-receive.ts:465 (self-echo), partial `chat-api.ts:562` path when VMT does not pass opts (rare — only legacy callers).
- 1 **re-derive permissible** in delivery-ui.ts:130 (fallback for UI only).

## Action Plan

1. Tighten `StoredMessage` — `mid` and `twebPeerId` required.
2. Introduce `PartialStoredMessage` type — only for the contact-init seed (already has mid) → actually all paths supply them, so we can keep strict type.
3. Replace the 5 `??` fallbacks with throw.
4. Fix the 2 write violations (self-echo + conditional chat-api-receive).
5. Add regression test `message-identity-triple.test.ts`.
6. Add fuzz invariant `INV-stored-message-identity-complete` (cheap tier).
