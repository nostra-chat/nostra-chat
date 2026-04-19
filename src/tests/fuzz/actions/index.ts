// @ts-nocheck
import * as fc from 'fast-check';
import type {ActionSpec, Action} from '../types';
import {sendText, replyToRandomBubble, editRandomOwnBubble, deleteRandomOwnBubble, reactToRandomBubble, removeReaction} from './messaging';
import {openRandomChat, scrollHistoryUp, waitForPropagation} from './navigation';

export const ACTION_REGISTRY: ActionSpec[] = [
  sendText,
  replyToRandomBubble,
  editRandomOwnBubble,
  deleteRandomOwnBubble,
  reactToRandomBubble,
  removeReaction,
  openRandomChat,
  scrollHistoryUp,
  waitForPropagation
];

export const ACTIONS_BY_NAME: Record<string, ActionSpec> = Object.fromEntries(
  ACTION_REGISTRY.map((a) => [a.name, a])
);

/** fast-check arbitrary that yields a single Action. */
export const actionArb: fc.Arbitrary<Action> = fc.oneof(
  ...ACTION_REGISTRY.map((spec) => ({
    weight: spec.weight,
    arbitrary: spec.generateArgs().map((args) => ({name: spec.name, args}))
  }))
);

export function findAction(name: string): ActionSpec {
  const a = ACTIONS_BY_NAME[name];
  if(!a) throw new Error(`Unknown action: ${name}`);
  return a;
}
