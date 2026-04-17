// @ts-nocheck
import type {ActionSpec, Action, FuzzContext} from '../types';
import * as fc from 'fast-check';

const TEXT_ARB = fc.oneof(
  {weight: 70, arbitrary: fc.string({minLength: 1, maxLength: 120})},
  {weight: 20, arbitrary: fc.constantFrom('hi', 'hello', '👋', 'ok', 'test 123', '🔥🔥🔥', 'see you')},
  {weight: 10, arbitrary: fc.string({minLength: 1, maxLength: 500})}
);

export const sendText: ActionSpec = {
  name: 'sendText',
  weight: 40,
  generateArgs: () => fc.record({
    from: fc.constantFrom('userA', 'userB'),
    text: TEXT_ARB
  }),
  async drive(ctx: FuzzContext, action: Action) {
    const from: 'userA' | 'userB' = action.args.from;
    const to: 'userA' | 'userB' = from === 'userA' ? 'userB' : 'userA';
    const sender = ctx.users[from];
    const recipient = ctx.users[to];

    // Open the chat to the recipient.
    await sender.page.evaluate((peerId: number) => {
      (window as any).appImManager?.setPeer?.({peerId});
    }, sender.remotePeerId);
    await sender.page.waitForTimeout(300);

    // Find the chat input. Following CLAUDE.md: no space inside selectors, no Delete after Ctrl+A.
    const input = sender.page.locator('.chat-input [contenteditable="true"]').first();
    try{
      await input.waitFor({state: 'visible', timeout: 5000});
    } catch{
      action.skipped = true;
      return action;
    }

    await input.focus();
    await sender.page.keyboard.press('Control+A');
    await sender.page.keyboard.press('Backspace');
    await sender.page.keyboard.type(action.args.text);

    const sendBtn = sender.page.locator('.chat-input button.btn-send').first();
    await sendBtn.click().catch(() => {});

    action.meta = {sentAt: Date.now(), fromId: from, toId: to, text: action.args.text};
    return action;
  }
};
