import {z} from 'zod';
import type {IntentDef, IntentResult} from './types';
import type {AtomicAction} from '../types';
import type {FuzzContext, Action} from '../../../src/tests/fuzz/types';
import {sendText} from '../../../src/tests/fuzz/actions/messaging';
import {reactViaUI} from '../../../src/tests/fuzz/actions/reactions';

const SendTextParams = z.object({
  from: z.enum(['userA', 'userB']),
  text: z.string().min(1).max(5000)
});

const ReactToMessageParams = z.object({
  from: z.enum(['userA', 'userB']),
  emoji: z.string().min(1).max(8)
});

export const send_text_message: IntentDef<z.infer<typeof SendTextParams>> = {
  name: 'send_text_message',
  area: 'messaging',
  paramsSchema: SendTextParams,
  description: 'Send a text message from one user to the other peer.',
  async exec(params, ctx: FuzzContext): Promise<IntentResult> {
    const action: Action = {name: 'sendText', args: params};
    const synthetic: AtomicAction[] = [
      {type: 'click', page: params.from === 'userA' ? 'A' : 'B', selector: '.chat-list peer'},
      {type: 'fill', page: params.from === 'userA' ? 'A' : 'B', selector: '.chat-input [contenteditable="true"]', value: params.text},
      {type: 'click', page: params.from === 'userA' ? 'A' : 'B', selector: '.chat-input button.btn-send'}
    ];
    try {
      await sendText.drive(ctx, action);
      return {ok: !action.skipped, atomic_trace: synthetic, observations: []};
    } catch(err: any) {
      return {ok: false, atomic_trace: synthetic, observations: [], error: err?.message ?? String(err)};
    }
  }
};

export const react_to_message: IntentDef<z.infer<typeof ReactToMessageParams>> = {
  name: 'react_to_message',
  area: 'messaging',
  paramsSchema: ReactToMessageParams,
  description: 'Add a reaction emoji to the most recent message in the open chat.',
  async exec(params, ctx: FuzzContext): Promise<IntentResult> {
    const action: Action = {name: 'reactViaUI', args: params};
    const synthetic: AtomicAction[] = [
      {type: 'click', page: params.from === 'userA' ? 'A' : 'B', selector: '.bubble:last-child'},
      {type: 'click', page: params.from === 'userA' ? 'A' : 'B', selector: '.reactions-menu'},
      {type: 'click', page: params.from === 'userA' ? 'A' : 'B', selector: `.reactions-menu emoji[value="${params.emoji}"]`}
    ];
    try {
      await reactViaUI.drive(ctx, action);
      return {ok: !action.skipped, atomic_trace: synthetic, observations: []};
    } catch(err: any) {
      return {ok: false, atomic_trace: synthetic, observations: [], error: err?.message ?? String(err)};
    }
  }
};

export const messagingIntents: Record<string, IntentDef<any>> = {
  send_text_message: send_text_message as IntentDef<any>,
  react_to_message: react_to_message as IntentDef<any>
};
