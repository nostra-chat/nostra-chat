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
  /** Launch visible browsers instead of headless. Overrides E2E_HEADED env. */
  headed?: boolean;
  /** Slow down Playwright actions by N ms (useful with headed). Overrides E2E_SLOWMO env. */
  slowMo?: number;
}

const log = (m: string) => console.log(`[harness] ${m}`);

export async function bootHarness(opts: HarnessOptions = {}): Promise<{
  browser: Browser;
  relay: LocalRelay;
  ctx: FuzzContext;
  teardown: () => Promise<void>;
}> {
  const t0 = Date.now();
  log('boot: LocalRelay + 2 contexts + onboarding');
  const relay = new LocalRelay();
  await relay.start();
  const launch = {
    ...launchOptions,
    ...(opts.headed !== undefined && {headless: !opts.headed}),
    ...(opts.slowMo ? {slowMo: opts.slowMo} : {})
  };
  const browser = await chromium.launch(launch);

  const userA = await createUser(browser, 'userA', 'Alice-Fuzz', relay.url, opts);
  const userB = await createUser(browser, 'userB', 'Bob-Fuzz', relay.url, opts);

  await linkContacts(userA, userB);
  await warmupHandshake(userA, userB);
  log(`boot done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

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

  // Blossom mock: intercept PUT/POST to upload/media endpoints, hash body,
  // stash bytes under window.__fuzzBlossomUploads, and return a fake
  // `https://blossom.fuzz/<sha>.png` URL. Profile actions use this so
  // real Blossom servers are never hit.
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    (window as any).__fuzzBlossomUploads = new Map<string, Uint8Array>();
    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
      const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
      if(url && /^https?:\/\/[^/]+\/(upload|media)(\/|\?|$)/.test(url) && (method === 'PUT' || method === 'POST')) {
        const bodyAny = init?.body as any;
        let body: Uint8Array;
        try{
          if(bodyAny instanceof Uint8Array) body = bodyAny;
          else if(typeof Blob !== 'undefined' && bodyAny instanceof Blob) body = new Uint8Array(await bodyAny.arrayBuffer());
          else if(bodyAny instanceof ArrayBuffer) body = new Uint8Array(bodyAny);
          else if(typeof bodyAny === 'string') body = new TextEncoder().encode(bodyAny);
          else body = new Uint8Array();
        } catch{
          body = new Uint8Array();
        }
        const hash = await crypto.subtle.digest('SHA-256', body);
        const sha = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
        (window as any).__fuzzBlossomUploads.set(sha, body);
        return new Response(JSON.stringify({
          url: `https://blossom.fuzz/${sha}.png`,
          sha256: sha,
          size: body.byteLength,
          uploaded: Math.floor(Date.now() / 1000)
        }), {status: 200, headers: {'content-type': 'application/json'}});
      }
      return originalFetch(input as any, init);
    } as typeof window.fetch;
  });

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
  log(`${id} onboarded (${npub.slice(0, 14)}…)`);

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
  a.remotePeerId = await injectContact(a, b);
  b.remotePeerId = await injectContact(b, a);
}

async function injectContact(self: UserHandle, other: UserHandle): Promise<number> {
  // Delegate to the canonical addP2PContact helper. It handles pubkey decoding,
  // peerId derivation (SHA-256 → VIRTUAL_PEER_BASE + % VIRTUAL_PEER_RANGE),
  // virtualPeersDB storeMapping, appUsersManager.injectP2PUser, mirror sync,
  // ChatAPI.connect, and dialog dispatch in one fully-consistent pass. This is
  // the same path the UI's Add Contact flow uses.
  return self.page.evaluate(async ({otherNpub, otherName}) => {
    const {addP2PContact} = await import('/src/lib/nostra/add-p2p-contact.ts');
    const result = await addP2PContact({
      pubkey: otherNpub,
      nickname: otherName,
      source: 'fuzzer-harness'
    });
    return result.peerId;
  }, {otherNpub: other.npub, otherName: other.displayName});
}

/**
 * Deterministic multi-kind warmup handshake. Exercises kinds 1059 (text),
 * 7 (reaction), and 5 (delete) bidirectionally via the real UI/manager paths
 * and awaits DOM confirmation at each step, so the first fuzz action no longer
 * races a not-yet-warm relay subscription.
 *
 * Closes FIND-cold-deleteWhileSending, FIND-cold-reactPeerSeesEmoji.
 */
async function warmupHandshake(a: UserHandle, b: UserHandle): Promise<void> {
  log('warmup: A→B text → B→A react → A→B delete → drain');
  const warmupText = `__warmup_${Date.now()}__`;

  await sendTextViaUI(a, warmupText);
  const mid = await waitForBubbleOnPeer(b, warmupText, 15000);
  log('warmup: step 1 (text) ack');

  await reactToBubbleViaManager(b, mid, '👍');
  await waitForReactionOnPeer(a, warmupText, '👍', 15000);
  log('warmup: step 2 (react) ack');

  await deleteBubbleViaManager(a, warmupText);
  await waitForBubbleAbsenceOnPeer(b, warmupText, 15000);
  log('warmup: step 3 (delete) ack');

  await a.page.waitForTimeout(500);
  log('warmup: drain complete');
}

async function sendTextViaUI(self: UserHandle, text: string): Promise<void> {
  // Open the chat to the remote peer using the same setPeer path actions use.
  await self.page.evaluate((peerId: number) => {
    (window as any).appImManager?.setPeer?.({peerId});
  }, self.remotePeerId);
  await self.page.waitForTimeout(500);

  // Selectors match actions/messaging.ts sendText exactly.
  const input = self.page.locator('.chat-input [contenteditable="true"]').first();
  await input.waitFor({state: 'visible', timeout: 10000});
  await input.focus();
  await self.page.keyboard.press('Control+A');
  await self.page.keyboard.press('Backspace');
  // insertText preserves surrogate pairs — see FIND-3c99f5a3.
  await self.page.keyboard.insertText(text);
  const sendBtn = self.page.locator('.chat-input button.btn-send').first();
  await sendBtn.click();
}

async function reactToBubbleViaManager(
  self: UserHandle,
  mid: string,
  emoji: string
): Promise<void> {
  // Ensure the peer chat is open so sendReaction can resolve peerId.
  await self.page.evaluate((peerId: number) => {
    (window as any).appImManager?.setPeer?.({peerId});
  }, self.remotePeerId);
  await self.page.waitForTimeout(300);

  const ok = await self.page.evaluate(async ({targetMid, em}: any) => {
    const rs = (window as any).rootScope;
    const peerId = (window as any).appImManager?.chat?.peerId;
    const mgr = rs?.managers?.appReactionsManager;
    if(!mgr?.sendReaction || !peerId) return false;
    try {
      await mgr.sendReaction({
        message: {peerId, mid: Number(targetMid)},
        reaction: {_: 'reactionEmoji', emoticon: em}
      });
      return true;
    } catch { return false; }
  }, {targetMid: mid, em: emoji});
  if(!ok) throw new Error(`warmup: reactToBubbleViaManager failed on mid=${mid}`);
}

async function deleteBubbleViaManager(self: UserHandle, bubbleText: string): Promise<void> {
  const mid = await self.page.evaluate((needle: string) => {
    const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
    for(const b of bubbles) {
      if((b.textContent || '').includes(needle)) return (b as HTMLElement).dataset.mid || null;
    }
    return null;
  }, bubbleText);
  if(!mid) throw new Error(`warmup: deleteBubbleViaManager could not find bubble "${bubbleText}"`);

  const done = await self.page.evaluate(async (targetMid: string) => {
    const rs = (window as any).rootScope;
    const peerId = (window as any).appImManager?.chat?.peerId;
    if(!rs?.managers?.appMessagesManager || !peerId) return false;
    try {
      await rs.managers.appMessagesManager.deleteMessages(peerId, [Number(targetMid)], true);
      return true;
    } catch { return false; }
  }, mid);
  if(!done) throw new Error(`warmup: deleteMessages failed on mid=${mid}`);
}

async function waitForBubbleOnPeer(
  peer: UserHandle,
  text: string,
  timeoutMs: number
): Promise<string> {
  // Ensure peer has the chat open so bubbles render.
  await peer.page.evaluate((peerId: number) => {
    (window as any).appImManager?.setPeer?.({peerId});
  }, peer.remotePeerId);

  const start = Date.now();
  while(Date.now() - start < timeoutMs) {
    const mid = await peer.page.evaluate((needle: string) => {
      const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
      for(const b of bubbles) {
        if((b.textContent || '').includes(needle)) {
          const el = b as HTMLElement;
          if(el.classList.contains('is-sending') || el.classList.contains('is-outgoing')) continue;
          return el.dataset.mid || null;
        }
      }
      return null;
    }, text);
    if(mid) return mid;
    await peer.page.waitForTimeout(250);
  }
  throw new Error(`warmup: bubble "${text}" never appeared on peer within ${timeoutMs}ms`);
}

async function waitForBubbleAbsenceOnPeer(
  peer: UserHandle,
  text: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while(Date.now() - start < timeoutMs) {
    const present = await peer.page.evaluate((needle: string) => {
      const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
      return bubbles.some((b) => (b.textContent || '').includes(needle));
    }, text);
    if(!present) return;
    await peer.page.waitForTimeout(250);
  }
  throw new Error(`warmup: bubble "${text}" still visible on peer after ${timeoutMs}ms`);
}

async function waitForReactionOnPeer(
  peer: UserHandle,
  bubbleText: string,
  emoji: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while(Date.now() - start < timeoutMs) {
    const seen = await peer.page.evaluate(({needle, em}: {needle: string; em: string}) => {
      const bubbles = Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'));
      for(const b of bubbles) {
        if(!(b.textContent || '').includes(needle)) continue;
        const rt = b.querySelector('.reactions');
        if(rt && (rt.textContent || '').includes(em)) return true;
      }
      return false;
    }, {needle: bubbleText, em: emoji});
    if(seen) return;
    await peer.page.waitForTimeout(250);
  }
  throw new Error(`warmup: reaction ${emoji} never appeared on peer bubble "${bubbleText}" within ${timeoutMs}ms`);
}
