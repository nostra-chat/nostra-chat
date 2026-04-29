import {mkdirSync, writeFileSync, copyFileSync, existsSync} from 'node:fs';
import {join, basename} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import type {AtomicAction} from './types';
import type {HardFinding} from './oracles/hard';

export interface TraceStep {
  step: number;
  intent: string;
  params: Record<string, unknown>;
  atomic_trace: AtomicAction[];
}

export interface ReportInput {
  reportRoot: string;
  kind: 'finding' | 'run';
  goal: string;
  trace: TraceStep[];
  finding: HardFinding | null;
  screenshots: {pathOnDisk: string; label: string}[];
}

export async function writeReport(input: ReportInput): Promise<string> {
  let dir: string;
  if(input.kind === 'finding') {
    if(!input.finding) throw new Error('writeReport: kind=finding requires finding');
    const sigInput = `${input.finding.oracle}:${input.finding.page}:${input.finding.hash}`;
    const findId = createHash('sha1').update(sigInput).digest('hex').slice(0, 8);
    dir = join(input.reportRoot, `FIND-${findId}`);
  } else {
    const runId = randomUUID();
    dir = join(input.reportRoot, 'runs', runId);
  }
  mkdirSync(dir, {recursive: true});
  mkdirSync(join(dir, 'screenshots'), {recursive: true});

  writeFileSync(
    join(dir, 'trace.jsonl'),
    input.trace.map((s) => JSON.stringify(s)).join('\n') + '\n',
    'utf8'
  );

  if(input.finding) {
    writeFileSync(
      join(dir, 'signature.txt'),
      `${input.finding.oracle}:${input.finding.page}:${input.finding.hash}\n`,
      'utf8'
    );
  }

  writeFileSync(join(dir, 'report.md'), renderMarkdown(input), 'utf8');

  for(const s of input.screenshots) {
    if(!existsSync(s.pathOnDisk)) continue;
    copyFileSync(s.pathOnDisk, join(dir, 'screenshots', `${s.label}-${basename(s.pathOnDisk)}`));
  }

  return dir;
}

function renderMarkdown(input: ReportInput): string {
  const head = input.kind === 'finding' ?
    `# Finding\n\n**Goal**: ${input.goal}\n**Oracle**: ${input.finding!.oracle}\n**Page**: ${input.finding!.page}\n**Message**: \`${input.finding!.message.slice(0, 200)}\`\n` :
    `# Run\n\n**Goal**: ${input.goal}\n**Status**: completed without findings\n`;
  const traceMd = input.trace.map((s) => `${s.step}. \`${s.intent}\` ${JSON.stringify(s.params)}`).join('\n');
  return `${head}\n## Trace\n\n${traceMd}\n`;
}
