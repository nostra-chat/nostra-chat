// @ts-nocheck
import type {Postcondition, FuzzContext, Action, InvariantResult} from '../types';

export const POST_sendText_bubble_appears: Postcondition = {
  id: 'POST-sendText-bubble-appears',
  async check(ctx, action: Action): Promise<InvariantResult> {
    if(action.skipped) return {ok: true};
    const sender = ctx.users[action.args.from as 'userA' | 'userB'];
    // tweb trims leading/trailing whitespace on send (expected behaviour),
    // so the stored message and rendered bubble show the trimmed text. Match
    // on the trimmed value, and skip entirely when the trimmed text is empty
    // (tweb drops no-op sends).
    const text: string = String(action.args.text).trim();
    if(!text) return {ok: true};
    const deadline = Date.now() + 2500;
    while(Date.now() < deadline) {
      const found = await sender.page.evaluate((needle: string) => {
        const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
        for(const b of bubbles) {
          const clone = b.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('.time, .time-inner, .reactions, .bubble-pin').forEach((e) => e.remove());
          // tweb may render emoji as <img alt="🔥"> (native-emoji off / custom
          // emoji pack); textContent ignores alt. Concat alt= of all imgs so
          // the needle match works in both rendering modes.
          const imgAlt = Array.from(clone.querySelectorAll('img[alt]'))
            .map((i) => i.getAttribute('alt') || '').join('');
          const fullText = (clone.textContent || '') + imgAlt;
          if(fullText.includes(needle)) return true;
        }
        return false;
      }, text);
      if(found) return {ok: true};
      await sender.page.waitForTimeout(200);
    }
    return {ok: false, message: `sent bubble with text "${text.slice(0, 40)}" never appeared on sender`};
  }
};

export const POST_sendText_input_cleared: Postcondition = {
  id: 'POST-sendText-input-cleared',
  async check(ctx, action): Promise<InvariantResult> {
    if(action.skipped) return {ok: true};
    const sender = ctx.users[action.args.from as 'userA' | 'userB'];
    const text = await sender.page.evaluate(() => {
      const el = document.querySelector('.chat-input [contenteditable="true"]') as HTMLElement | null;
      return (el?.textContent || '').trim();
    });
    if(text.length === 0) return {ok: true};
    return {ok: false, message: `chat input not cleared after send (still contains "${text.slice(0, 40)}")`};
  }
};

export const POST_edit_preserves_mid: Postcondition = {
  id: 'POST-edit-preserves-mid',
  async check(ctx, action): Promise<InvariantResult> {
    if(action.skipped) return {ok: true};
    const mid = action.meta?.editedMid;
    if(!mid) return {ok: true};
    const sender = ctx.users[action.args.user as 'userA' | 'userB'];
    const stillPresent = await sender.page.evaluate((m: string) => {
      return !!document.querySelector(`.bubbles-inner .bubble[data-mid="${m}"]`);
    }, mid);
    if(stillPresent) return {ok: true};
    return {ok: false, message: `edited bubble mid=${mid} disappeared after edit`};
  }
};

export const POST_edit_content_updated: Postcondition = {
  id: 'POST-edit-content-updated',
  async check(ctx, action): Promise<InvariantResult> {
    if(action.skipped) return {ok: true};
    const mid = action.meta?.editedMid;
    const newText = action.meta?.newText as string;
    if(!mid || !newText) return {ok: true};
    const sender = ctx.users[action.args.user as 'userA' | 'userB'];
    const deadline = Date.now() + 3000;
    while(Date.now() < deadline) {
      const ok = await sender.page.evaluate(({m, t}: any) => {
        const b = document.querySelector(`.bubbles-inner .bubble[data-mid="${m}"]`);
        if(!b) return false;
        const clone = b.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.time, .time-inner, .reactions, .bubble-pin').forEach((e) => e.remove());
        return (clone.textContent || '').includes(t);
      }, {m: mid, t: newText});
      if(ok) return {ok: true};
      await sender.page.waitForTimeout(200);
    }
    return {ok: false, message: `edited bubble mid=${mid} content not updated to "${newText.slice(0, 40)}"`};
  }
};

export const POST_delete_local_bubble_gone: Postcondition = {
  id: 'POST-delete-local-bubble-gone',
  async check(ctx, action): Promise<InvariantResult> {
    if(action.skipped) return {ok: true};
    const mid = action.meta?.deletedMid;
    if(!mid) return {ok: true};
    const sender = ctx.users[action.args.user as 'userA' | 'userB'];
    const deadline = Date.now() + 2500;
    while(Date.now() < deadline) {
      const gone = await sender.page.evaluate((m: string) => {
        return !document.querySelector(`.bubbles-inner .bubble[data-mid="${m}"]`);
      }, mid);
      if(gone) return {ok: true};
      await sender.page.waitForTimeout(200);
    }
    return {ok: false, message: `deleted bubble mid=${mid} still present locally`};
  }
};

export const POST_react_emoji_appears: Postcondition = {
  id: 'POST-react-emoji-appears',
  async check(ctx, action): Promise<InvariantResult> {
    if(action.skipped) return {ok: true};
    const mid = action.meta?.reactedMid;
    const emoji = action.meta?.emoji as string;
    if(!mid || !emoji) return {ok: true};
    const sender = ctx.users[action.args.user as 'userA' | 'userB'];
    const deadline = Date.now() + 2500;
    while(Date.now() < deadline) {
      const ok = await sender.page.evaluate(({m, e}: any) => {
        const bubble = document.querySelector(`.bubbles-inner .bubble[data-mid="${m}"]`);
        return !!bubble && !!bubble.querySelector('.reactions') && (bubble.textContent || '').includes(e);
      }, {m: mid, e: emoji});
      if(ok) return {ok: true};
      await sender.page.waitForTimeout(200);
    }
    return {ok: false, message: `reaction ${emoji} not visible on mid=${mid}`};
  }
};

export const POST_react_peer_sees_emoji: Postcondition = {
  id: 'POST_react_peer_sees_emoji',
  async check(ctx: FuzzContext, action: Action) {
    if(action.skipped) return {ok: true};
    const fromUser: 'userA' | 'userB' = action.args.user;
    const toUser: 'userA' | 'userB' = fromUser === 'userA' ? 'userB' : 'userA';
    const peer = ctx.users[toUser];
    const emoji = action.args.emoji;
    const mid = action.meta?.reactedMid;
    if(!mid) return {ok: true};
    // Poll up to 3s.
    const deadline = Date.now() + 3000;
    while(Date.now() < deadline) {
      const has = await peer.page.evaluate((target) => {
        const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
        for(const b of bubbles) {
          if((b as HTMLElement).dataset.mid !== String(target.mid)) continue;
          const rt = b.querySelector('.reactions');
          if(rt && rt.textContent?.includes(target.emoji)) return true;
        }
        return false;
      }, {mid, emoji});
      if(has) return {ok: true};
      await peer.page.waitForTimeout(250);
    }
    return {ok: false, message: `peer ${toUser} never saw emoji ${emoji} on bubble ${mid}`, evidence: {from: fromUser, to: toUser, mid, emoji}};
  }
};

export const POST_remove_reaction_peer_disappears: Postcondition = {
  id: 'POST_remove_reaction_peer_disappears',
  async check(ctx: FuzzContext, action: Action) {
    if(action.skipped) return {ok: true};
    const fromUser: 'userA' | 'userB' = action.args.user;
    const toUser: 'userA' | 'userB' = fromUser === 'userA' ? 'userB' : 'userA';
    const peer = ctx.users[toUser];
    const emoji = action.meta?.emoji;
    const mid = action.meta?.mid;
    if(!emoji || !mid) return {ok: true};
    const deadline = Date.now() + 3000;
    while(Date.now() < deadline) {
      const stillThere = await peer.page.evaluate((target) => {
        const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
        for(const b of bubbles) {
          if((b as HTMLElement).dataset.mid !== String(target.mid)) continue;
          const rt = b.querySelector('.reactions');
          if(rt && rt.textContent?.includes(target.emoji)) return true;
        }
        return false;
      }, {mid, emoji});
      if(!stillThere) return {ok: true};
      await peer.page.waitForTimeout(250);
    }
    return {ok: false, message: `peer ${toUser} still shows removed emoji ${emoji} on bubble ${mid}`, evidence: {from: fromUser, to: toUser, mid, emoji}};
  }
};

export const POST_react_multi_emoji_separate: Postcondition = {
  id: 'POST_react_multi_emoji_separate',
  async check(ctx: FuzzContext, action: Action) {
    if(action.skipped) return {ok: true};
    const fromUser: 'userA' | 'userB' = action.args.user;
    const sender = ctx.users[fromUser];
    const emojis: string[] = action.meta?.emojis || [];
    const mid = action.meta?.targetMid;
    if(!emojis.length || !mid) return {ok: true};
    const deadline = Date.now() + 3000;
    while(Date.now() < deadline) {
      const visible = await sender.page.evaluate((target) => {
        const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
        for(const b of bubbles) {
          if((b as HTMLElement).dataset.mid !== String(target.mid)) continue;
          const rt = b.querySelector('.reactions');
          return rt?.textContent || '';
        }
        return '';
      }, {mid});
      if(emojis.every((em) => visible.includes(em))) return {ok: true};
      await sender.page.waitForTimeout(250);
    }
    return {ok: false, message: `sender ${fromUser} missing one of ${emojis.join(',')} on bubble ${mid}`, evidence: {user: fromUser, mid, emojis}};
  }
};
