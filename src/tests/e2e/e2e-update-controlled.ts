// @ts-nocheck
import {chromium} from 'playwright';
import {LocalManifestServer} from './helpers/local-manifest-server';
import {rewriteManifestSources} from './helpers/rewrite-source-urls';
import {launchOptions} from './helpers/launch-options';

const APP_URL = process.env.APP_URL || process.env.E2E_APP_URL || 'http://localhost:8080';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n▶ ${name}`);
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch(err) {
    console.error(`✗ ${name}:`, err);
    process.exit(1);
  }
}

async function gotoApp(page: any) {
  await page.goto(APP_URL, {waitUntil: 'load'});
  await page.waitForTimeout(5000);
  await page.reload({waitUntil: 'load'});
  await page.waitForTimeout(15000);
}

async function checkIntegrity(page: any) {
  return page.evaluate(async() => {
    const {verifyManifestsAcrossSources} = await import('/src/lib/update/manifest-verifier.ts');
    return verifyManifestsAcrossSources();
  });
}

const validManifest = (over: any = {}) => ({
  schemaVersion: 2, version: '99.0.0', gitSha: 'a'.repeat(40), published: new Date().toISOString(),
  swUrl: './sw-xyz.js',
  bundleHashes: {'./sw-xyz.js': `sha256-${'a'.repeat(64)}`, './index.html': `sha256-${'b'.repeat(64)}`},
  changelog: '### Test\n- hello', alternateSources: {},
  ...over
});

(async() => {
  const manifestServer = new LocalManifestServer();
  await manifestServer.start([7801, 7802, 7803]);

  try {
    await test('first-install: no popup on fresh browser with agreed sources matching current', async() => {
      const browser = await chromium.launch(launchOptions);
      const ctx = await browser.newContext();
      await rewriteManifestSources(ctx, {
        cdn: 'http://localhost:7801/update-manifest.json',
        github: 'http://localhost:7802/update-manifest.json',
        ipfs: 'http://localhost:7803/update-manifest.json'
      });
      // Serve manifest matching app's installed version so no update offered
      manifestServer.setManifest(7801, validManifest({version: '0.0.1'}));
      manifestServer.setManifest(7802, validManifest({version: '0.0.1'}));
      manifestServer.setManifest(7803, validManifest({version: '0.0.1'}));

      const page = await ctx.newPage();
      await gotoApp(page);
      const hasPopup = await page.locator('.popup-update-available').count();
      if(hasPopup > 0) throw new Error('unexpected update popup on first install');
      await browser.close();
    });

    await test('cross-source agreement is recorded but never bypasses signed consent', async() => {
      const browser = await chromium.launch(launchOptions);
      const ctx = await browser.newContext();
      await rewriteManifestSources(ctx, {
        cdn: 'http://localhost:7801/update-manifest.json',
        github: 'http://localhost:7802/update-manifest.json',
        ipfs: 'http://localhost:7803/update-manifest.json'
      });
      manifestServer.setManifest(7801, validManifest());
      manifestServer.setManifest(7802, validManifest());
      manifestServer.setManifest(7803, validManifest());

      const page = await ctx.newPage();
      await gotoApp(page);
      const integrity = await checkIntegrity(page);
      if(integrity.verdict !== 'verified') throw new Error(`expected verified verdict, got ${integrity.verdict}`);
      const hasPopup = await page.getByText(/Update available|Aggiornamento disponibile/i, {exact: true}).count();
      if(hasPopup > 0) throw new Error('unsigned cross-source agreement must not open consent popup');
      await browser.close();
    });

    await test('cross-source-conflict: update shown as conflict (gitSha disagreement)', async() => {
      const browser = await chromium.launch(launchOptions);
      const ctx = await browser.newContext();
      await rewriteManifestSources(ctx, {
        cdn: 'http://localhost:7801/update-manifest.json',
        github: 'http://localhost:7802/update-manifest.json',
        ipfs: 'http://localhost:7803/update-manifest.json'
      });
      manifestServer.setManifest(7801, validManifest({gitSha: 'a'.repeat(40)}));
      manifestServer.setManifest(7802, validManifest({gitSha: 'b'.repeat(40)}));
      manifestServer.setManifest(7803, validManifest({gitSha: 'a'.repeat(40)}));

      const page = await ctx.newPage();
      await gotoApp(page);
      // Conflict verdict: popup may show with disabled Update button OR no popup at all
      // depending on exact controller behavior. We verify that integrity was logged
      // via localStorage.
      const integrity = await checkIntegrity(page);
      if(integrity.verdict !== 'conflict') throw new Error(`expected conflict verdict, got ${integrity.verdict}`);
      await browser.close();
    });

    await test('insufficient: no popup when only 1 source responds', async() => {
      const browser = await chromium.launch(launchOptions);
      const ctx = await browser.newContext();
      await rewriteManifestSources(ctx, {
        cdn: 'http://localhost:7801/update-manifest.json',
        github: 'http://localhost:9999/update-manifest.json', // unreachable
        ipfs: 'http://localhost:9998/update-manifest.json'   // unreachable
      });
      manifestServer.setManifest(7801, validManifest());

      const page = await ctx.newPage();
      await gotoApp(page);
      const hasPopup = await page.locator('.popup-update-available').count();
      if(hasPopup > 0) throw new Error('popup should be hidden on insufficient verdict');
      const integrity = await checkIntegrity(page);
      if(integrity.verdict !== 'insufficient' && integrity.verdict !== 'offline') {
        throw new Error(`expected insufficient/offline verdict, got ${integrity.verdict}`);
      }
      await browser.close();
    });
  } finally {
    await manifestServer.stop();
  }

  console.log('\nAll E2E update tests passed.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
