// @ts-nocheck
/**
 * E2E: Two-device folder sync via local strfry.
 *
 * Steps:
 *   1. Boot device A (fresh identity), verify 3 default folders (All/Persons/Groups)
 *   2. Create custom folder "Lavoro" on device A and wait for relay publish
 *   3. Boot device B with A's identity (localStorage inject), verify "Lavoro" synced
 *   4. Verify protection guard rejects deletion of FOLDER_ID_PERSONS on device B
 *
 * Run: npx tsx src/tests/e2e/e2e-default-folders-sync.ts
 *
 * Prerequisites:
 *   - Dev server running at http://localhost:8080 (pnpm start)
 *   - Docker installed (for local strfry relay)
 */

import {chromium} from 'playwright';
import {LocalRelay} from './helpers/local-relay';
import {launchOptions} from './helpers/launch-options';

const APP_URL = process.env.APP_URL || 'http://localhost:8080';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function bootstrapContext(browser: any, relay: LocalRelay, label: string, initScript?: string) {
  const ctx = await browser.newContext();
  await relay.injectInto(ctx);
  if(initScript) {
    await ctx.addInitScript(initScript);
  }
  const page = await ctx.newPage();
  page.on('console', (msg: any) => {
    const t = msg.text();
    if(/\[ChatAPI\]|\[FoldersSync\]|\[NostraOnboarding|\[NostraSync\]/.test(t)) {
      console.log(`[${label}]`, t);
    }
  });
  return {ctx, page};
}

async function loadApp(page: any, label: string) {
  // Vite HMR fails on first headless load — reload pattern required (see CLAUDE.md)
  await page.goto(APP_URL, {waitUntil: 'load'});
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    document.querySelector('vite-plugin-checker-error-overlay')?.remove();
  });
  await page.reload({waitUntil: 'load'});
  await page.waitForTimeout(15000);
  console.log(`[${label}] app loaded`);
}

async function getFiltersStorage(page: any): Promise<any[] | null> {
  return page.evaluate(() => {
    const fs = (window as any).MOUNT_CLASS_TO?.rootScope?.managers?.filtersStorage;
    if(!fs) return null;
    const filters = fs.getFilters ? fs.getFilters() : fs.filters;
    if(!filters) return null;
    const arr = Array.isArray(filters) ? filters : Object.values(filters);
    return arr.map((f: any) => ({
      id: f.id,
      title: f.title?.text ?? (typeof f.title === 'string' ? f.title : '')
    }));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const relay = new LocalRelay();
  console.log('\n=== E2E: Two-Device Folder Sync ===\n');

  await relay.start();
  console.log('[relay] strfry started at', relay.url);

  const browser = await chromium.launch(launchOptions);

  try {
    // ========================================================================
    // Device A: fresh onboarding
    // ========================================================================
    console.log('\n--- Device A: boot + onboard ---');
    const {ctx: aCtx, page: aPage} = await bootstrapContext(browser, relay, 'A');
    await loadApp(aPage, 'A');

    // Skip onboarding "Get Started" if present (may hang on relay publish)
    try {
      await aPage.getByText('SKIP').click({timeout: 3000});
      console.log('[A] clicked SKIP');
    } catch {
      console.log('[A] no SKIP button (already onboarded or different flow)');
    }
    await aPage.waitForTimeout(4000);

    // Verify 3 default folders
    const foldersA = await getFiltersStorage(aPage);
    console.log('[A] folders:', foldersA);
    if(!foldersA) throw new Error('A: filtersStorage not available via MOUNT_CLASS_TO');
    const idsA = foldersA.map((f: any) => f.id);
    if(!idsA.includes(0)) throw new Error(`A: missing FOLDER_ID_ALL (0) — got ids: ${idsA}`);
    if(!idsA.includes(2)) throw new Error(`A: missing FOLDER_ID_PERSONS (2) — got ids: ${idsA}`);
    if(!idsA.includes(3)) throw new Error(`A: missing FOLDER_ID_GROUPS (3) — got ids: ${idsA}`);
    console.log('[A] ✓ 3 default folders present (All=0, Persons=2, Groups=3)');

    // Export identity before creating folder (so B gets same pubkey)
    const identityA = await aPage.evaluate(() => localStorage.getItem('nostra_identity'));
    if(!identityA) throw new Error('A: no nostra_identity in localStorage');
    console.log('[A] ✓ identity exported');

    // Create custom folder "Lavoro"
    const createResult = await aPage.evaluate(() => {
      const fs = (window as any).MOUNT_CLASS_TO?.rootScope?.managers?.filtersStorage;
      if(!fs) return 'NO_FILTERS_STORAGE';
      const filter = {
        _: 'dialogFilter',
        pFlags: {},
        id: 0, // server assigns real id
        title: {_: 'textWithEntities', text: 'Lavoro', entities: []},
        exclude_peers: [],
        include_peers: [],
        pinned_peers: [],
        excludePeerIds: [],
        includePeerIds: [],
        pinnedPeerIds: []
      };
      const result = fs.createDialogFilter ? fs.createDialogFilter(filter) : fs.updateDialogFilter?.(filter, false);
      return result instanceof Promise ? result.then(() => 'OK').catch((e: any) => 'ERR:' + e.message) : 'SYNC_OK';
    });
    console.log('[A] createDialogFilter result:', createResult);

    // Wait past 2s debounce for FoldersSync to publish to relay
    await aPage.waitForTimeout(6000);
    console.log('[A] ✓ Lavoro created, waiting for relay publish');

    // Double-check Lavoro is in A's local state
    const foldersAAfter = await getFiltersStorage(aPage);
    console.log('[A] folders after create:', foldersAAfter);
    if(!foldersAAfter?.some((f: any) => f.title === 'Lavoro')) {
      console.warn('[A] WARNING: Lavoro not visible locally yet (may be async)');
    }

    // ========================================================================
    // Device B: boot with A's identity
    // ========================================================================
    console.log('\n--- Device B: boot with A identity ---');
    const identityJSON = JSON.stringify(identityA);
    const bInitScript = `localStorage.setItem('nostra_identity', ${identityJSON});`;
    const {ctx: bCtx, page: bPage} = await bootstrapContext(browser, relay, 'B', bInitScript);
    await loadApp(bPage, 'B');

    // Skip onboarding if shown
    try {
      await bPage.getByText('SKIP').click({timeout: 3000});
      console.log('[B] clicked SKIP');
    } catch {
      console.log('[B] no SKIP (already past onboarding)');
    }
    // Extra wait for FoldersSync to fetch and apply relay state
    await bPage.waitForTimeout(8000);

    const foldersB = await getFiltersStorage(bPage);
    console.log('[B] folders:', foldersB);
    if(!foldersB) throw new Error('B: filtersStorage not available via MOUNT_CLASS_TO');

    if(!foldersB.some((f: any) => f.title === 'Lavoro')) {
      throw new Error(`B: "Lavoro" not synced from A — folders: ${JSON.stringify(foldersB)}`);
    }
    console.log('[B] ✓ "Lavoro" synced from device A');

    // ========================================================================
    // Protection guard: attempt to delete FOLDER_ID_PERSONS on B
    // ========================================================================
    console.log('\n--- Protection guard test ---');
    const deletePersonsResult = await bPage.evaluate(async() => {
      const fs = (window as any).MOUNT_CLASS_TO?.rootScope?.managers?.filtersStorage;
      if(!fs) return 'NO_FILTERS_STORAGE';
      // updateDialogFilter(filter, remove=true) should be rejected for protected folders
      const filter = {
        _: 'dialogFilter',
        id: 2,
        pFlags: {},
        title: {_: 'textWithEntities', text: '', entities: []},
        exclude_peers: [],
        include_peers: [],
        pinned_peers: [],
        excludePeerIds: [],
        includePeerIds: [],
        pinnedPeerIds: []
      };
      try {
        await (fs.updateDialogFilter ? fs.updateDialogFilter(filter, true) : Promise.reject(new Error('method_missing')));
        return 'RESOLVED';
      } catch(err: any) {
        return 'REJECTED:' + (err?.type ?? err?.message ?? String(err));
      }
    });
    console.log('[B] protected delete result:', deletePersonsResult);
    if(deletePersonsResult === 'RESOLVED') {
      throw new Error('B: protection guard did NOT reject deletion of FOLDER_ID_PERSONS');
    }
    console.log('[B] ✓ protection guard correctly rejected Persons folder deletion');

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n=== E2E ✓ All assertions passed ===\n');
    process.exit(0);
  } catch(err) {
    console.error('\n=== E2E ✗ FAILED ===');
    console.error(err);
    process.exit(1);
  } finally {
    await browser.close();
    await relay.stop();
    console.log('[relay] strfry stopped');
  }
}

run();
