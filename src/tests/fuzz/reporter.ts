// @ts-nocheck
import {createHash} from 'crypto';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';
import {join, dirname} from 'path';
import lockfile from 'proper-lockfile';
import type {ReportEntry, FailureDetails, Action, FuzzContext} from './types';

const FINDINGS_PATH = 'docs/FUZZ-FINDINGS.md';
const ARTIFACTS_ROOT = 'docs/fuzz-reports';

export function computeSignature(input: {invariantId: string; message: string; stackTopFrame?: string}): string {
  const h = createHash('sha256');
  h.update(input.invariantId);
  h.update('\0');
  h.update(input.message.slice(0, 200));
  h.update('\0');
  h.update(input.stackTopFrame || '');
  return h.digest('hex').slice(0, 8);
}

export function renderFindingsMarkdown(entries: ReportEntry[]): string {
  const open = entries.filter((e) => e.status === 'open').sort((a, b) => b.occurrences - a.occurrences);
  const fixed = entries.filter((e) => e.status === 'fixed');
  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const lines: string[] = [];
  lines.push('# Fuzz Findings');
  lines.push('');
  lines.push(`Last updated: ${nowIso}`);
  lines.push(`Open bugs: ${open.length} · Fixed: ${fixed.length}`);
  lines.push('');
  lines.push('## Open (sorted by occurrences desc)');
  lines.push('');
  for(const e of open) lines.push(...renderEntry(e));
  if(fixed.length > 0) {
    lines.push('## Fixed');
    lines.push('');
    for(const e of fixed) lines.push(...renderEntry(e));
  }
  return lines.join('\n') + '\n';
}

function renderEntry(e: ReportEntry): string[] {
  const lines: string[] = [];
  lines.push(`### FIND-${e.signature} — ${e.invariantId}`);
  lines.push(`- **Status**: ${e.status}${e.fixedCommit ? ` (commit ${e.fixedCommit})` : ''}`);
  lines.push(`- **Tier**: ${e.tier}`);
  lines.push(`- **Occurrences**: ${e.occurrences}`);
  lines.push(`- **First seen**: ${e.firstSeen}`);
  lines.push(`- **Last seen**: ${e.lastSeen}`);
  lines.push(`- **Seed**: ${e.seed}`);
  lines.push(`- **Assertion**: ${JSON.stringify(e.assertion)}`);
  lines.push(`- **Replay**: \`pnpm fuzz --replay=FIND-${e.signature}\``);
  lines.push(`- **Minimal trace** (${e.minimalTrace.length} actions):`);
  e.minimalTrace.forEach((a, i) => lines.push(`  ${i + 1}. \`${a.name}(${JSON.stringify(a.args)})\``));
  lines.push(`- **Artifacts**: [\`docs/fuzz-reports/FIND-${e.signature}/\`](../fuzz-reports/FIND-${e.signature}/)`);
  lines.push('');
  return lines;
}

const ENTRY_HEADER_RE = /^### FIND-([0-9a-f]{8}) — (.+)$/;

export function parseFindingsMarkdown(md: string): ReportEntry[] {
  const entries: ReportEntry[] = [];
  const lines = md.split('\n');
  let current: Partial<ReportEntry> | null = null;
  const traces: string[] = [];
  for(const line of lines) {
    const m = ENTRY_HEADER_RE.exec(line);
    if(m) {
      if(current && current.signature) {
        current.minimalTrace = parseTrace(traces);
        entries.push(current as ReportEntry);
      }
      current = {signature: m[1], invariantId: m[2], minimalTrace: [], status: 'open', occurrences: 0};
      traces.length = 0;
      continue;
    }
    if(!current) continue;
    if(line.startsWith('- **Status**:')) {
      current.status = line.includes('fixed') ? 'fixed' : 'open';
    } else if(line.startsWith('- **Tier**:')) {
      current.tier = line.split(':')[1].trim() as any;
    } else if(line.startsWith('- **Occurrences**:')) {
      current.occurrences = Number(line.split(':')[1].trim());
    } else if(line.startsWith('- **First seen**:')) {
      current.firstSeen = line.replace('- **First seen**:', '').trim();
    } else if(line.startsWith('- **Last seen**:')) {
      current.lastSeen = line.replace('- **Last seen**:', '').trim();
    } else if(line.startsWith('- **Seed**:')) {
      current.seed = Number(line.split(':')[1].trim());
    } else if(line.startsWith('- **Assertion**:')) {
      current.assertion = JSON.parse(line.replace('- **Assertion**:', '').trim());
    } else if(/^\s+\d+\. /.test(line)) {
      traces.push(line);
    }
  }
  if(current && current.signature) {
    current.minimalTrace = parseTrace(traces);
    entries.push(current as ReportEntry);
  }
  return entries;
}

function parseTrace(lines: string[]): Action[] {
  const out: Action[] = [];
  for(const l of lines) {
    const m = /^\s+\d+\. `([^(]+)\((.+)\)`\s*$/.exec(l);
    if(!m) continue;
    try{ out.push({name: m[1], args: JSON.parse(m[2])}); } catch{}
  }
  return out;
}

export async function recordFinding(
  f: FailureDetails,
  minimalTrace: Action[],
  seed: number,
  ctx?: FuzzContext
): Promise<{signature: string; isNew: boolean}> {
  const signature = computeSignature({
    invariantId: f.invariantId,
    message: f.message,
    stackTopFrame: f.stackTopFrame
  });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  mkdirSync(dirname(FINDINGS_PATH), {recursive: true});
  if(!existsSync(FINDINGS_PATH)) writeFileSync(FINDINGS_PATH, '# Fuzz Findings\n\n## Open\n\n', 'utf8');

  const release = await lockfile.lock(FINDINGS_PATH, {retries: 5, stale: 10_000});
  try{
    const md = readFileSync(FINDINGS_PATH, 'utf8');
    const entries = parseFindingsMarkdown(md);
    const existing = entries.find((e) => e.signature === signature);
    let isNew = false;
    if(existing) {
      existing.occurrences += 1;
      existing.lastSeen = now;
    } else {
      isNew = true;
      entries.push({
        signature,
        invariantId: f.invariantId,
        tier: f.tier,
        assertion: f.message,
        occurrences: 1,
        firstSeen: now,
        lastSeen: now,
        seed,
        minimalTrace,
        status: 'open'
      });
    }
    writeFileSync(FINDINGS_PATH, renderFindingsMarkdown(entries), 'utf8');
    if(isNew && ctx) await writeArtifacts(signature, f, minimalTrace, seed, ctx);
    return {signature, isNew};
  } finally {
    await release();
  }
}

async function writeArtifacts(
  sig: string,
  f: FailureDetails,
  trace: Action[],
  seed: number,
  ctx: FuzzContext
): Promise<void> {
  const dir = join(ARTIFACTS_ROOT, `FIND-${sig}`);
  mkdirSync(dir, {recursive: true});
  try{
    await ctx.users.userA.page.screenshot({path: join(dir, 'screenshot-A.png'), fullPage: true});
    await ctx.users.userB.page.screenshot({path: join(dir, 'screenshot-B.png'), fullPage: true});
  } catch{}
  try{
    const domA = await ctx.users.userA.page.evaluate(() => document.documentElement.outerHTML);
    const domB = await ctx.users.userB.page.evaluate(() => document.documentElement.outerHTML);
    writeFileSync(join(dir, 'dom-A.html'), domA, 'utf8');
    writeFileSync(join(dir, 'dom-B.html'), domB, 'utf8');
  } catch{}
  writeFileSync(join(dir, 'console.log'),
    `## userA\n${ctx.users.userA.consoleLog.join('\n')}\n\n## userB\n${ctx.users.userB.consoleLog.join('\n')}`,
    'utf8'
  );
  writeFileSync(join(dir, 'trace.json'), JSON.stringify({seed, backend: 'local', commands: trace}, null, 2), 'utf8');
  writeFileSync(join(dir, 'failure.json'), JSON.stringify(f, null, 2), 'utf8');
}
