// @ts-nocheck
import type {Invariant, FuzzContext, UserHandle, InvariantResult, Action} from '../types';

const PROPAGATION_MS = 2000;

export const deliveryUiMatchesTracker: Invariant = {
  id: 'INV-delivery-ui-matches-tracker',
  tier: 'cheap',
  async check(ctx: FuzzContext, action?: Action): Promise<InvariantResult> {
    // Propagation window: if the last action was a send, give 2s for the tick
    // to settle before we compare.
    if(action?.name === 'sendText') {
      const sentAt = (action.meta?.sentAt as number) || 0;
      if(Date.now() - sentAt < PROPAGATION_MS) return {ok: true};
    }

    for(const id of ['userA', 'userB'] as const) {
      const res = await checkOne(ctx.users[id], id);
      if(!res.ok) return res;
    }
    return {ok: true};
  }
};

async function checkOne(user: UserHandle, id: 'userA' | 'userB'): Promise<InvariantResult> {
  const payload = await user.page.evaluate(() => {
    const tracker = (window as any).__nostraChatAPI?.deliveryTracker;
    const states: Record<string, string> = tracker?.getAllStates
      ? tracker.getAllStates()
      : (tracker?.states ? Object.fromEntries(tracker.states) : {});

    const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid].is-out, .bubbles-inner .bubble[data-mid].is-own'));
    const domStates: Array<{mid: string; cls: string}> = bubbles.map((b) => {
      const el = b as HTMLElement;
      const classes = Array.from(el.classList);
      let cls = 'unknown';
      if(classes.includes('is-read')) cls = 'read';
      else if(classes.includes('is-delivered')) cls = 'delivered';
      else if(classes.includes('is-sent')) cls = 'sent';
      else if(classes.includes('is-sending')) cls = 'sending';
      return {mid: el.dataset.mid || '', cls};
    });

    return {states, domStates};
  });

  for(const d of payload.domStates) {
    const trackerState = payload.states[d.mid];
    if(trackerState === undefined) continue; // tracker unaware — separate invariant
    // Monotonic ordering of states: sending < sent < delivered < read. DOM can
    // be at or ABOVE tracker (DOM is slow); DOM below tracker is the bug.
    const order = ['sending', 'sent', 'delivered', 'read'];
    const di = order.indexOf(d.cls);
    const ti = order.indexOf(trackerState);
    if(di === -1 || ti === -1) continue;
    if(di < ti) {
      return {
        ok: false,
        message: `bubble ${d.mid} DOM state '${d.cls}' below tracker state '${trackerState}' on ${id}`,
        evidence: {mid: d.mid, domState: d.cls, trackerState, user: id}
      };
    }
  }
  return {ok: true};
}
