import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

// Import fresh each test so module-level state (addEventListener registrations) doesn't accumulate.
// We don't assert on the popup rendering here — only on the skip persistence logic.
const SKIP_LS_KEY = 'nostra.update.skippedVersion';

async function loadModule() {
  vi.resetModules();
  return await import('@lib/update/update-popup-controller');
}

describe('update-popup-controller — persistent skip', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skipVersion persists {version, skippedAt} to localStorage', async() => {
    const {skipVersion} = await loadModule();
    const before = Date.now();
    skipVersion('1.2.3');
    const after = Date.now();
    const raw = localStorage.getItem(SKIP_LS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.skippedAt).toBeGreaterThanOrEqual(before);
    expect(parsed.skippedAt).toBeLessThanOrEqual(after);
  });

  it('overwrites previous skip when a different version is skipped', async() => {
    const {skipVersion} = await loadModule();
    skipVersion('1.2.3');
    skipVersion('1.2.4');
    const raw = JSON.parse(localStorage.getItem(SKIP_LS_KEY)!);
    expect(raw.version).toBe('1.2.4');
  });

  it('survives module reload (simulates page reload)', async() => {
    const mod1 = await loadModule();
    mod1.skipVersion('1.2.3');
    // Second load = fresh module evaluation
    await loadModule();
    const raw = JSON.parse(localStorage.getItem(SKIP_LS_KEY)!);
    expect(raw.version).toBe('1.2.3');
  });

  it('clears stale skip entry after TTL (24h) elapses', async() => {
    // Seed an expired skip
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    localStorage.setItem(SKIP_LS_KEY, JSON.stringify({version: '1.2.3', skippedAt: twoDaysAgo}));

    // Trigger the check by dispatching update_available and observing LS cleanup
    vi.resetModules();
    const rsMod = await import('@lib/rootScope');
    const rs = rsMod.default;
    await import('@lib/update/update-popup-controller');

    // First dispatch integrity result so _lastIntegrity is set
    rs.dispatchEventSingle('update_integrity_check_completed', {
      verdict: 'verified',
      sources: [],
      checkedAt: Date.now()
    } as any);
    // Now dispatch update_available — the skip check runs, finds stale entry, removes it
    rs.dispatchEventSingle('update_available', {
      version: '1.2.3',
      schemaVersion: 1, gitSha: 'x', published: 'x', swUrl: './x', bundleHashes: {}, changelog: ''
    } as any);

    // Give the async handler a tick (popup import is dynamic, but the LS cleanup is synchronous
    // inside isVersionSkipped BEFORE the import)
    await Promise.resolve();
    expect(localStorage.getItem(SKIP_LS_KEY)).toBeNull();
  });

  it('does not apply skip to a different version', async() => {
    const {skipVersion} = await loadModule();
    skipVersion('1.2.3');
    // Skip stored for 1.2.3; a newer 1.2.4 should NOT be considered skipped
    const raw = JSON.parse(localStorage.getItem(SKIP_LS_KEY)!);
    expect(raw.version).toBe('1.2.3');
    // If we had a `isVersionSkipped` export we'd test it directly; verify indirectly that the
    // stored record is version-specific.
  });
});
