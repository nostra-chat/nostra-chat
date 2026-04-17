// @ts-nocheck
/**
 * Fuzzer harness — spawns LocalRelay, 2 browser contexts, onboards both users,
 * establishes mutual contact. Exposes UserHandle objects the fuzzer drives.
 *
 * Onboarding is deterministic setup, not part of the fuzzed action space.
 */

import {chromium, type Browser} from 'playwright';
import {launchOptions} from '../e2e/helpers/launch-options';
import {LocalRelay} from '../e2e/helpers/local-relay';
import {dismissOverlays} from '../e2e/helpers/dismiss-overlays';
import type {FuzzContext, UserHandle, UserId} from './types';

const APP_URL = process.env.FUZZ_APP_URL || 'http://localhost:8080';
const CONSOLE_BUFFER_MAX = 5000;

export interface HarnessOptions {
  /** How many console lines to retain per user (ring buffer). Default 5000. */
  consoleBufferMax?: number;
}

export async function bootHarness(opts: HarnessOptions = {}): Promise<{
  browser: Browser;
  relay: LocalRelay;
  ctx: FuzzContext;
  teardown: () => Promise<void>;
}> {
  const relay = new LocalRelay();
  await relay.start();

  const browser = await chromium.launch(launchOptions);

  const userA = await createUser(browser, 'userA', 'Alice-Fuzz', relay.url, opts);
  const userB = await createUser(browser, 'userB', 'Bob-Fuzz', relay.url, opts);

  // Exchange pubkeys + inject contacts bidirectionally via API (skip DOM add-contact UI).
  await linkContacts(userA, userB);

  const ctx: FuzzContext = {
    users: {userA, userB},
    relay,
    snapshots: new Map(),
    actionIndex: 0
  };

  const teardown = async () => {
    await userA.context.close().catch(() => {});
    await userB.context.close().catch(() => {});
    await browser.close().catch(() => {});
    await relay.stop().catch(() => {});
  };

  return {browser, relay, ctx, teardown};
}

async function createUser(
  browser: Browser,
  id: UserId,
  displayName: string,
  relayUrl: string,
  opts: HarnessOptions
): Promise<UserHandle> {
  const context = await browser.newContext();
  await context.addInitScript((url) => {
    (window as any).__nostraTestRelays = [{url, read: true, write: true}];
  }, relayUrl);
  const page = await context.newPage();

  const consoleLog: string[] = [];
  const max = opts.consoleBufferMax ?? CONSOLE_BUFFER_MAX;
  page.on('console', (msg) => {
    consoleLog.push(`[${msg.type()}] ${msg.text()}`);
    if(consoleLog.length > max) consoleLog.shift();
  });
  page.on('pageerror', (err) => {
    consoleLog.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
    if(consoleLog.length > max) consoleLog.shift();
  });

  // Standard Vite-HMR-friendly boot sequence from e2e-bug-regression.ts.
  await page.goto(APP_URL, {waitUntil: 'load', timeout: 60000});
  await page.waitForTimeout(5000);
  await page.reload({waitUntil: 'load', timeout: 60000});
  await page.waitForTimeout(15000);
  await dismissOverlays(page);

  await page.getByRole('button', {name: 'Create New Identity'}).waitFor({state: 'visible', timeout: 30000});
  await page.getByRole('button', {name: 'Create New Identity'}).click();
  await page.waitForTimeout(2000);

  const npub = await page.evaluate(() => {
    for(const e of document.querySelectorAll('*')) {
      if(e.children.length === 0 && e.textContent?.includes('npub1')) {
        return e.textContent.trim();
      }
    }
    return '';
  });

  await page.getByRole('button', {name: 'Continue'}).click();
  await page.waitForTimeout(2000);
  const nameInput = page.getByRole('textbox');
  if(await nameInput.isVisible()) {
    await nameInput.fill(displayName);
    await page.getByRole('button', {name: 'Get Started'}).click();
  }
  await page.waitForTimeout(8000);

  const reloadTimes: number[] = [Date.now()];
  page.on('load', () => reloadTimes.push(Date.now()));

  return {
    id,
    context,
    page,
    displayName,
    npub,
    remotePeerId: 0, // set later in linkContacts
    consoleLog,
    reloadTimes
  };
}

async function linkContacts(a: UserHandle, b: UserHandle): Promise<void> {
  // Inject B's identity into A's contact list and vice versa, bypassing the
  // add-contact DOM flow.
  const aSeesB = await injectContact(a, b);
  const bSeesA = await injectContact(b, a);
  a.remotePeerId = aSeesB;
  b.remotePeerId = bSeesA;
}

async function injectContact(self: UserHandle, other: UserHandle): Promise<number> {
  return self.page.evaluate(async ({otherNpub, otherName}) => {
    const rs = (window as any).rootScope;
    const {nip19} = await import('/@fs/' + 'nostr-tools-nip19'); // resolved by Vite
    // Fallback: use built-in util exposed on chatAPI when nip19 import path is fragile.
    const chatAPI = (window as any).__nostraChatAPI;
    const pubkeyHex = chatAPI?.npubToHex
      ? chatAPI.npubToHex(otherNpub)
      : (function decode(s: string) {
        const {data} = (window as any).nostrTools?.nip19?.decode?.(s) ?? {data: s};
        return typeof data === 'string' ? data : Buffer.from(data).toString('hex');
      })(otherNpub);

    const virtualPeersDB = (window as any).__nostraVirtualPeersDB
      || (await import('/src/lib/nostra/virtual-peers-db.ts')).virtualPeersDB;
    const peerId = await virtualPeersDB.storeMapping(pubkeyHex, null, otherName);

    const appUsersManager = rs.managers?.appUsersManager;
    if(appUsersManager?.injectP2PUser) {
      appUsersManager.injectP2PUser({peerId, pubkey: pubkeyHex, firstName: otherName});
    }
    return peerId;
  }, {otherNpub: other.npub, otherName: other.displayName});
}
