import {z} from 'zod';
import type {IntentDef, IntentResult} from './types';
import type {AtomicAction} from '../types';
import type {FuzzContext, Action, ActionSpec} from '../../../src/tests/fuzz/types';
import {editNameAction, editBioAction, setNip05Action} from '../../../src/tests/fuzz/actions/profile';

const EditProfileFieldParams = z.object({
  user: z.enum(['userA', 'userB']),
  field: z.enum(['displayName', 'bio', 'nip05']),
  value: z.string().max(500)
});

const pageOf = (u: 'userA'|'userB'): 'A'|'B' => u === 'userA' ? 'A' : 'B';

const fieldToAction: Record<'displayName'|'bio'|'nip05', ActionSpec> = {
  displayName: editNameAction,
  bio: editBioAction,
  nip05: setNip05Action
};

const fieldToArgKey: Record<'displayName'|'bio'|'nip05', string> = {
  displayName: 'newName',
  bio: 'newBio',
  nip05: 'nip05'
};

export const edit_profile_field: IntentDef<z.infer<typeof EditProfileFieldParams>> = {
  name: 'edit_profile_field',
  area: 'profile',
  paramsSchema: EditProfileFieldParams,
  description: 'Open settings, edit one of {displayName, bio, nip05}, save. Dispatches to the corresponding fuzz action (editNameAction/editBioAction/setNip05Action) using the correct arg key.',
  async exec(params, ctx: FuzzContext): Promise<IntentResult> {
    const spec = fieldToAction[params.field];
    const argKey = fieldToArgKey[params.field];
    const action: Action = {name: spec.name, args: {user: params.user, [argKey]: params.value}};
    const trace: AtomicAction[] = [
      {type: 'click', page: pageOf(params.user), selector: '.sidebar-header .btn-menu-toggle'},
      {type: 'click', page: pageOf(params.user), selector: 'menu Settings'},
      {type: 'click', page: pageOf(params.user), selector: 'profile-editor'},
      {type: 'fill', page: pageOf(params.user), selector: `[data-field="${params.field}"]`, value: params.value},
      {type: 'click', page: pageOf(params.user), selector: 'button.btn-save-profile'}
    ];
    try {
      await spec.drive(ctx, action);
      return {ok: !action.skipped, atomic_trace: trace, observations: []};
    } catch(err: any) {
      return {ok: false, atomic_trace: trace, observations: [], error: err?.message ?? String(err)};
    }
  }
};

export const profileIntents: Record<string, IntentDef<any>> = {
  edit_profile_field: edit_profile_field as IntentDef<any>
};
