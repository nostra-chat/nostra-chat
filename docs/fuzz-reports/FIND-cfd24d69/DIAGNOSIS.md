# FIND-cfd24d69 — root cause diagnosis

**Type of fix:** Type-B (tempId collides with an existing real mid — add a
uniqueness guard). The guard lives in `appMessagesIdsManager.generateTempMessageId`
because the collision source is a JS floating-point precision loss.

## Symptom

On userA's chat pane, after a cross-direction send (B sends to A, then A
replies or sends to B), the DOM contains two `.bubble[data-mid="<X>"]` with
the same `data-mid`:

- **Bubble 1** `is-in`: B's most recent incoming message.
- **Bubble 2** `is-out`: A's most recent outgoing.

Both share A's newly computed real mid. B's bubble's original `data-mid` has
been overwritten.

## Root cause (confirmed via instrumented replay of seed=44)

Captured console log from the message_sent handler in `bubbles.ts`:

```
[dup-mid-diag] site-A (message_sent rename)
  {txt: ')z~#…', oldMid: 1776548498900018, newMid: 1776548499716273,
   isOut: false, isIn: true}
```

The rename block at `bubbles.ts:785-790` looked up `this.getBubble(fullTempMid)`
and resolved it to **B's incoming bubble** — not A's outgoing. The handler
then wrote A's real mid to B's bubble's `dataset.mid`, creating the dup.

The lookup key is `fullTempMid = ${peerId}_${tempMessage.mid}`. For the
lookup to hit B's bubble (stored at `${peerId}_${B_mid}`), `tempMessage.mid`
must equal `B_mid`. That is precisely what happens:

1. `appMessagesManager.generateOutgoingMessage` (line 2972) sets
   `message.id = this.generateTempMessageId(peerId, topMessage)`.
2. `topMessage` is the dialog's current `top_message`, which for a chat
   where B has just sent to A equals B's mid (≈ `1.78e15`).
3. `appMessagesManager.generateTempMessageId` (line 4943) delegates to
   `appMessagesIdsManager.generateTempMessageId(topMessage, channelId)`.
4. That helper does:
   ```
   return +(this.generateMessageId(messageId, channelId) + 0.0001).toFixed(4);
   ```
5. For non-channel P2P peers, `generateMessageId` returns `messageId`
   unchanged. So the call becomes `(B_mid + 0.0001).toFixed(4)`.
6. **Precision collapse.** `Number.EPSILON * 1.78e15 ≈ 0.395`, which is far
   larger than `0.0001`. Adding `0.0001` to a 1.78e15-magnitude number has
   no effect; `.toFixed(4)` then produces the same integer as input.

Reproduced in isolation:

```js
> const b = 1776548498900018;
> const t = +(b + 0.0001).toFixed(4);
> b === t
true
```

So for any P2P peer where the top-message mid is > ~2^50, the temp mid
collapses onto the existing top mid. bubbles.ts then renames that existing
bubble's `data-mid` during the `message_sent` handler, producing the dup.

## Why this only happens on cross-direction sends

The formula `topMessage ?? historyStorage?.maxId` only yields a P2P-scale
value when the chat has at least one stored message (from the other peer).
On a fresh chat the initial send has `topMessage = 0` and the temp mid
computes correctly as `0.0001`. Once B sends (or A sends) anything, subsequent
A-side (or B-side) sends pull a huge `topMessage` and hit the precision bug.

## Planned fix (Task 8)

**File:** `src/lib/appManagers/appMessagesIdsManager.ts` (line 16-18)

For large input (where `+0.0001` is below Number precision), use `+1`
instead. Threshold: `2^50 = 1.125e15`. P2P virtual mids are
`timestamp * 1e6 + hash%1e6` ≈ 1.78e15, always above 2^50. Current tweb
Telegram mids (server-side) are below MESSAGE_ID_OFFSET + 2^32, nowhere
near the threshold — unchanged behavior for them.

```ts
public generateTempMessageId(messageId: number, channelId: ChatId) {
  const base = this.generateMessageId(messageId, channelId);
  // Float precision collapses +0.0001 for base >= 2^50 (FIND-cfd24d69).
  // Fall back to integer +1 so the tempMid is still > topMessage and
  // collision-free against the existing real mids in the history.
  if(base >= 2 ** 50) {
    return base + 1;
  }
  return +(base + 0.0001).toFixed(4);
}
```

## Tests

- Unit regression guard: `src/tests/nostra/bubbles-dup-mid.test.ts` (Task 6).
- Fuzz invariant: `INV-no-dup-mid` un-mute (Task 9).

## Evidence artifacts

- `failure.json` — invariant-fail record (INV-no-dup-mid, mids colliding on 1776548499716273).
- `trace.json` — 2-step reproducer seed=44: userB sendText → userA replyToRandomBubble.
- `dom-A.html`, `dom-B.html` — DOM snapshots at failure (A's pane has the dup).
- `console.log` — captured `[dup-mid-diag]` entries pinpointing site-A.
