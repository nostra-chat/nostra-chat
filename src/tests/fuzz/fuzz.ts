// @ts-nocheck
import * as fc from 'fast-check';
import {parseCli, HELP_TEXT} from './cli';
import {bootHarness} from './harness';
import {actionArb, findAction} from './actions';
import {runTier} from './invariants';
import {runPostconditions} from './postconditions';
import {recordFinding} from './reporter';
import {replayFinding, replayFile} from './replay';
import type {Action, FuzzContext, FailureDetails} from './types';

/**
 * Fast-check shrinks by re-running the property with a smaller input until it
 * finds the minimal failing array. Each re-run discards its FuzzContext (fresh
 * harness) but we still need to surface the LAST failure details + the LAST
 * context for artifact capture. We stash them in module-level refs that the
 * property function updates on every failure, and the outer catch reads.
 */
let lastFailure: FailureDetails | null = null;
let lastContext: FuzzContext | null = null;

async function main() {
  const opts = parseCli(process.argv);
  if(opts.help) {console.log(HELP_TEXT); return;}

  if(opts.backend === 'real' || opts.tor || opts.pairs > 1 || opts.smokeOnly) {
    console.error('[fuzz] Phase 3 flags (--backend=real, --tor, --pairs>1, --smoke-only) are not supported in MVP.');
    process.exit(2);
  }

  if(opts.replay || opts.replayFile) {
    const trace = opts.replay
      ? await replayFinding(opts.replay)
      : await replayFile(opts.replayFile!);
    await runReplay(trace);
    return;
  }

  console.log(`[fuzz] seed=${opts.seed} duration=${opts.durationMs}ms maxCommands=${opts.maxCommands}`);
  const deadline = Date.now() + opts.durationMs;
  let iterations = 0;
  let findings = 0;

  while(Date.now() < deadline) {
    iterations++;
    const iterSeed = opts.seed + iterations;
    console.log(`[fuzz] iteration ${iterations} seed=${iterSeed}`);
    lastFailure = null;
    lastContext = null;

    // Sample a deterministic action sequence from the seed. No shrinking: a
    // failing sequence is reported as-is. Phase 3 may add a dedicated --shrink
    // mode that re-runs with fast-check's Property API to minimise a trace.
    const actions = fc.sample(
      fc.array(actionArb, {minLength: 1, maxLength: opts.maxCommands}),
      {seed: iterSeed, numRuns: 1}
    )[0] as Action[];

    try{
      await runSequence(actions);
    } catch(err: any) {
      if(!lastFailure) {
        console.error('[fuzz] iteration errored without invariant failure:', err?.message || err);
        continue;
      }
    }

    if(lastFailure) {
      findings++;
      const {signature, isNew} = await recordFinding(lastFailure, actions, iterSeed, lastContext || undefined);
      console.log(`[fuzz] FIND-${signature} (${lastFailure.invariantId}) ${isNew ? 'NEW' : 'dup'}`);
    }
  }

  console.log(`[fuzz] done. iterations=${iterations} findings=${findings}`);
}

/**
 * Runs ONE command sequence on a fresh harness. Throws on invariant failure to
 * trigger fast-check shrinking; stashes details in module refs first.
 */
async function runSequence(actions: Action[]): Promise<void> {
  const {ctx, teardown} = await bootHarness();
  try{
    for(let i = 0; i < actions.length; i++) {
      ctx.actionIndex = i;
      const spec = findAction(actions[i].name);
      console.log(`[runseq] action ${i + 1}/${actions.length}: ${actions[i].name}(${JSON.stringify(actions[i].args).slice(0, 80)})`);
      const executed = await spec.drive(ctx, actions[i]);
      actions[i] = executed;
      if(executed.skipped) console.log(`[runseq] action ${i + 1}: skipped`);

      const postFail = await runPostconditions(ctx, executed);
      if(postFail) {
        console.log(`[runseq] POST FAIL ${postFail.invariantId}: ${postFail.message.slice(0, 200)}`);
        lastFailure = postFail; lastContext = ctx; throw new Error(postFail.message);
      }

      const cheap = await runTier('cheap', ctx, executed);
      if(cheap) {
        console.log(`[runseq] INV FAIL ${cheap.invariantId}: ${cheap.message.slice(0, 200)}`);
        lastFailure = cheap; lastContext = ctx; throw new Error(cheap.message);
      }
      console.log(`[runseq] action ${i + 1}: OK`);
    }
  } finally {
    // Teardown only AFTER failure details are captured — keep ctx alive for
    // artifact capture on the final (minimal) run, close at the very end.
    if(!lastFailure || lastContext !== ctx) await teardown();
  }
}

async function runReplay(trace: Action[]): Promise<void> {
  console.log(`[fuzz] REPLAY ${trace.length} actions`);
  const {ctx, teardown} = await bootHarness();
  try{
    for(let i = 0; i < trace.length; i++) {
      ctx.actionIndex = i;
      const spec = findAction(trace[i].name);
      const executed = await spec.drive(ctx, trace[i]);
      trace[i] = executed;
      const postFail = await runPostconditions(ctx, executed);
      if(postFail) {console.error('[replay] POSTCONDITION FAIL:', postFail); return;}
      const cheap = await runTier('cheap', ctx, executed);
      if(cheap) {console.error('[replay] INVARIANT FAIL:', cheap); return;}
    }
    console.log('[replay] all steps passed — bug not reproduced');
  } finally {
    await teardown();
  }
}

main().catch((err) => {
  console.error('[fuzz] fatal:', err);
  process.exit(1);
});
