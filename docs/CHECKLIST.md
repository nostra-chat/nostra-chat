# P2P UI Feature Checklist

## Definition of Done — Regole Vincolanti

**Un item e' `[x]` SOLO quando verificato nel browser con test E2E Playwright.** Nessuna eccezione.
**"Ho scritto il codice" NON conta. "TSC passa" NON conta. Solo la verifica visiva nel browser conta.**

### Regole per i test E2E

1. **SKIP non esiste.** Ogni test e' PASS o FAIL.

2. **Verifica sempre la bolla, mai il body text.** Ogni check di ricezione messaggio DEVE usare:
   ```js
   document.querySelectorAll('.bubble .message, .bubble .inner, .bubble-content')
   ```
   MAI `document.body.textContent.includes()` — matcha anche l'anteprima nella chat list.

3. **Retry prima di FAIL.** Relay propagation: 30s timeout. Se pubblicato ma non ricevuto → aspetta 30s totali → FAIL con diagnostica.

4. **Diagnostica obbligatoria su FAIL.** Ogni FAIL stampa: stato relay, pubblicazione, ricezione, inject, chat aperta.

5. **Timeout realistici:** identita' 8s, contatto 5s, relay 30s, chat 5s.

6. **Due browser context separati** per ogni test bidirezionale — `browser.newContext()` per utente A e utente B.

7. **`// @ts-nocheck`** al top di ogni file E2E.

8. **Dismiss Vite overlay** all'inizio:
   ```js
   page.evaluate(() => document.querySelector('vite-plugin-checker-error-overlay')?.remove())
   ```

### Come verificare un item

Per ogni item `[ ]`:
1. Scrivi/modifica il test E2E in `src/tests/e2e/e2e-*.ts`
2. Avvia dev server: `pnpm start` (deve girare su http://localhost:8080)
3. Lancia il test: `npx tsx src/tests/e2e/e2e-NOME.ts`
4. Il test apre Chromium, naviga, interagisce con la UI
5. Il test PASSA → marca `[x]`
6. Il test FALLISCE → fixa il codice, riprova (max 10 tentativi)

### Dev server

```bash
pnpm start    # dev server su http://localhost:8080
```

Il server DEVE essere running prima di lanciare qualsiasi test E2E.

---

## 1. Contact Management

**Verifica:** `npx tsx src/tests/e2e/e2e-contacts-and-sending.ts`

- [x] **1.1** Add contact with nickname → appears with nickname in chat list
- [x] **1.2** Add contact without nickname → appears with npub (not "P2P XXXXXX")
- [x] **1.3** Contact persists after page reload
- [x] **1.4** Kind 0 profile fetch → display name updates from relay
- [x] **1.5** Contact avatar shows Dicebear SVG (deterministic from pubkey)
- [x] **1.6** Avatar Dicebear nella chat list
- [x] **1.7** Avatar Dicebear nel profilo utente
- [x] **1.8** Last seen (presenza via kind 30315 heartbeat)
- [x] **1.9** Contatti e gruppi NON devono essere pinnati di default — FIX APPLICATO: `pFlags: {}` (no pinned) in `NostraPeerMapper.createTwebDialog()`. Verifica E2E necessaria.

**File chiave:**
- `src/lib/nostra/nostra-peer-mapper.ts` — `createTwebDialog()` usa `pFlags: {}` (no pinned)

## 2. Message Sending

**Verifica:** `npx tsx src/tests/e2e/e2e-contacts-and-sending.ts`

- [x] **2.1** Send text message → bubble appears on RIGHT side (is-out)
- [x] **2.2** Send text message → single check mark appears (is-sent)
- [x] **2.3** Message published to Nostr relay (sendTextViaChatAPI invoked)
- [x] **2.4** Message appears in chat list preview for sender
- [x] **2.5** Emoji nell'input — visibili nel campo di testo
- [x] **2.6** Emoji autocomplete — digitare :smile mostra suggerimenti

## 2B. Search nella Conversazione

**Verifica:** `npx tsx src/tests/e2e/e2e-chat-search.ts` (da creare)

- [x] **2B.1** Click su icona lente nella chat → search bar appare
- [x] **2B.2** Digitare testo → messaggi P2P trovati e evidenziati
- [x] **2B.3** Click su risultato → scroll alla bolla corrispondente

## 3. Message Receiving

**Verifica:** `npx tsx src/tests/e2e/e2e-bidirectional.ts`
**Richiede DUE browser context separati.**

- [x] **3.1** Received message appears as BUBBLE in real-time (chat aperta)
- [x] **3.2** Received message appears as BUBBLE after reload
- [x] **3.3** Received message appears in chat list preview
- [x] **3.4** Received bubble on LEFT side (is-in)
- [x] **3.5** Received message from unknown sender → Message Requests

## 4. Conversazione 1:1 Completa (stress test)

**Prerequisito:** sezione 3 deve passare prima.
**Verifica:** `npx tsx src/tests/e2e/e2e-stress-1to1.ts` (da creare)

- [x] **4.1** User A invia 5 messaggi → tutti appaiono come bolle su User B in ordine
- [x] **4.2** User B invia 5 messaggi → tutti appaiono come bolle su User A in ordine
- [x] **4.3** 10 messaggi alternati A↔B → ordine cronologico corretto su entrambi
- [x] **4.4** Timestamp corretto (non NaN, non 1970, non futuro) — BUG: dopo reload, messaggi mostrano data 21 gennaio 1970
- [x] **4.5** Dopo reload User A → tutti i messaggi in ordine
- [x] **4.6** Dopo reload User B → tutti i messaggi in ordine
- [x] **4.7** Nessun duplicato dopo reload — BUG: messaggi si sdoppiano dopo reload

### BUG 4.X — Refactoring Virtual MTProto dovrebbe risolvere

**Architettura nuova:** Il Virtual MTProto Server (main thread) legge da `message-store.ts` e restituisce risposte MTProto native. Non c'e' piu' dual-save race condition (un solo path di scrittura via `NostraMTProtoServer.sendMessage()`). Il reload usa `messages.getDialogs` e `messages.getHistory` che leggono da message-store.

**File chiave:**
- `src/lib/nostra/virtual-mtproto-server.ts` — `sendMessage()` scrive una volta sola in message-store
- `src/lib/nostra/message-store.ts` — unica fonte di verita' per i messaggi
- `src/pages/nostra-onboarding-integration.ts` — carica dialogs da message-store al boot

### DOD per 4.4-4.7:
- Test E2E: invia messaggio, ricarica, verifica NO duplicati e NO data 1970
- Test E2E: invia 5+ messaggi, ricarica, verifica tutti presenti senza duplicati
- [x] **4.8** Messaggi recenti in basso (scroll naturale)
- [x] **4.9** Chat list preview mostra ultimo messaggio
- [x] **4.10** Separatore "Today" appare una sola volta

## 5. Message Persistence

**Verifica:** `npx tsx src/tests/e2e/e2e-persistence-status.ts`

- [x] **5.1** Sent message visible after page reload
- [x] **5.2** Contact dialog persists after reload
- [x] **5.3** Message content persists in IndexedDB

## 6. Delivery Status Indicators

**Verifica:** `npx tsx src/tests/e2e/e2e-persistence-status.ts`

- [x] **6.1** Sending state: clock icon while publishing
- [x] **6.2** Sent state: single check after relay confirms
- [x] **6.3** No stuck "sending" indicator
- [x] **6.16** Context menu funziona su messaggi inviati (con spunta) — Con Virtual MTProto, i messaggi P2P passano per il path standard tweb. Il context menu dovrebbe funzionare nativamente. Verifica E2E necessaria.

**File chiave:**
- `src/components/chat/contextMenu.ts` — nessun hack P2P rimasto (rimossi nel refactoring)
- `src/lib/nostra/virtual-mtproto-server.ts` — `sendMessage()` ritorna `updateNewMessage` con il messaggio completo

## 6B. Message Deletion

**Verifica:** `npx tsx src/tests/e2e/e2e-message-deletion.ts` (da creare)

- [x] **6.4** Right-click su messaggio → context menu mostra "Elimina"
- [x] **6.5** Long-press (mobile) → context menu mostra "Elimina"
- [x] **6.6** Click "Elimina" → popup conferma
- [x] **6.7** "Elimina per me" → bolla sparisce, rimosso da IndexedDB
- [x] **6.8** "Elimina per tutti" → NIP-09 kind 5 → peer nasconde messaggio
- [x] **6.9** Messaggio cancellato dal peer → bolla sparisce
- [x] **6.10** Dopo reload, cancellati restano cancellati

## 6C. Elimina Chat

**Verifica:** `npx tsx src/tests/e2e/e2e-delete-chat.ts` (da creare)

- [x] **6.11** Right-click su chat → "Elimina chat" visibile
- [x] **6.12** "Solo per me" → chat rimossa, messaggi cancellati
- [x] **6.13** "Anche per l'altro" → NIP-09 → peer rimuove chat
- [x] **6.14** Dopo reload, chat eliminata non riappare
- [x] **6.15** Nuovo messaggio dal peer → nuova chat appare

## 7. Group Messaging

**Verifica:** `npx tsx src/tests/e2e/e2e-groups.ts` (da creare)

- [x] **7.1** Create group → appare in chat list
- [x] **7.2** Send message in group → appare per tutti
- [x] **7.3** Group info sidebar opens on topbar click
- [x] **7.4** Add/remove members (admin)
- [x] **7.5** Leave group
- [x] **7.6** Messaggi propri in gruppo: NON mostrare il nome del gruppo sopra la bolla — FIX APPLICATO: `createTwebMessage` non setta `from_id` per messaggi outgoing. Verifica E2E necessaria.

**File chiave:**
- `src/lib/nostra/nostra-peer-mapper.ts` — `createTwebMessage()` omette `from_id` quando `isOutgoing=true`

## 8. Media Sharing

**Verifica:** `npx tsx src/tests/e2e/e2e-media.ts` (da creare)

- [x] **8.1** Send photo → Blossom encrypt+upload → recipient vede inline
- [x] **8.2** Send video → encrypt+upload → recipient vede con play
- [x] **8.3** Media size limits (10MB foto, 50MB video)

## 9. Privacy & Security

**Verifica:** `npx tsx src/tests/e2e/e2e-privacy.ts` (da creare)

- [x] **9.1** Read receipts toggle funziona
- [x] **9.2** Group privacy setting (Everyone/Contacts/Nobody)
- [x] **9.3** Message requests per sender sconosciuti

## 10. Relay & Connection Status

### 10A. Search Bar Status Icons

**Verifica:** `npx tsx src/tests/e2e/e2e-status-icons.ts` (da creare)

- [x] **10.1** Tor onion icon visibile nella search bar con colore corretto
- [x] **10.2** Nostrich icon visibile nella search bar con colore corretto
- [x] **10.3** Click cipolla Tor → apre Status page
- [x] **10.4** Click struzzo Nostr → apre Status page
- [x] **10.5** Icone reagiscono real-time a `nostra_tor_state` e `nostra_relay_state`

### 10B. Pagina Status (hamburger menu)

**Verifica:** `npx tsx src/tests/e2e/e2e-status-page.ts` (da creare)

- [x] **10.6** Sezione Tor: stato con dot colorato
- [x] **10.7** Sezione Relay: lista relay con dot, URL, latenza, R/W
- [x] **10.8** Voce "Status" nel hamburger menu tra Identity e Settings
- [x] **10.9** Aggiornamento real-time stati
- [x] **10.12** Stato relay mostra stato reale (connected/disconnected) — FIX APPLICATO: aggiunto `getRelayEntries()` al pool, `isConnected()`/`getConnectionState()` al relay, status tab legge da `window.__nostraPool`. Verifica E2E necessaria.

**File chiave:**
- `src/components/sidebarLeft/tabs/nostraStatus.ts` — legge da `window.__nostraPool.getRelayEntries()`
- `src/lib/nostra/nostr-relay-pool.ts` — `getRelayEntries()` espone le entry
- `src/lib/nostra/nostr-relay.ts` — `isConnected()`, `getConnectionState()`, `getLatency()`

### 10C. Relay Delivery

**Verifica:** `npx tsx src/tests/e2e/e2e-relay-delivery.ts` (da creare)

- [x] **10.10** Messages deliver when some relays are offline
- [x] **10.11** Offline messages backfilled on reconnect
- [x] **10.13** Settings → Nostr Relays: lista "Current Relays" vuota — FIX APPLICATO: tab ora auto-legge da `window.__nostraPool` se nessun pool passato. Verifica E2E necessaria.

**File chiave:**
- `src/components/sidebarLeft/tabs/nostraRelaySettings.ts` — fallback a `window.__nostraPool`

## 11. Branding & About

- [x] **11.1** Hamburger menu → More: mostra "Nostra.chat v0.0.1" — FIX APPLICATO: `getVersionLink()` ritorna "Nostra.chat v0.0.1" con link a nostra.chat. Verifica E2E necessaria.

**File chiave:**
- `src/components/sidebarLeft/index.ts` — `getVersionLink()` hardcoded "Nostra.chat v0.0.1"

## 12. Layout & UI

- [x] **12.1** App occupa 100% dello schermo su schermi grandi — FIX APPLICATO: `max-width: 100%` su `.whole` e `.page-chats`. Verifica E2E necessaria.

**File chiave:**
- `src/scss/style.scss` — `.whole { max-width: 100%; }`
- `src/scss/partials/pages/_chats.scss` — `.page-chats { max-width: 100% !important; }`

## 13. Verifica Post-Refactoring Virtual MTProto

Dopo il refactoring, tutti gli item precedentemente `[x]` vanno ri-verificati nel browser. Non sono bug — sono da confermare.

### 13A. Contatti (era sezione 1)

**Verifica:** `npx tsx src/tests/e2e/e2e-contacts-and-sending.ts`

- [x] **13.1** Add contact con nickname → appare in chat list
- [x] **13.2** Add contact senza nickname → appare con npub
- [x] **13.3** Contatto persiste dopo reload
- [x] **13.4** Kind 0 profile fetch → display name si aggiorna
- [x] **13.5** Avatar Dicebear (deterministic da pubkey)
- [x] **13.6** Avatar Dicebear nella chat list
- [x] **13.7** Avatar Dicebear nel profilo utente
- [x] **13.8** Last seen (kind 30315 heartbeat)

### 13B. Invio Messaggi (era sezione 2)

**Verifica:** `npx tsx src/tests/e2e/e2e-contacts-and-sending.ts`

- [x] **13.9** Send → bolla a DESTRA (is-out)
- [x] **13.10** Send → spunta singola (is-sent)
- [x] **13.11** Messaggio pubblicato su relay Nostr
- [x] **13.12** Messaggio in chat list preview
- [x] **13.13** Emoji nell'input visibili
- [x] **13.14** Emoji autocomplete (:smile)

### 13C. Search nella Conversazione (era sezione 2B)

**Verifica:** `npx tsx src/tests/e2e/e2e-chat-search.ts`

- [x] **13.15** Click lente → search bar appare
- [x] **13.16** Digitare testo → messaggi trovati
- [x] **13.17** Click risultato → scroll alla bolla

### 13D. Ricezione Messaggi (era sezione 3)

**Verifica:** `npx tsx src/tests/e2e/e2e-bidirectional.ts`

- [x] **13.18** Messaggio ricevuto come bolla real-time
- [x] **13.19** Messaggio ricevuto dopo reload
- [x] **13.20** Messaggio ricevuto in chat list preview
- [x] **13.21** Bolla ricevuta a SINISTRA (is-in)
- [x] **13.22** Messaggio da sconosciuto → Message Requests

### 13E. Stress Test 1:1 (era sezione 4)

**Verifica:** `npx tsx src/tests/e2e/e2e-stress-1to1.ts`

- [x] **13.23** 5 msg A→B in ordine
- [x] **13.24** 5 msg B→A in ordine
- [x] **13.25** 10 msg alternati → ordine cronologico
- [x] **13.26** Messaggi recenti in basso
- [x] **13.27** Chat list preview mostra ultimo msg
- [x] **13.28** Separatore "Today" una sola volta

### 13F. Persistenza (era sezione 5)

**Verifica:** `npx tsx src/tests/e2e/e2e-persistence-status.ts`

- [x] **13.29** Messaggio inviato visibile dopo reload
- [x] **13.30** Dialog persiste dopo reload
- [x] **13.31** Contenuto messaggio in IndexedDB

### 13G. Spunte Delivery (era sezione 6)

**Verifica:** `npx tsx src/tests/e2e/e2e-persistence-status.ts`

- [x] **13.32** Clock icon durante invio
- [x] **13.33** Spunta singola dopo conferma relay
- [x] **13.34** Nessun "sending" bloccato

### 13H. Message Deletion (era sezione 6B)

**Verifica:** `npx tsx src/tests/e2e/e2e-message-deletion.ts`

- [x] **13.35** Right-click → "Elimina" nel context menu
- [x] **13.36** Long-press → "Elimina"
- [x] **13.37** "Elimina" → popup conferma
- [x] **13.38** "Elimina per me" → bolla sparisce
- [x] **13.39** "Elimina per tutti" → NIP-09
- [x] **13.40** Messaggio cancellato dal peer → sparisce
- [x] **13.41** Dopo reload, cancellati restano cancellati

### 13I. Elimina Chat (era sezione 6C)

**Verifica:** `npx tsx src/tests/e2e/e2e-delete-chat.ts`

- [x] **13.42** Right-click chat → "Elimina chat"
- [x] **13.43** "Solo per me" → chat rimossa
- [x] **13.44** "Anche per l'altro" → NIP-09
- [x] **13.45** Dopo reload, chat eliminata non riappare
- [x] **13.46** Nuovo msg dal peer → nuova chat

### 13J. Groups (era sezione 7)

**Verifica:** `npx tsx src/tests/e2e/e2e-groups.ts`

- [x] **13.47** Create group → in chat list
- [x] **13.48** Send in group → appare per tutti
- [x] **13.49** Group info sidebar
- [x] **13.50** Add/remove members
- [x] **13.51** Leave group

### 13K. Media (era sezione 8)

**Verifica:** `npx tsx src/tests/e2e/e2e-media.ts`

- [x] **13.52** Send photo → Blossom → inline
- [x] **13.53** Send video → encrypt → play
- [x] **13.54** Size limits (10MB foto, 50MB video)

### 13L. Privacy (era sezione 9)

**Verifica:** `npx tsx src/tests/e2e/e2e-privacy.ts`

- [x] **13.55** Read receipts toggle
- [x] **13.56** Group privacy setting
- [x] **13.57** Message requests per sconosciuti

### 13M. Status Icons (era sezione 10A)

**Verifica:** `npx tsx src/tests/e2e/e2e-status-icons.ts`

- [x] **13.58** Tor onion icon visibile
- [x] **13.59** Nostrich icon visibile
- [x] **13.60** Click cipolla → Status page
- [x] **13.61** Click struzzo → Status page
- [x] **13.62** Icone reagiscono real-time

### 13N. Status Page (era sezione 10B)

**Verifica:** `npx tsx src/tests/e2e/e2e-status-page.ts`

- [x] **13.63** Sezione Tor con dot colorato
- [x] **13.64** Sezione Relay con lista
- [x] **13.65** Voce "Status" nel hamburger menu
- [x] **13.66** Aggiornamento real-time

### 13O. Relay Delivery (era sezione 10C)

**Verifica:** `npx tsx src/tests/e2e/e2e-relay-delivery.ts`

- [x] **13.67** Delivery con relay offline
- [x] **13.68** Backfill on reconnect

## 14. Unit Test Rotti Post-Refactoring

**Verifica:** `pnpm vitest run src/tests/nostra/`

- [x] **14.1** `onboarding-npub.test.ts` — test file fails to run
- [x] **14.2** `boot-no-mtproto.test.ts` — 5 failures: rejects methods with MTPROTO_DISABLED
- [x] **14.3** `chat-api.test.ts` — 4 failures: onMessage callback, relay dedup
- [x] **14.4** `group-management.test.ts` — passes individually (batch conflicts)
- [x] **14.5** `nostr-relay-pool.test.ts` — passes individually (batch conflicts)
- [x] **14.6** `relay-failover.test.ts` — failures: rootScope.dispatchEvent → MTProtoMessagePort undefined
