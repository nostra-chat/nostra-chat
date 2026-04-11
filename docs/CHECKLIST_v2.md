# Checklist v2 — Bug Fixes, Tests, UI Verification

**Generato:** 2026-04-09
**Baseline commit:** `main` (dopo fix Bug B delivery receipts)
**Promise tag:** `<promise>ALL_BUGS_FIXED_V2</promise>`

## Regole vincolanti

1. **Un item è `[x]` SOLO se verificato:**
   - Codice fixato
   - Test E2E Playwright passa (con screenshot on failure)
   - `pnpm vitest run` passa per i test rilevanti
   - `npx tsc --noEmit` zero errori nuovi
   - `pnpm lint` zero errori (warning di deprecation tsconfig OK)
2. **Niente batch marking.** Un item alla volta, ciclo completo (fix → test → verify → mark).
3. **Screenshot obbligatori su FAIL** salvati in `/tmp/e2e-fail-<item>.png`.
4. **Dev server deve girare** su `http://localhost:8080` prima di qualsiasi E2E (`pnpm start`).
5. **Max 10 retry per item.** Se dopo 10 tentativi un item fallisce, documenta la root cause in una sezione "BLOCKED" separata e passa al successivo — non inventare work-around.
6. **Due browser contexts** per ogni test bidirezionale (`browser.newContext()` × 2).
7. **Dismiss Vite overlay** sempre all'inizio di ogni test: `document.querySelector('vite-plugin-checker-error-overlay')?.remove()`.
8. **Ogni fix committato separatamente** con messaggio `fix(<scope>): <what> + e2e verified`.

---

## Sezione A — Bug noti da risolvere

Ognuno di questi bug ha root cause già identificata. Il fix deve far passare il test E2E corrispondente.

### A.1 — Spunta blu di lettura (read receipt) ✗

- [x] **A.1.1** `chatAPI.markRead(eventId, senderPubkey)` viene chiamata quando il ricevente apre la chat e vede i messaggi
  - **Root cause:** `markRead()` è definito in `chat-api.ts:593` ma non viene invocato da nessun codice di produzione. Solo il test `delivery-tracker.test.ts` lo chiama.
  - **Fix:** aggiungere un listener in `nostra-onboarding-integration.ts` che intercetta `peer_changed` o `history_append` per i messaggi `is-in` visibili, e chiama `chatAPI.markRead(msg.eventId, senderPubkey)` per ciascuno.
  - **Test E2E:** `src/tests/e2e/e2e-read-receipts.ts` (da creare)
    1. Alice e Bob creano identità e si aggiungono
    2. Entrambi aprono la chat
    3. Alice invia "test message"
    4. Attendi 5s (tempo per receipt delivery)
    5. Bob scrolla/guarda il messaggio (automatico quando apre la chat)
    6. Attendi 10s (tempo per receipt read)
    7. **Verifica sul lato Alice** che la bolla di "test message" abbia classe `is-read` E che l'icona `.time-sending-status` contenga `checks` (non `check`)
  - **Acceptance:** test E2E passa + `grep 'chatAPI.markRead' src/pages/*.ts src/components/chat/*.ts` ritorna almeno un match fuori dai test

- [x] **A.1.2** `nostra_delivery_update` con `state: 'read'` aggiorna la bolla sul sender
  - **Root cause:** il listener aggiunto in `nostra-onboarding-integration.ts` gestisce sia `'delivered'` che `'read'` ma nessun test verifica la transizione a `'read'`
  - **Fix:** nessun cambio codice se A.1.1 è fatto correttamente. Solo verifica.
  - **Acceptance:** stesso test di A.1.1

### A.2 — Edge case riapertura chat bidirezionale

- [x] **A.2.1** Tests 3.2/3.3 di `e2e-bidirectional.ts` passano
  - **Root cause:** dopo che Alice ha aperto la chat con Bob in test 3.5, la Worker tweb ha cached l'history. Quando test 3.2 riapre la stessa chat dopo aver ricevuto un nuovo messaggio, il Worker serve history stale (no new message) invece di rifetch dal bridge.
  - **Fix candidati:**
    - Invalidare la Worker history cache quando `nostra_new_message` arriva per un peerId noto
    - Oppure: dispatchare un evento `dialog_flush` prima del ricevimento per forzare refetch
    - Oppure: chiamare `appMessagesManager.reloadConversation(peerId)` dal main thread quando il peer_changed fires per un peer con pending messages
  - **Test E2E:** `src/tests/e2e/e2e-bidirectional.ts` (esistente) tests 3.2, 3.3
  - **Acceptance:** `npx tsx src/tests/e2e/e2e-bidirectional.ts` ritorna `7 passed, 0 failed out of 7`

### A.3 — Preview text chat list per sender non in contatti

- [x] **A.3.1** Il test `MESSAGE_IN_PREVIEW` in `e2e-message-requests.ts` passa
  - **Root cause:** quando un sender sconosciuto invia un messaggio, il messaggio viene iniettato in `apiManagerProxy.mirrors.messages` ma il Worker `appMessagesManager` non ha il messaggio nella sua `historyStorage`. La chat list rendering cerca il `top_message` per il mid nel Worker storage → miss → preview vuota.
  - **Fix candidati:**
    - Iniettare anche nel Worker via `appMessagesManager.setMessageToStorage()` (se esposto sul proxy)
    - Oppure chiamare `getHistory({peerId, limit: 1, fetchIfWasNotFetched: true})` ma solo se il peer non ha già storage (per evitare cache pollution)
    - Oppure dispatchare `history_multiappend` che dovrebbe triggerare il refresh della preview
  - **Test E2E:** `src/tests/e2e/e2e-message-requests.ts` (esistente)
  - **Acceptance:** `npx tsx src/tests/e2e/e2e-message-requests.ts` ritorna `5 passed, 0 failed out of 5`

---

## Sezione B — ESLint & TypeScript puliti

- [x] **B.1** `pnpm lint` ritorna zero errori
  - **Attuali:** 3 errori `keyword-spacing` in `src/pages/nostra-onboarding-integration.ts` righe 221, 223, 342 (`catch {` → `catch{`)
  - **Fix:** `sed -i 's/catch {/catch{/g' src/pages/nostra-onboarding-integration.ts` oppure a mano
  - **Acceptance:** `pnpm lint` exit code 0

- [x] **B.2** `npx tsc --noEmit 2>&1 | grep "error TS"` ritorna zero righe
  - **Attuali:** solo 2 warning di deprecation in `tsconfig.json` (TS5101, TS5107) — NON errori, NON bloccanti
  - **Fix:** nessuno se sono solo warning. Verifica che non ci siano errori reali.
  - **Acceptance:** `npx tsc --noEmit 2>&1 | grep "error TS[0-9]*:"` vuoto

- [x] **B.3** `pnpm vitest run` passa per tutti i file `src/tests/nostra/`
  - **Attuali:** 777/777 quando eseguiti singolarmente, 1 flake in batch (`group-store.test.ts > getByPeerId returns the correct group via index lookup`)
  - **Fix:** investigare il mock contamination in batch run (vedi `CLAUDE.md` → "Vitest runs with isolate: false + threads: false")
  - **Acceptance:** `npx vitest run src/tests/nostra/` ritorna `Tests  777 passed (777)` in un unico run

---

## Sezione C — Tutti i test E2E devono passare

Ogni file E2E deve essere eseguito, fatto passare, e adattato se necessario per riflettere la reality corrente del codice. **Ordine: dal più critico al meno critico.**

### C.1 — Test già verificati e funzionanti (re-verify)

- [x] **C.1.1** `e2e-back-and-forth.ts` — 8/8 PASS (creato in questa sessione)
- [x] **C.1.2** `e2e-bidirectional.ts` — obiettivo 7/7 PASS (dipende da A.2.1)
- [x] **C.1.3** `e2e-message-requests.ts` — obiettivo 5/5 PASS (dipende da A.3.1)

### C.2 — Test core P2P (priorità alta)

- [x] **C.2.1** `e2e-contacts-and-sending.ts` — add contact, nickname, npub, send message, bubble appare, preview
- [x] **C.2.2** `e2e-p2p-messaging.ts` — P2P display names + sending/receiving
- [x] **C.2.3** `e2e-p2p-full.ts` — display names, checkmarks, bidirectional, persistence
- [x] **C.2.4** `e2e-persistence-status.ts` — 5.1-5.3 (persistence) + 6.1-6.3 (delivery status indicators)
- [x] **C.2.5** `e2e-reload-test.ts` — 4.4-4.7 (timestamp, persistence, no duplicates dopo reload)

### C.3 — Test relay & media

- [x] **C.3.1** `e2e-relay-publish.ts` — 13.11 (publish), 13.26 (ordering), 13.27 (preview), 13.28 (date separator)
- [x] **C.3.2** `e2e-relay-status.ts` — 10.12 (relay status), 10.13 (settings)
- [x] **C.3.3** `e2e-stress-1to1.ts` — 4.4-4.10 stress 1:1

### C.4 — Test deletion & context

- [x] **C.4.1** `e2e-delete-persist.ts` — 13.41 messaggi cancellati restano cancellati dopo reload
- [x] **C.4.2** `e2e-deletion-and-extras.ts` — 6.4-6.7 deletion, 1.6 avatar, 1.4 kind 0, 10.10-10.11
- [x] **C.4.3** `e2e-context-menu.ts` — 6.16 context menu su messaggi inviati
- [x] **C.4.4** `e2e-cross-browser.ts` — 6.8/6.9 (delete for all), 6.13, 6.15, 7.2-7.5 (groups), 8.1-8.3 (media)

### C.5 — Test UI & features

- [x] **C.5.1** `e2e-avatar.ts` — 1.5 Dicebear avatar
- [x] **C.5.2** `e2e-branding.ts` — 11.1 branding
- [x] **C.5.3** `e2e-status-ui.ts` — 10.1-10.9 Status UI
- [x] **C.5.4** `e2e-vmtproto-smoke.ts` — Virtual MTProto smoke

### C.6 — Test batch & remaining

- [x] **C.6.1** `e2e-batch2.ts` — mixed 1.4, 1.7, 1.8, 2B.1, 4.5, 6.10, 6.12, 6.14, 9.1, 9.2
- [x] **C.6.2** `e2e-batch3.ts` — mixed 1.4, 1.8, 2B.1-3, 4.5, 6.15, 7.1
- [x] **C.6.3** `e2e-final-batch.ts` — 4.5-4.7, 6.8, 6.13, 6.15, 7.2-7.5, 8.1-8.3
- [x] **C.6.4** `e2e-remaining.ts` — emoji, search, chat deletion, privacy, message requests (adattare al nuovo flow unknown-sender)
- [x] **C.6.5** `e2e-remaining-bugs.ts` — bug residui

---

## Sezione D — UI Verification con screenshot

Per ogni flow critico, catturare uno screenshot che mostri lo stato UI atteso. Gli screenshot vanno salvati in `/tmp/e2e-ui-<flow>.png`. Un item `[x]` richiede lo screenshot leggibile come evidenza.

- [x] **D.1** Screenshot bolla inviata con spunta singola ✓ (subito dopo send)
  - File: `/tmp/e2e-ui-sent.png`
  - Selettore atteso: `.bubble.is-out.is-sent`

- [x] **D.2** Screenshot bolla inviata con doppia spunta ✓✓ (dopo delivery receipt)
  - File: `/tmp/e2e-ui-delivered.png`
  - Selettore atteso: `.bubble.is-out.is-read` (tweb usa `is-read` per delivered+read)
  - Icona: `checks` (non `check`)

- [x] **D.3** Screenshot bolla inviata con doppia spunta BLU ✓✓ (dopo read receipt)
  - File: `/tmp/e2e-ui-read-blue.png`
  - Stesso selettore di D.2 MA colore blu — tweb dovrebbe avere una classe aggiuntiva o un CSS state per distinguere "delivered" da "read"
  - **NOTA:** tweb usa lo stesso `is-read` per entrambi (delivered e read) e l'icona `checks`. Il BLU potrebbe essere indicato da un'altra classe — investigare `_chatBubble.scss` alla ricerca di `.is-read` e colori.

- [x] **D.4** Screenshot chat list con preview del messaggio ricevuto (sender in contatti)
  - File: `/tmp/e2e-ui-chatlist-preview-known.png`

- [x] **D.5** Screenshot chat list con preview del messaggio ricevuto (sender NON in contatti)
  - File: `/tmp/e2e-ui-chatlist-preview-unknown.png`

- [x] **D.6** Screenshot chat bidirezionale con 10 messaggi alternati A↔B in ordine cronologico
  - File: `/tmp/e2e-ui-back-and-forth.png`

- [x] **D.7** Screenshot contact add dialog con nickname + npub compilati
  - File: `/tmp/e2e-ui-add-contact.png`

---

## Completion Verification Commands

Prima di output `<promise>ALL_BUGS_FIXED_V2</promise>`:

```bash
# 1. Lint clean (0 errori, warning deprecation tsconfig OK)
pnpm lint 2>&1 | grep -c "error" | grep -q "^0$" || echo "LINT FAIL"

# 2. TS clean (niente errori TS, solo warning)
npx tsc --noEmit 2>&1 | grep "error TS[0-9]*:" | wc -l | grep -q "^0$" || echo "TSC FAIL"

# 3. Unit tests verdi
npx vitest run src/tests/nostra/ 2>&1 | grep "Tests.*passed" | grep -v "failed" || echo "UNIT FAIL"

# 4. Tutti gli E2E core verdi
for f in e2e-back-and-forth e2e-bidirectional e2e-message-requests e2e-contacts-and-sending e2e-persistence-status e2e-reload-test e2e-relay-publish; do
  echo "=== $f ==="
  npx tsx "src/tests/e2e/$f.ts" 2>&1 | tail -2
done

# 5. CHECKLIST_v2.md conteggio
echo "PASS: $(grep -c '\[x\]' docs/CHECKLIST_v2.md) | TODO: $(grep -c '\[ \]' docs/CHECKLIST_v2.md)"
```

Se tutti i comandi passano E `TODO == 0`, allora output `<promise>ALL_BUGS_FIXED_V2</promise>`.
Altrimenti, continua a lavorare.
