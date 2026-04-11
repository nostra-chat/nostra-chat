/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import {SliderSuperTab} from '@components/slider';
import appDialogsManager from '@lib/appDialogsManager';
import InputSearch from '@components/inputSearch';
import {IS_MOBILE} from '@environment/userAgent';
import {canFocus} from '@helpers/dom/canFocus';
import windowSize from '@helpers/windowSize';
import ButtonCorner from '@components/buttonCorner';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import SortedUserList from '@components/sortedUserList';
import {getMiddleware} from '@helpers/middleware';
import replaceContent from '@helpers/dom/replaceContent';
import rootScope from '@lib/rootScope';
import {getAllMappings} from '@lib/nostra/virtual-peers-db';

// TODO: поиск по людям глобальный, если не нашло в контактах никого

export default class AppContactsTab extends SliderSuperTab {
  public static noSame = true;
  private inputSearch: InputSearch;
  private middlewareHelperLoad: ReturnType<typeof getMiddleware>;
  private sortedUserList: SortedUserList;
  private listsContainer: HTMLElement;

  public init() {
    this.container.id = 'contacts-container';

    // this.list = appDialogsManager.createChatList(/* {avatarSize: 48, handheldsSize: 66} */);

    const btnAdd = ButtonCorner({icon: 'add', className: 'is-visible'});
    this.content.append(btnAdd);

    attachClickEvent(btnAdd, () => {
      this.showAddContactPopup();
    }, {listenerSetter: this.listenerSetter});

    this.inputSearch = new InputSearch({
      placeholder: 'Search',
      onChange: (value) => {
        // [Nostra.chat] Detect npub paste and open P2P chat
        if(value && value.trim().startsWith('npub1') && value.trim().length >= 60) {
          this.handleNpubInput(value.trim());
          return;
        }
        this.openContacts(value);
      }
    });

    this.listenerSetter.add(rootScope)('contacts_update', async(userId) => {
      const isContact = await this.managers.appUsersManager.isContact(userId);
      const peerId = userId.toPeerId();
      if(isContact) this.sortedUserList.add(peerId);
      else this.sortedUserList.delete(peerId);
    });

    this.title.replaceWith(this.inputSearch.container);

    this.middlewareHelperLoad = getMiddleware();

    const listsContainer = this.listsContainer = document.createElement('div');
    this.scrollable.append(listsContainer);

    this.openContacts();

    // preload contacts
    // appUsersManager.getContacts();
  }

  protected createList() {
    const sortedUserList = new SortedUserList({
      managers: this.managers,
      middleware: this.middlewareHelper.get()
    });
    const list = sortedUserList.list;
    list.id = 'contacts';
    list.classList.add('contacts-container');
    appDialogsManager.setListClickListener({
      list,
      onFound: () => {
        this.close();
      },
      withContext: undefined,
      autonomous: true
    });
    return sortedUserList;
  }

  protected onClose() {
    this.middlewareHelperLoad.clean();
    /* // need to clear, and left 1 page for smooth slide
    let pageCount = appPhotosManager.windowH / 56 * 1.25 | 0;
    (Array.from(this.list.children) as HTMLElement[]).slice(pageCount).forEach((el) => el.remove()); */
  }

  protected onOpenAfterTimeout() {
    if(IS_MOBILE || !canFocus(true)) return;
    this.inputSearch.input.focus();
  }

  public openContacts(query?: string) {
    this.middlewareHelperLoad.clean();
    const middleware = this.middlewareHelperLoad.get();
    this.scrollable.onScrolledBottom = null;
    this.listsContainer.replaceChildren();

    this.managers.appUsersManager.getContactsPeerIds(query, undefined, 'online').then((contacts) => {
      if(!middleware()) {
        return;
      }

      this.renderContactsList(contacts, middleware);
    }).catch(() => {
      // MTProto disabled — load P2P contacts from IndexedDB
      if(!middleware()) return;
      this.loadP2PContacts(query, middleware);
    });
  }

  private renderContactsList(contacts: PeerId[], middleware: () => boolean) {
    const sortedUserList = this.sortedUserList = this.createList();

    let renderPage = () => {
      const pageCount = windowSize.height / 56 * 1.25 | 0;
      const arr = contacts.splice(0, pageCount); // надо splice!

      arr.forEach((peerId) => {
        sortedUserList.add(peerId);
      });

      if(!contacts.length) {
        renderPage = undefined;
        this.scrollable.onScrolledBottom = null;
      }
    };

    renderPage();
    this.scrollable.onScrolledBottom = () => {
      if(renderPage) {
        renderPage();
      } else {
        this.scrollable.onScrolledBottom = null;
      }
    };

    replaceContent(this.listsContainer, sortedUserList.list);
  }

  private async loadP2PContacts(query: string | undefined, middleware: () => boolean) {
    try {
      const mappings = await getAllMappings();
      if(!middleware()) return;

      const lowerQuery = query?.toLowerCase();
      const filtered = lowerQuery ?
        mappings.filter((m) => (m.displayName || m.pubkey).toLowerCase().includes(lowerQuery)) :
        mappings;

      if(!filtered.length) {
        const emptyEl = document.createElement('div');
        emptyEl.classList.add('contacts-empty');
        emptyEl.textContent = query ? 'No contacts found' : 'Tap + to add a contact';
        replaceContent(this.listsContainer, emptyEl);
        return;
      }

      // Inject P2P users into Worker + main thread mirrors
      const {NostraBridge} = await import('@lib/nostra/nostra-bridge');
      const bridge = NostraBridge.getInstance();
      const {NostraPeerMapper} = await import('@lib/nostra/nostra-peer-mapper');
      const mapper = new NostraPeerMapper();
      const {MOUNT_CLASS_TO} = await import('@config/debug');
      const proxy = MOUNT_CLASS_TO.apiManagerProxy;
      const {reconcilePeer} = await import('@stores/peers');
      const rootScope = (await import('@lib/rootScope')).default;

      const peerIds: PeerId[] = [];
      for(const m of filtered) {
        const displayName = m.displayName || 'npub...' + m.pubkey.slice(0, 16);
        const avatar = bridge.deriveAvatarFromPubkeySync(m.pubkey);
        // Worker injection
        try {
          await rootScope.managers.appUsersManager.injectP2PUser(m.pubkey, m.peerId, displayName, avatar);
        } catch(err) { /* ignore */ }
        // Main thread mirror + Solid store
        const user = mapper.createTwebUser({peerId: m.peerId, firstName: displayName, pubkey: m.pubkey});
        if(proxy?.mirrors?.peers) proxy.mirrors.peers[m.peerId.toPeerId(false)] = user;
        reconcilePeer(m.peerId.toPeerId(false), user);
        peerIds.push(m.peerId.toPeerId(false));
      }

      if(!middleware()) return;
      this.renderContactsList(peerIds, middleware);
    } catch(err) {
      console.error('[Nostra.chat] failed to load P2P contacts:', err);
      const emptyEl = document.createElement('div');
      emptyEl.classList.add('contacts-empty');
      emptyEl.textContent = 'Tap + to add a contact';
      replaceContent(this.listsContainer, emptyEl);
    }
  }

  private async handleNpubInput(npub: string, nickname?: string) {
    try {
      const {decodePubkey} = await import('@lib/nostra/nostr-identity');
      const {NostraBridge} = await import('@lib/nostra/nostra-bridge');
      const {toast} = await import('@components/toast');

      const hexPubkey = decodePubkey(npub);
      const bridge = NostraBridge.getInstance();
      const peerId = await bridge.mapPubkeyToPeerId(hexPubkey);
      const userNickname = nickname?.trim() || undefined;
      await bridge.storePeerMapping(hexPubkey, peerId, userNickname);

      // Inject synthetic user into Worker via managers proxy (persists in Worker memory)
      const rootScope = (await import('@lib/rootScope')).default;
      const avatar = bridge.deriveAvatarFromPubkeySync(hexPubkey);
      const displayName = userNickname || npub.slice(0, 20);
      try {
        await rootScope.managers.appUsersManager.injectP2PUser(
          hexPubkey, peerId, displayName, avatar
        );
      } catch(err) {
        console.warn('[Nostra.chat] Worker injectP2PUser failed:', err);
      }

      // Inject user into main thread mirrors + Solid store immediately
      const {NostraPeerMapper} = await import('@lib/nostra/nostra-peer-mapper');
      const mapper = new NostraPeerMapper();
      const user = mapper.createTwebUser({
        peerId,
        firstName: displayName,
        pubkey: hexPubkey
      });
      const {MOUNT_CLASS_TO: MC} = await import('@config/debug');
      const proxyRef = MC.apiManagerProxy;
      if(proxyRef?.mirrors?.peers) proxyRef.mirrors.peers[peerId.toPeerId(false)] = user;
      const {reconcilePeer} = await import('@stores/peers');
      reconcilePeer(peerId.toPeerId(false), user);

      // Connect ChatAPI to peer — initializes relay pool, subscribes to messages,
      // and starts backfill so we can send AND receive messages
      const chatAPI = (window as any).__nostraChatAPI;
      if(chatAPI) {
        chatAPI.connect(hexPubkey).catch((err: any) => {
          console.warn('[Nostra.chat] ChatAPI connect failed:', err);
        });
      }

      // Fire-and-forget kind 0 profile fetch — if the relay has a profile
      // for this pubkey, update the display name in the background.
      // The user-supplied nickname always takes priority (checked in updateMappingProfile).
      import('@lib/nostra/nostr-profile').then(async({fetchNostrProfile, profileToDisplayName}) => {
        const profile = await fetchNostrProfile(hexPubkey);
        if(!profile) return;
        const k0Name = profileToDisplayName(profile);
        if(!k0Name) return;

        // Persist in virtual-peers-db (respects existing nickname)
        const {updateMappingProfile} = await import('@lib/nostra/virtual-peers-db');
        await updateMappingProfile(hexPubkey, k0Name, profile);

        // Update Worker-side user object
        try {
          await rootScope.managers.appUsersManager.updateP2PUserName(peerId, k0Name);
        } catch{ /* non-critical */ }

        // Refresh main-thread peer mirror + Solid store
        if(proxyRef?.mirrors?.peers?.[peerId.toPeerId(false)]) {
          proxyRef.mirrors.peers[peerId.toPeerId(false)].first_name = k0Name;
          reconcilePeer(peerId.toPeerId(false), proxyRef.mirrors.peers[peerId.toPeerId(false)]);
        }

        // Refresh dialog so chat list subtitle updates
        rootScope.dispatchEvent('dialogs_multiupdate' as any, new Map([[peerId, {dialog}]]));
        console.log('[Nostra.chat] kind 0 profile applied:', k0Name, 'for', hexPubkey.slice(0, 8));
      }).catch(() => { /* non-critical: relay may be offline */ });

      // Persist conversation in message-store so Worker's getDialogs() can find it.
      // Without this, virtual-mtproto-server.getDialogs() returns nothing for
      // contacts that have no messages yet, breaking the chat list after reload
      // and making the contact invisible to the Worker.
      const ownPubkey = (window as any).__nostraOwnPubkey;
      if(ownPubkey) {
        const {getMessageStore} = await import('@lib/nostra/message-store');
        const store = getMessageStore();
        const conversationId = store.getConversationId(ownPubkey, hexPubkey);
        const initEventId = 'contact-init-' + hexPubkey;
        const initTimestamp = Math.floor(Date.now() / 1000);
        const mid = await mapper.mapEventId(initEventId, initTimestamp);
        await store.saveMessage({
          eventId: initEventId,
          conversationId,
          senderPubkey: hexPubkey,
          content: '',
          type: 'text',
          timestamp: initTimestamp,
          deliveryState: 'delivered',
          mid,
          twebPeerId: peerId,
          isOutgoing: false
        });
      }

      // Create and dispatch dialog so contact appears in chat list
      const dialog = mapper.createTwebDialog({
        peerId,
        topMessage: 0,
        topMessageDate: Math.floor(Date.now() / 1000)
      });
      rootScope.dispatchEvent('dialogs_multiupdate', new Map([[peerId, {dialog}]]));
      rootScope.dispatchEvent('peer_title_edit', {peerId: peerId.toPeerId(false)});
      console.log('[Nostra.chat] dialog dispatched for peerId:', peerId, 'name:', displayName);

      toast('Contact added: ' + (userNickname || npub.slice(0, 12) + '...'));
      this.close();
    } catch(err) {
      console.error('[Nostra.chat] failed to add contact from npub:', err);
      const {toast} = await import('@components/toast');
      toast('Invalid npub format');
    }
  }

  private showAddContactPopup() {
    const overlay = document.createElement('div');
    overlay.classList.add('popup-add-contact-overlay');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--surface-color);border-radius:12px;padding:24px;width:340px;max-width:90vw;';

    const title = document.createElement('h3');
    title.textContent = 'Add Contact';
    title.style.cssText = 'margin:0 0 16px;font-size:18px;color:var(--primary-text-color);';

    const desc = document.createElement('p');
    desc.textContent = 'Enter an npub address to start a conversation';
    desc.style.cssText = 'margin:0 0 16px;font-size:14px;color:var(--secondary-text-color);';

    const nicknameInput = document.createElement('input');
    nicknameInput.type = 'text';
    nicknameInput.placeholder = 'Nickname (optional)';
    nicknameInput.classList.add('input-clear');
    nicknameInput.style.cssText = 'width:100%;padding:12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;box-sizing:border-box;background:var(--surface-color);color:var(--primary-text-color);margin-bottom:8px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'npub1...';
    input.classList.add('input-clear');
    input.style.cssText = 'width:100%;padding:12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;box-sizing:border-box;background:var(--surface-color);color:var(--primary-text-color);';

    const errorEl = document.createElement('div');
    errorEl.style.cssText = 'color:var(--danger-color);font-size:12px;margin-top:8px;min-height:18px;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.classList.add('btn-primary', 'btn-transparent');
    cancelBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:14px;';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.classList.add('btn-primary', 'btn-color-primary');
    addBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:14px;color:#fff;';
    addBtn.addEventListener('click', async() => {
      const val = input.value.trim();
      if(!val.startsWith('npub1') || val.length < 60) {
        errorEl.textContent = 'Invalid npub format';
        return;
      }
      addBtn.disabled = true;
      addBtn.textContent = 'Adding...';
      try {
        await this.handleNpubInput(val, nicknameInput.value);
        overlay.remove();
      } catch(err) {
        errorEl.textContent = 'Failed to add contact';
        addBtn.disabled = false;
        addBtn.textContent = 'Add';
      }
    });

    // QR placeholder button
    const qrBtn = document.createElement('button');
    qrBtn.textContent = 'Scan QR';
    qrBtn.classList.add('btn-primary', 'btn-transparent');
    qrBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:14px;opacity:0.5;';
    qrBtn.title = 'QR scanning coming soon';
    qrBtn.addEventListener('click', async() => {
      const {toast} = await import('@components/toast');
      toast('QR scanning coming soon');
    });

    overlay.addEventListener('click', (e) => {
      if(e.target === overlay) overlay.remove();
    });

    btnRow.append(qrBtn, cancelBtn, addBtn);
    dialog.append(title, desc, nicknameInput, input, errorEl, btnRow);
    overlay.append(dialog);
    document.body.append(overlay);
    input.focus();
  }

  public focus() {
    this.onOpenAfterTimeout();
  }
}
