// @ts-nocheck
import {readFileSync, existsSync} from 'fs';
import {join} from 'path';
import type {Action} from './types';

const ARTIFACTS_ROOT = 'docs/fuzz-reports';

export async function replayFinding(findId: string): Promise<Action[]> {
  const cleaned = findId.startsWith('FIND-') ? findId : `FIND-${findId}`;
  const path = join(ARTIFACTS_ROOT, cleaned, 'trace.json');
  if(!existsSync(path)) {
    throw new Error(`No trace.json for ${cleaned} at ${path}`);
  }
  return replayFile(path);
}

export async function replayFile(path: string): Promise<Action[]> {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  const commands = Array.isArray(parsed) ? parsed : parsed.commands;
  if(!Array.isArray(commands)) throw new Error(`Trace file does not contain a commands array: ${path}`);
  return commands;
}

export async function replayBaseline(): Promise<Action[]> {
  const path = 'docs/fuzz-baseline/baseline-seed42.json';
  if(!existsSync(path)) {
    throw new Error(`No baseline at ${path}. Run with --emit-baseline first.`);
  }
  return replayFile(path);
}
