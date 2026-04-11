# Ralph Loop — Verifica E2E nel Browser, Non nel Codice

## Obiettivo

Ogni item `[ ]` in `CHECKLIST.md` deve diventare `[x]`. Un item e' `[x]` SOLO se verificato nel browser con Playwright. "Ho scritto il codice" non conta. "TSC passa" non conta.

## Regola assoluta: VERIFICA NEL BROWSER

- NON marcare MAI un item `[x]` senza aver lanciato un test E2E che apre il browser
- NON marcare items in batch "perche' il codice esiste"
- NON fidarti di `npx tsc --noEmit` come prova che funziona
- Se un test E2E non esiste per un item, CREALO prima
- Se un item richiede due browser (bidirezionale), usa DUE `browser.newContext()`
- BLOCCATO non esiste — se fallisci, riprova fino a 10 volte
- Se un item della sezione 13 (Verifica Post-Refactoring) FALLISCE, DEVI fixare il codice sorgente fino a farlo passare. Questi item funzionavano PRIMA del refactoring — se ora falliscono hai introdotto una regressione e va risolta. NON puoi: saltarli, marcarli come "non applicabile", dire "funzionera' dopo", o passare all'item successivo senza averlo fixato.
- Se un item della sezione 14 (Unit Test Rotti) FALLISCE, DEVI fixare il test o il codice fino a farlo passare con `pnpm vitest run`. Stesse regole: niente scorciatoie.
- NON inventare scuse per non fixare. "E' troppo complesso", "richiede refactoring", "non e' colpa mia" NON sono risposte valide. Fixa e basta.

## Come verificare OGNI singolo item `[ ]`

### Passo 1: Dev server
```bash
pnpm start    # DEVE girare su http://localhost:8080
```
Verifica che risponda: `curl -s http://localhost:8080 | head -5`

### Passo 2: Scrivi il test E2E (se non esiste)
File: `src/tests/e2e/e2e-SEZIONE.ts`
- `// @ts-nocheck` al top
- Usa `playwright` o `puppeteer` per aprire Chromium
- Naviga a `http://localhost:8080?nostra=1`
- Dismiss Vite overlay
- Interagisci con la UI: clicca, digita, aspetta
- Verifica il DOM: `.bubble .message`, `.avatar-photo`, ecc.

### Passo 3: Lancia il test
```bash
npx tsx src/tests/e2e/e2e-SEZIONE.ts
```

### Passo 4: Interpreta il risultato
- PASS → marca `[x]` in CHECKLIST.md
- FAIL → leggi l'errore, fixa il codice, torna al passo 3 (max 10 tentativi)
- ERRORE nel test stesso → fixa il test, riprova

### Passo 5: Commit
```bash
git add -A && git commit -m "fix: DESCRIZIONE + e2e verified"
```

### Passo 6: Stampa conteggio
```bash
echo "PASS: $(grep -c '\[x\]' CHECKLIST.md) | TODO: $(grep -c '\[ \]' CHECKLIST.md)"
```

## Ordine di esecuzione

Segui quest'ordine. Non saltare item.

1. **1.1-1.5** — Contatti base: nickname, npub, persistenza, kind 0, avatar
2. **2.1-2.4** — Invio messaggi: bolla destra, spunta, relay, preview
3. **3.1-3.5** — Ricezione messaggi: bolla real-time, dopo reload, preview, lato sinistro, message requests
4. **5.1-5.3** — Persistenza messaggi
5. **6.1-6.3** — Spunte di delivery
6. **4.1-4.10** — Stress test bidirezionale (dipende da 3.x)
7. **1.6-1.8** — Avatar chat list, avatar profilo, last seen
8. **2.5-2.6** — Emoji input e autocomplete
9. **2B.1-2B.3** — Search nella conversazione
10. **6.4-6.10** — Message deletion
11. **6.11-6.15** — Elimina chat
12. **7.1-7.5** — Group messaging
13. **8.1-8.3** — Media sharing
14. **9.1-9.3** — Privacy settings
15. **10.1-10.5** — Status icons nella search bar
16. **10.6-10.9** — Pagina Status
17. **10.10-10.11** — Relay delivery edge cases
18. **14.1-14.6** — Unit test rotti: fix con `pnpm vitest run src/tests/nostra/`
19. **13.1-13.68** — Verifica post-refactoring: ri-verifica TUTTI gli item. Se FAIL → fixa il codice, NON saltare

## Regole per i test E2E

1. **Verifica la bolla** — `.bubble .message`, MAI `document.body.textContent`
2. **Retry 30s** per ricezione relay
3. **Diagnostica su FAIL** — stato relay, published, received, injected, chat aperta
4. **Due browser context** per test bidirezionali
5. **Dismiss Vite overlay** all'inizio
6. **Screenshot su FAIL** — `page.screenshot({path: '/tmp/e2e-fail-ITEM.png'})` per debug visivo

## Regole per il codice

- **Zero errori TypeScript** — `npx tsc --noEmit 2>&1 | grep "error TS"`
- 2 space indent, single quotes, no trailing commas
- `if(condition)` not `if (condition)`
- `// @ts-nocheck` al top di ogni file E2E

## Template test E2E minimale

```typescript
// @ts-nocheck
import {chromium} from 'playwright';

const BASE = 'http://localhost:8080?nostra=1';

async function main() {
  const browser = await chromium.launch({headless: false});
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  
  // Dismiss Vite overlay
  await page.evaluate(() => {
    document.querySelector('vite-plugin-checker-error-overlay')?.remove();
  });
  
  // === TEST LOGIC HERE ===
  
  // Verify something in the DOM
  const found = await page.evaluate(() => {
    // Check for specific element
    return document.querySelector('.some-selector')?.textContent;
  });
  
  if(!found) {
    // Screenshot for debug
    await page.screenshot({path: '/tmp/e2e-fail.png'});
    console.error('FAIL: element not found');
    process.exit(1);
  }
  
  console.log('PASS');
  await browser.close();
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
```

## Architettura chiave (Virtual MTProto — leggi CLAUDE.md per dettagli)

- **Worker vs Main thread:** manager tweb nel Worker con risposte statiche vuote. Codice P2P (server, sync, ChatAPI) nel main thread.
- **Virtual MTProto Server:** `src/lib/nostra/virtual-mtproto-server.ts` — intercetta metodi MTProto, legge da `message-store.ts`, ritorna risposte native tweb.
- **NostraSync:** `src/lib/nostra/nostra-sync.ts` — riceve messaggi da ChatAPI, persiste in message-store, dispatcha eventi rootScope.
- **NostraPeerMapper:** `src/lib/nostra/nostra-peer-mapper.ts` — crea oggetti tweb nativi (User, Chat, Message, Dialog).
- **Dialogs:** dispatchati via `dialogs_multiupdate` dal main thread dopo lettura da message-store.
- **Messages:** iniettati in `apiManagerProxy.mirrors.messages` + dispatched via `history_append`.
- **Server esposto come:** `window.__nostraMTProtoServer` — usato da contacts.ts e input.ts per operazioni P2P.
- **`getSelf()` = undefined** in Nostra.chat mode

## Completion Promise

**Output `<promise>ALL_BUGS_FIXED</promise>` SOLO quando:**
1. TUTTI gli item in CHECKLIST.md sono `[x]` — nessun `[ ]` rimasto
2. Ogni `[x]` e' stato verificato con un test E2E che apre il browser
3. `npx tsc --noEmit 2>&1 | grep "error TS"` ritorna zero righe

**Verifica prima:**
```bash
echo "PASS: $(grep -c '\[x\]' CHECKLIST.md) | TODO: $(grep -c '\[ \]' CHECKLIST.md)"
```
Se TODO > 0, NON scrivere la promise — continua a lavorare.

**NON scrivere la promise senza verifica browser. NON marcare item senza test E2E.**
