# Ralph Loop v2 — Bug Fixes, Tests, UI Verification

**Generato:** 2026-04-09
**Obiettivo:** rendere Nostra.chat completamente funzionante con tutti i test verdi e la UI verificata via browser.
**Promise tag:** `<promise>ALL_BUGS_FIXED_V2</promise>`

## Context per la sessione

Sei la continuazione di una sessione di debugging su Nostra.chat, un client di messaggistica P2P basato su tweb (Telegram Web) che usa Nostr relay come trasporto. L'app usa una Virtual MTProto layer: i manager tweb girano in un DedicatedWorker ma usano risposte statiche; il codice P2P reale vive nel main thread (`ChatAPI`, `NostraSync`, `VirtualMTProtoServer`, `DeliveryTracker`).

**Leggi prima di iniziare:**
- `CLAUDE.md` — architettura, path aliases, convenzioni, pitfall già noti
- `docs/CHECKLIST_v2.md` — la lista degli item da chiudere (single source of truth)
- `docs/SESSION-HANDOFF.md` — contesto della sessione precedente (se presente)

## Missione

Ogni item `[ ]` in `docs/CHECKLIST_v2.md` deve diventare `[x]`. Un item è `[x]` SOLO se:
1. Il codice è stato fixato (se necessario)
2. Un test Playwright E2E lo verifica nel browser
3. `pnpm lint` passa (0 errori, warning deprecation tsconfig OK)
4. `npx tsc --noEmit 2>&1 | grep "error TS"` ritorna zero righe
5. I test unit rilevanti passano con `pnpm vitest run`
6. Lo screenshot (se richiesto dalla sezione D) è salvato in `/tmp/e2e-ui-<flow>.png`

**"Ho scritto il codice" NON conta. "Il test compila" NON conta. Solo il browser conta.**

## Regole assolute

### Verifica sempre nel browser
- NON marcare MAI un item `[x]` senza aver lanciato un test E2E headless (`chromium.launch({headless: true})`)
- NON marcare items in batch "perché il codice esiste"
- NON fidarti di `tsc` come prova che funziona
- Se un test E2E fallisce dopo 10 tentativi, documenta la root cause in `docs/CHECKLIST_v2.md` sezione BLOCKED e passa al successivo

### Stile di risposta
- **Corto, diretto, in italiano** quando rispondi all'utente
- Non ripetere cosa hai appena fatto — l'utente legge il diff
- Log concisi: "PASS 8/8" va bene, non incollare 200 righe di output

### Commit discipline
- **Ogni fix committato separatamente** con messaggio `fix(<scope>): <what> + e2e verified`
- **Mai `--no-verify`** — se un hook fallisce, investiga
- **Mai force push** a main
- **Stage solo file specifici** — niente `git add .` o `-A`

### Dev server
```bash
pnpm start    # http://localhost:8080
```
Verifica che risponda prima di lanciare qualsiasi E2E: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080` deve dare `200`.

Se la porta 8080 è occupata, `pnpm start` userà 8081/8082 — **aggiorna i test E2E temporaneamente** con la porta corretta OPPURE killa il processo che occupa 8080.

---

## Architettura chiave (ricorda)

### Virtual MTProto Bridge
- Worker chiama `nostraIntercept(method, params)` in `apiManager.ts`
- Metodi statici (`help.getConfig`, `updates.getState`, ecc.) → risposte hardcoded
- Metodi bridge (`messages.getHistory`, `messages.sendMessage`, ecc.) → MessagePort → main thread → `NostraMTProtoServer.handleMethod()`
- Server legge da `message-store` (IndexedDB) e ritorna shape MTProto native

### Receive pipeline
```
relay WebSocket
  → NostrRelay.handleEvent (unwrap NIP-17 gift-wrap)
  → RelayPool.handleIncomingMessage (dedup)
  → ChatAPI.handleRelayMessage (filters, parse, save, auto-add unknown sender)
  → ChatAPI.onMessage → NostraSync.onIncomingMessage
  → message-store.saveMessage + dispatch nostra_new_message
  → listener in nostra-onboarding-integration.ts
    → getHistory via server
    → mirror injection + dispatch history_append + dialogs_multiupdate
    → bubbles.ts renderNewMessage
```

### Send pipeline
```
user input → appMessagesManager.sendMessage (Worker)
  → apiManager.invokeApi('messages.sendMessage')
  → nostraIntercept → bridge
  → VirtualMTProtoServer.sendMessage (main thread)
  → chatAPI.connect(peer) if needed
  → chatAPI.sendText(text) → generates messageId chat-XXX-N
  → deliveryTracker.markSending(messageId)
  → relayPool.publish (NIP-17 gift-wrap)
  → deliveryTracker.markSent → dispatch nostra_delivery_update {state: 'sent'}
  → server saves to message-store + returns empty updates
```

### Delivery tracker states
- `sending` → shown as spinner icon
- `sent` → `.is-sent` class + `check` icon (single ✓)
- `delivered` → `.is-read` class + `checks` icon (double ✓✓) — **tweb conflates delivered+read into `is-read` state**
- `read` → stessa classe e icona di `delivered`, ma dovrebbe avere colore blu (da investigare in CSS)

### Known bugs già fixati in commit precedenti
- Timestamp double-division in NostraSync
- Receipt ID mismatch (msg.id → chatMessage.id)
- DeliveryTracker non inizializzato in initGlobalSubscription
- Unknown sender auto-add a virtual-peers-db
- `nostra_new_message` dispatch dialog update + mirror injection

### Bug NON ancora fixati (target di questa sessione)
- **A.1** `chatAPI.markRead()` mai chiamato → spunta non diventa mai "read" (blu)
- **A.2** Edge case riapertura chat cached (bidirectional test 3.2/3.3)
- **A.3** Preview text nel chat list per sender unknown (Worker cache issue)
- **B.1** 3 errori ESLint keyword-spacing in `nostra-onboarding-integration.ts`

---

## Procedure operative

### Per ogni item della sezione A (Bug fix)

1. **Leggi l'item** in `docs/CHECKLIST_v2.md` — capisci root cause e fix proposto
2. **Scrivi prima il test E2E** che riproduce il bug (TDD-ish)
   - Il test DEVE fallire nello stato corrente prima del fix
3. **Applica il fix minimo** al codice
4. **Lancia il test** → deve passare
5. **Verifica no-regressione:** lancia `e2e-bidirectional.ts` e `e2e-back-and-forth.ts`
6. **Lint + TSC clean**: `pnpm lint && npx tsc --noEmit`
7. **Commit** con messaggio descrittivo
8. **Marca** `[x]` in CHECKLIST_v2.md
9. **Commit** la checklist

### Per ogni item della sezione C (E2E tests)

1. **Lancia il test as-is** — vedi se passa
2. **Se passa** → marca `[x]` e continua
3. **Se fallisce:**
   - Leggi l'errore dal log
   - Se il test è obsoleto (riferimenti a UI rimossa, selettori cambiati) → **ADATTA il test** per riflettere la reality corrente
   - Se il test rivela un bug reale → fixa il codice
   - Se il test ha flake di propagazione relay → aumenta timeout a 45s o 60s
   - Retry fino a 10 volte
4. **Commit fix/adattamento** separatamente
5. **Marca** `[x]`

### Per ogni item della sezione D (Screenshot)

1. **Modifica il test E2E corrispondente** per salvare uno screenshot nel punto giusto:
   ```js
   await page.screenshot({path: '/tmp/e2e-ui-<name>.png', fullPage: false});
   ```
2. **Verifica visivamente** che lo screenshot mostri lo stato atteso (leggilo con Read tool)
3. **Marca** `[x]` solo se lo screenshot è coerente con l'acceptance criterion

### Fix loop per bug A.1 (spunta blu read)

Il problema: tweb usa `.is-read` per entrambi "delivered" e "read". Il CSS potrebbe usare una classe aggiuntiva o un attribute per il colore blu.

Procedura:
1. **Cerca in CSS:** `grep -rn 'is-read' src/scss/` → trova dove il colore della spunta è definito
2. **Cerca come tweb distingue delivered vs read** nel codice originale (probabilmente via `unreadOut` set)
3. **Implementa il segnale "read"** nel main thread quando arriva `nostra_delivery_update {state: 'read'}`:
   - Opzione A: aggiungere una seconda classe CSS custom tipo `is-read-blue` + override CSS
   - Opzione B: trovare il meccanismo esistente di tweb (`readOutboxMaxId`) e aggiornarlo
   - Opzione C: manipolare direttamente il `color` dell'icona `.time-sending-status`
4. **Chiama `chatAPI.markRead(eventId, senderPubkey)`** dal ricevente quando apre la chat
   - Candidato: hook in `bubbles.ts` o in `nostra-onboarding-integration.ts` ascoltando `peer_changed`
   - Per ogni bubble `is-in` visibile, chiamare `markRead(msg.eventId, senderPubkey)`
   - Usare un set per evitare double-send
5. **Test E2E bidirezionale read receipt:** vedi A.1.1 in CHECKLIST_v2.md

---

## Template test E2E minimale

```typescript
// @ts-nocheck
import {chromium, type Page} from 'playwright';

const APP_URL = 'http://localhost:8080';

async function dismiss(page: Page) {
  await page.evaluate(() =>
    document.querySelectorAll('vite-plugin-checker-error-overlay, vite-error-overlay')
      .forEach((el) => el.remove())
  );
}

async function main() {
  const browser = await chromium.launch({headless: true});
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  let passed = false;
  try {
    // === test logic ===
    await pageA.goto(APP_URL);
    await pageA.waitForTimeout(8000);
    await dismiss(pageA);
    // ... test ...

    passed = true; // set when all assertions pass
  } catch(err) {
    console.error('E2E error:', err);
    await pageA.screenshot({path: '/tmp/e2e-fail.png'}).catch(() => {});
  } finally {
    await ctxA.close();
    await ctxB.close();
    await browser.close();
    process.exit(passed ? 0 : 1);
  }
}

main();
```

---

## Diagnostics helper (copia e usa)

```typescript
async function getDiag(pageA: Page, pageB: Page, logsA: string[], logsB: string[]) {
  const relayState = async (p: Page) => p.evaluate(() => {
    const ca = (window as any).__nostraChatAPI;
    const entries = ca?.relayPool?.relayEntries || [];
    return {
      state: ca?.state,
      relayCount: entries.length,
      connected: entries.filter((e: any) => e.instance?.connectionState === 'connected').length
    };
  });
  return {
    relayA: await relayState(pageA),
    relayB: await relayState(pageB),
    published: logsA.some(l => l.includes('message published')),
    received: logsB.some(l => l.includes('received relay message')),
    deliveryUpdate: logsA.filter(l => l.includes('nostra_delivery_update'))
  };
}
```

---

## Completion Promise

**Output `<promise>ALL_BUGS_FIXED_V2</promise>` SOLO quando tutti questi comandi passano:**

```bash
# 1. CHECKLIST_v2.md completa
test "$(grep -c '\[ \]' docs/CHECKLIST_v2.md)" -eq 0

# 2. Lint pulito
pnpm lint 2>&1 | grep -q "problems" && echo FAIL || echo OK
# (oppure: exit code 0)

# 3. TSC pulito (solo errori, non warning)
test "$(npx tsc --noEmit 2>&1 | grep -c 'error TS[0-9]*:')" -eq 0

# 4. Unit tests verdi
npx vitest run src/tests/nostra/ 2>&1 | grep -q "failed" && echo FAIL || echo OK

# 5. Core E2E verdi (spot check)
for f in e2e-back-and-forth e2e-bidirectional e2e-message-requests; do
  npx tsx "src/tests/e2e/$f.ts" > /tmp/check-$f.log 2>&1
  tail -2 /tmp/check-$f.log | grep -q "0 failed" || echo "FAIL: $f"
done
```

Se anche UNO di questi comandi fallisce, continua a lavorare. NON scrivere la promise.

---

## Ordine suggerito di esecuzione

1. **B.1** (ESLint keyword-spacing) — 5 min, banale
2. **B.2** (TSC) — verifica, dovrebbe essere già ok
3. **B.3** (Unit tests batch) — investigazione mock contamination
4. **A.1** (Read receipt blu) — il bug visibile più importante, ~1h
5. **A.2** (Edge case 3.2/3.3) — ~1h
6. **A.3** (Preview unknown sender) — ~30min
7. **C.1** (re-verify test già fatti) — veloce
8. **C.2** (core P2P tests) — priorità alta
9. **D.1-D.7** (screenshot) — in parallelo con i test
10. **C.3-C.6** (remaining tests) — rimanenti, batch

---

## Non-goals (per evitare di perdere tempo)

- **NON refactoring** — fixa il minimo per far passare i test, niente cleanup ampio
- **NON migration TS deprecation** — i warning di tsconfig.json sono non bloccanti
- **NON aggiungere nuovi feature** — solo bug fix e test
- **NON rewriting** dei test che già passano — toccali solo se falliscono
- **NON rimuovere test obsoleti** — adatta piuttosto, perché la copertura è preziosa
