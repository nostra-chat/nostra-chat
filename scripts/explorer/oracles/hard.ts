import {CONSOLE_ALLOWLIST} from '../../../src/tests/fuzz/allowlist';
import type {PageId} from '../types';

export type HardOracleKind = 'console_error' | 'unhandled_rejection' | 'network_5xx' | 'white_screen';

export interface HardFinding {
  oracle: HardOracleKind;
  page: PageId;
  message: string;
  hash: string;
}

export interface HardOracleInput {
  pageA: {consoleSinceStart: string[]};
  pageB: {consoleSinceStart: string[]};
}

export function checkHard(input: HardOracleInput): HardFinding[] {
  const findings: HardFinding[] = [];
  for(const [pageId, capture] of [['A', input.pageA], ['B', input.pageB]] as const) {
    for(const line of capture.consoleSinceStart) {
      if(isAllowlisted(line)) continue;
      if(/\[error\]/i.test(line) || /\bUncaught\b/.test(line)) {
        findings.push({oracle: 'console_error', page: pageId, message: line, hash: shortHash(line)});
      }
      if(/\[pageerror\]/i.test(line) || /Unhandled promise rejection/i.test(line)) {
        findings.push({oracle: 'unhandled_rejection', page: pageId, message: line, hash: shortHash(line)});
      }
    }
  }
  return findings;
}

function isAllowlisted(line: string): boolean {
  return CONSOLE_ALLOWLIST.some((re) => re.test(line));
}

function shortHash(s: string): string {
  let h = 0;
  for(let i = 0; i < Math.min(s.length, 200); i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}
