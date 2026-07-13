import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const suite = process.argv[2];
if(!suite || !/^[a-z0-9-]+$/i.test(suite)) {
  console.error('Usage: node scripts/run-vitest-files.mjs <suite-directory>');
  process.exit(1);
}

const testDir = resolve(root, 'src/tests', suite);
const nostraExcluded = new Set([
  'e2e-chat.test.ts',
  'e2e-fallback.test.ts',
  'e2e-kind0-profile.test.ts',
  'e2e-onboarding-integration.test.ts',
  'e2e-tor-messaging.test.ts',
  'e2e-tor-wasm.test.ts',
  'e2e-ui-flow.test.ts',
  'i2p.test.ts'
]);
const suiteExcluded = new Map([
  ['nostra', nostraExcluded],
  ['explorer', new Set(['capture.test.ts', 'driver-intent.test.ts'])]
]);
const files = readdirSync(testDir)
.filter((name) => name.endsWith('.test.ts') || name.endsWith('.test.tsx'))
.filter((name) => !suiteExcluded.get(suite)?.has(name))
.sort();

if(files.length === 0) {
  console.error(`No ${suite} test files found`);
  process.exit(1);
}

console.log(`Running ${files.length} ${suite} test files in isolated processes`);

for(const [index, name] of files.entries()) {
  const relativePath = `src/tests/${suite}/${name}`;
  console.log(`\n[${index + 1}/${files.length}] ${relativePath}`);

  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', relativePath],
    {
      cwd: root,
      env: {...process.env, NOSTRA_SUITE_MAIN: ''},
      stdio: 'inherit'
    }
  );

  if(result.error) {
    console.error(`Failed to start ${relativePath}:`, result.error);
    process.exit(1);
  }

  if(result.status !== 0) {
    console.error(`${suite} test failed: ${relativePath}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${files.length} ${suite} test files passed`);
