// @ts-nocheck
import type {Invariant, FuzzContext, UserHandle, InvariantResult, Action} from '../types';

type BubbleSnapshot = {
  bubbles: Array<{dataset: any; classList: string[] | DOMTokenList}>;
};

/**
 * Run a DOM inspection script against both users and return the first failure.
 *
 * `browserScript` is a *pure* function from snapshot → InvariantResult. It gets
 * passed directly to `page.evaluate` so that (a) in real Playwright, the page
 * passes a freshly-collected DOM snapshot to it, and (b) in unit tests, the
 * `page.evaluate` stub can invoke it with fake-snapshot data directly.
 *
 * The page-side helper `window.__fuzzCollectBubbles` is installed once per
 * Playwright context by the harness; it returns the current bubble snapshot so
 * `page.evaluate(script)` can be self-contained. The helper is not required for
 * tests because the mock bypasses the browser entirely.
 */
async function forEachUser(
  ctx: FuzzContext,
  browserScript: (args: BubbleSnapshot) => InvariantResult | Promise<InvariantResult>
): Promise<InvariantResult> {
  for(const id of ['userA', 'userB'] as const) {
    const user: UserHandle = ctx.users[id];
    const result: InvariantResult = await user.page.evaluate(browserScript as any);
    if(!result.ok) return {...result, evidence: {...(result.evidence || {}), user: id}};
  }
  return {ok: true};
}

export const noDupMid: Invariant = {
  id: 'INV-no-dup-mid',
  tier: 'cheap',
  async check(ctx: FuzzContext): Promise<InvariantResult> {
    return forEachUser(ctx, (args) => {
      const mids = args.bubbles.map((b) => b.dataset.mid);
      const set = new Set(mids);
      if(set.size === mids.length) return {ok: true};
      const dupes = mids.filter((m, i) => mids.indexOf(m) !== i);
      return {
        ok: false,
        message: `duplicate mid(s) in DOM: ${[...new Set(dupes)].join(', ')}`,
        evidence: {totalBubbles: mids.length, uniqueMids: set.size, duplicates: [...new Set(dupes)]}
      };
    });
  }
};

export const bubbleChronological: Invariant = {
  id: 'INV-bubble-chronological',
  tier: 'cheap',
  async check(ctx: FuzzContext): Promise<InvariantResult> {
    return forEachUser(ctx, (args) => {
      const ts = args.bubbles.map((b) => Number(b.dataset.timestamp)).filter((n) => !Number.isNaN(n));
      for(let i = 1; i < ts.length; i++) {
        if(ts[i] < ts[i - 1]) {
          return {
            ok: false,
            message: `bubbles not chronological: idx ${i - 1}=${ts[i - 1]} > idx ${i}=${ts[i]}`,
            evidence: {timestamps: ts}
          };
        }
      }
      return {ok: true};
    });
  }
};

export const noAutoPin: Invariant = {
  id: 'INV-no-auto-pin',
  tier: 'cheap',
  async check(ctx: FuzzContext): Promise<InvariantResult> {
    return forEachUser(ctx, (args) => {
      const pinned = args.bubbles.filter((b) => (b.classList as any as string[]).includes('is-pinned'));
      if(pinned.length === 0) return {ok: true};
      return {
        ok: false,
        message: `found ${pinned.length} pinned bubble(s) without a pin action`,
        evidence: {pinnedMids: pinned.map((b) => b.dataset.mid)}
      };
    });
  }
};

export const sentBubbleVisibleAfterSend: Invariant = {
  id: 'INV-sent-bubble-visible-after-send',
  tier: 'cheap',
  async check(ctx: FuzzContext, action?: Action): Promise<InvariantResult> {
    if(!action || action.name !== 'sendText' || action.skipped) return {ok: true};
    const text: string = action.args.text;
    const fromId: 'userA' | 'userB' = action.args.from;
    const user = ctx.users[fromId];
    const found = await user.page.evaluate((needle: string) => {
      const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
      for(const b of bubbles) {
        const clone = b.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.time, .time-inner, .reactions, .bubble-pin').forEach((e) => e.remove());
        if((clone.textContent || '').includes(needle)) return true;
      }
      return false;
    }, text);
    if(found) return {ok: true};
    return {
      ok: false,
      message: `sent text "${text.slice(0, 30)}" not visible on sender ${fromId}`,
      evidence: {sender: fromId, text: text.slice(0, 100)}
    };
  }
};
