// @ts-nocheck
/**
 * WU-5b — DM→group navigation coherence.
 *
 * Bug (carry-forward β from PR #115): with a DM open, navigating into a group
 * via setInnerPeer leaves the topbar showing the DM peer's name (peer_title_edit
 * is only emitted from the group lifecycle, not a plain nav) and renders a stale
 * single-top slice instead of the full group history.
 *
 * Repro: A creates a group + sends 3 messages, opens the DM with B (topbar = B),
 * then navigates DM→group. Assert topbar == group name AND >= 3 group bubbles.
 *
 * Run: `pnpm start` in another terminal, then
 *      node_modules/.bin/tsx src/tests/e2e/e2e-groups-setpeer-coherence.ts
 */
import {bootHarness} from '../fuzz/harness';

const STAMP = Date.now();
const GROUP_NAME = `SetPeerCoherence-${STAMP}`;
const MSGS = [0, 1, 2].map((i) => `coh-${i}-${STAMP}`);

async function topbarTitle(page: any): Promise<string> {
  return page.evaluate(() => (document.querySelector('.chat-info .user-title')?.textContent || '').trim());
}
async function groupBubbleCount(page: any): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.bubbles-inner .bubble[data-mid]'))
    .filter((b: any) => !b.classList.contains('is-system') && !b.classList.contains('is-service')).length);
}
async function setPeer(page: any, peerId: number): Promise<void> {
  await page.evaluate((pid: number) => (window as any).appImManager?.setInnerPeer?.({peerId: pid}), peerId);
}

async function main() {
  console.log('[coh] boot harness');
  const {browser, relay, ctx, teardown} = await bootHarness({consoleBufferMax: 2000});
  let failed = false;
  try {
    const A = ctx.users.userA;
    const B = ctx.users.userB;
    console.log(`[coh] A=${A.pubkeyHex.slice(0, 8)} B=${B.pubkeyHex.slice(0, 8)}`);

    // A creates a group + sends 3 messages.
    const {groupId, groupPeerId} = await A.page.evaluate(async(otherHex: string) => {
      const api = (window as any).__nostraGroupAPI;
      const {getGroupStore} = await import('/src/lib/nostra/group-store.ts');
      const gid = await api.createGroup('SetPeerCoherence', [otherHex]);
      const rec = await getGroupStore().get(gid);
      return {groupId: gid, groupPeerId: rec?.peerId};
    }, B.pubkeyHex);
    if(!groupId || !groupPeerId) throw new Error(`createGroup failed: gid=${groupId} peerId=${groupPeerId}`);
    console.log(`[coh] group gid=${groupId.slice(0, 8)} peerId=${groupPeerId}`);

    for(const m of MSGS) {
      await A.page.evaluate(async({gid, text}: any) => { await (window as any).__nostraGroupAPI.sendMessage(gid, text); }, {gid: groupId, text: m});
      await A.page.waitForTimeout(500);
    }
    console.log('[coh] sent 3 group messages');

    // B's DM peerId (A and B are linked contacts via bootHarness).
    const dmPeerId = await A.page.evaluate(async(hex: string) => {
      const {NostraBridge} = await import('/src/lib/nostra/nostra-bridge.ts');
      return await NostraBridge.getInstance().mapPubkeyToPeerId(hex);
    }, B.pubkeyHex);
    console.log(`[coh] B DM peerId=${dmPeerId}`);

    // 1) Open the DM — topbar should be B's name.
    await setPeer(A.page, dmPeerId);
    await A.page.waitForTimeout(2500);
    const dmTitle = await topbarTitle(A.page);
    console.log(`[coh] DM open, topbar=${JSON.stringify(dmTitle)}`);

    // 2) Navigate DM→group.
    await setPeer(A.page, groupPeerId);
    await A.page.waitForTimeout(3500);
    const grpTitle = await topbarTitle(A.page);
    const grpBubbles = await groupBubbleCount(A.page);
    console.log(`[coh] after DM->group: topbar=${JSON.stringify(grpTitle)} bubbles=${grpBubbles}`);

    const titleOk = /SetPeerCoherence/i.test(grpTitle);
    const renderOk = grpBubbles >= 3;
    console.log(`[coh] TEST TOPBAR (WU5b): ${titleOk ? 'PASS' : 'FAIL'} (topbar="${grpTitle}", was DM="${dmTitle}")`);
    console.log(`[coh] TEST RENDER (WU5b): ${renderOk ? 'PASS' : 'FAIL'} (bubbles=${grpBubbles}, expected>=3)`);
    if(titleOk && renderOk) console.log('[coh] ALL PASS');
    else failed = true;
  } catch(err: any) {
    console.error('[coh] ERROR:', err?.stack || err);
    failed = true;
  } finally {
    await teardown();
    try { await relay.stop(); } catch {}
    try { await browser.close(); } catch {}
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('[coh] FAIL:', e?.stack || e); process.exit(1); });
