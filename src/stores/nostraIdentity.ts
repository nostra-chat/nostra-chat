import {createRoot, createSignal} from 'solid-js';
import rootScope from '@lib/rootScope';

const [npub, setNpub] = createRoot(() => createSignal<string | null>(null));
const [displayName, setDisplayName] = createRoot(() => createSignal<string | null>(null));
const [nip05, setNip05] = createRoot(() => createSignal<string | null>(null));
const [isLocked, setIsLocked] = createRoot(() => createSignal(false));
const [protectionType, setProtectionType] = createRoot(() => createSignal<'none' | 'pin' | 'passphrase'>('none'));

rootScope.addEventListener('nostra_identity_loaded', (data) => {
  setNpub(data.npub);
  setDisplayName(data.displayName || null);
  setNip05(data.nip05 || null);
  setProtectionType(data.protectionType);
  setIsLocked(false);
});

rootScope.addEventListener('nostra_identity_locked', () => {
  setIsLocked(true);
});

rootScope.addEventListener('nostra_identity_unlocked', (data) => {
  setNpub(data.npub);
  setIsLocked(false);
});

rootScope.addEventListener('nostra_identity_updated', (data) => {
  if(data.displayName !== undefined) setDisplayName(data.displayName || null);
  if(data.nip05 !== undefined) setNip05(data.nip05 || null);
});

export default function useNostraIdentity() {
  return {
    npub,
    displayName,
    nip05,
    isLocked,
    protectionType
  };
}
