import type {IntentDef} from './types';
import {messagingIntents} from './messaging';
import {navigationIntents} from './navigation';
import {profileIntents} from './profile';

export const registry: Record<string, IntentDef<any>> = {
  ...messagingIntents,
  ...navigationIntents,
  ...profileIntents
};
