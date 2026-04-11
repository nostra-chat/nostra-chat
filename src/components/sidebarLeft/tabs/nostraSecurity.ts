/*
 * Nostra.chat -- Security Settings UI
 *
 * Settings > Security tab: PIN/passphrase key protection,
 * seed phrase viewer, and forgot-PIN recovery.
 */

import {SliderSuperTab} from '@components/slider';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import Button from '@components/button';
import {toast} from '@components/toast';
import useNostraIdentity from '@stores/nostraIdentity';
import rootScope from '@lib/rootScope';
import {
  deriveKeyFromPin,
  deriveKeyFromPassphrase,
  encryptKeys,
  decryptKeys,
  loadEncryptedIdentity,
  saveEncryptedIdentity,
  generateBrowserScopedKey,
  saveBrowserKey,
  loadBrowserKey
} from '@lib/nostra/key-storage';
import type {EncryptedIdentityRecord} from '@lib/nostra/key-storage';

export default class AppNostraSecurityTab extends SliderSuperTab {
  private seedContainer: HTMLElement | null = null;
  private seedTimeout: ReturnType<typeof setTimeout> | null = null;

  public init() {
    this.container.classList.add('nostra-security-settings');
    this.setTitle('Security' as any);

    const identity = useNostraIdentity();

    // Section 1: Key Protection
    const protectionSection = new SettingSection({
      name: 'Key Protection' as any,
      caption: 'Choose how to protect your private keys' as any
    });

    const currentType = identity.protectionType();

    // Protection type options
    const options: Array<{label: string; value: 'none' | 'pin' | 'passphrase'}> = [
      {label: 'None (browser-scoped)', value: 'none'},
      {label: 'PIN (4-6 digits)', value: 'pin'},
      {label: 'Passphrase', value: 'passphrase'}
    ];

    const radioGroup = document.createElement('div');
    radioGroup.classList.add('protection-radio-group');

    for(const option of options) {
      const row = new Row({
        title: option.label,
        clickable: true,
        checkboxField: {
          round: true,
          name: 'protectionType',
          checked: currentType === option.value
        } as any
      });

      attachClickEvent(row.container, () => {
        this.handleProtectionChange(option.value, currentType);
      }, {listenerSetter: this.listenerSetter});

      radioGroup.append(row.container);
    }

    protectionSection.content.append(radioGroup);

    // Section 2: Seed Phrase Viewer
    const seedSection = new SettingSection({
      name: 'Seed Phrase' as any,
      caption: 'Your 12-word recovery phrase. Store it securely.' as any
    });

    this.seedContainer = document.createElement('div');
    this.seedContainer.classList.add('seed-phrase-container');
    this.seedContainer.style.display = 'none';

    const viewSeedBtn = Button('btn-primary btn-color-primary');
    viewSeedBtn.textContent = 'View Seed Phrase';
    attachClickEvent(viewSeedBtn, () => {
      this.handleViewSeed(identity.protectionType());
    }, {listenerSetter: this.listenerSetter});

    seedSection.content.append(viewSeedBtn, this.seedContainer);

    // Section 3: Recovery
    const recoverySection = new SettingSection({
      name: 'Recovery' as any
    });

    const forgotRow = new Row({
      title: 'Forgot PIN/Passphrase?',
      subtitle: 'Recover access using your seed phrase',
      clickable: true
    });

    attachClickEvent(forgotRow.container, () => {
      this.handleForgotPin();
    }, {listenerSetter: this.listenerSetter});

    recoverySection.content.append(forgotRow.container);

    this.scrollable.append(
      protectionSection.container,
      seedSection.container,
      recoverySection.container
    );
  }

  public onCloseAfterTimeout() {
    super.onCloseAfterTimeout();
    this.hideSeed();
  }

  /**
   * Handle changing protection type.
   * Requires decrypting current keys, then re-encrypting with new protection.
   */
  private async handleProtectionChange(newType: 'none' | 'pin' | 'passphrase', currentType: string): Promise<void> {
    if(newType === currentType) return;

    try {
      const record = await loadEncryptedIdentity();
      if(!record) {
        toast('No identity found');
        return;
      }

      // Step 1: Decrypt current keys
      let decryptedData: {seed: string; nsec: string};

      if(record.protectionType === 'none') {
        const browserKey = await loadBrowserKey();
        if(!browserKey) {
          toast('Browser key not found');
          return;
        }
        decryptedData = await decryptKeys(record.iv, record.encryptedKeys, browserKey);
      } else {
        // Prompt for current PIN/passphrase
        const currentSecret = await this.promptForSecret(record.protectionType);
        if(!currentSecret) return;

        const currentKey = record.protectionType === 'pin' ?
          await deriveKeyFromPin(currentSecret, record.salt!) :
          await deriveKeyFromPassphrase(currentSecret, record.salt!);

        try {
          decryptedData = await decryptKeys(record.iv, record.encryptedKeys, currentKey);
        } catch{
          toast('Incorrect ' + (record.protectionType === 'pin' ? 'PIN' : 'passphrase'));
          return;
        }
      }

      // Step 2: Re-encrypt with new protection
      let newKey: CryptoKey;
      let newSalt: Uint8Array | undefined;

      if(newType === 'none') {
        newKey = await generateBrowserScopedKey();
        await saveBrowserKey(newKey);
      } else if(newType === 'pin') {
        const pin = await this.promptForNewPin();
        if(!pin) return;
        newSalt = crypto.getRandomValues(new Uint8Array(16));
        newKey = await deriveKeyFromPin(pin, newSalt);
      } else {
        const passphrase = await this.promptForNewPassphrase();
        if(!passphrase) return;
        newSalt = crypto.getRandomValues(new Uint8Array(16));
        newKey = await deriveKeyFromPassphrase(passphrase, newSalt);
      }

      const encrypted = await encryptKeys(decryptedData, newKey);

      // Step 3: Save updated record
      const updatedRecord: EncryptedIdentityRecord = {
        ...record,
        protectionType: newType,
        salt: newSalt,
        iv: encrypted.iv,
        encryptedKeys: encrypted.ciphertext
      };

      await saveEncryptedIdentity(updatedRecord);
      rootScope.dispatchEvent('nostra_identity_updated', {protectionType: newType} as any);
      toast('Protection updated to: ' + newType);
    } catch(err) {
      toast('Failed to change protection: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  /**
   * Handle viewing the seed phrase.
   * Requires unlock if PIN/passphrase is active.
   */
  private async handleViewSeed(protectionType: string): Promise<void> {
    try {
      const record = await loadEncryptedIdentity();
      if(!record) {
        toast('No identity found');
        return;
      }

      let decryptedData: {seed: string; nsec: string};

      if(protectionType === 'none') {
        const browserKey = await loadBrowserKey();
        if(!browserKey) {
          toast('Browser key not found');
          return;
        }
        decryptedData = await decryptKeys(record.iv, record.encryptedKeys, browserKey);
      } else {
        const secret = await this.promptForSecret(protectionType);
        if(!secret) return;

        const key = protectionType === 'pin' ?
          await deriveKeyFromPin(secret, record.salt!) :
          await deriveKeyFromPassphrase(secret, record.salt!);

        try {
          decryptedData = await decryptKeys(record.iv, record.encryptedKeys, key);
        } catch{
          toast('Incorrect ' + (protectionType === 'pin' ? 'PIN' : 'passphrase'));
          return;
        }
      }

      this.showSeed(decryptedData.seed);
    } catch(err) {
      toast('Failed to decrypt seed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  /**
   * Display seed phrase words in a numbered grid.
   * Auto-hides after 60 seconds.
   */
  private showSeed(seed: string): void {
    if(!this.seedContainer) return;

    const words = seed.split(' ');
    this.seedContainer.innerHTML = '';
    this.seedContainer.style.display = 'block';

    const grid = document.createElement('div');
    grid.classList.add('seed-word-grid');

    for(let i = 0; i < words.length; i++) {
      const wordEl = document.createElement('div');
      wordEl.classList.add('seed-word');
      wordEl.textContent = `${i + 1}. ${words[i]}`;
      grid.append(wordEl);
    }

    const warning = document.createElement('p');
    warning.classList.add('seed-warning');
    warning.textContent = 'Store this securely. Anyone with this phrase can access your messages.';

    const copyBtn = Button('btn-primary btn-color-primary btn-transparent');
    copyBtn.textContent = 'Copy Seed';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(seed).then(() => {
        toast('Seed phrase copied');
      });
    });

    this.seedContainer.append(grid, warning, copyBtn);

    // Auto-hide after 60 seconds
    this.seedTimeout = setTimeout(() => {
      this.hideSeed();
    }, 60000);
  }

  /**
   * Hide the seed phrase display.
   */
  private hideSeed(): void {
    if(this.seedTimeout) {
      clearTimeout(this.seedTimeout);
      this.seedTimeout = null;
    }
    if(this.seedContainer) {
      this.seedContainer.innerHTML = '';
      this.seedContainer.style.display = 'none';
    }
  }

  /**
   * Handle forgot PIN/passphrase recovery flow.
   * Opens seed phrase import; on valid seed, verify npub matches and reset protection.
   */
  private async handleForgotPin(): Promise<void> {
    const seedInput = await this.promptForSeedPhrase();
    if(!seedInput) return;

    try {
      const record = await loadEncryptedIdentity();
      if(!record) {
        toast('No identity found');
        return;
      }

      // Derive keypair from seed to verify npub match
      const {privateKeyFromSeedWords} = await import('nostr-tools/nip06');
      const {getPublicKey} = await import('nostr-tools/pure');
      const {npubEncode} = await import('nostr-tools/nip19');

      const privateKey = privateKeyFromSeedWords(seedInput);
      const pubkeyHex = getPublicKey(privateKey);
      const derivedNpub = npubEncode(pubkeyHex);

      if(derivedNpub !== record.npub) {
        toast('Seed phrase does not match current identity');
        return;
      }

      // Seed matches: re-encrypt with browser-scoped key (reset to 'none')
      const {nsecEncode} = await import('nostr-tools/nip19');
      const nsec = nsecEncode(privateKey);

      const browserKey = await generateBrowserScopedKey();
      await saveBrowserKey(browserKey);

      const encrypted = await encryptKeys({seed: seedInput, nsec}, browserKey);

      const updatedRecord: EncryptedIdentityRecord = {
        ...record,
        protectionType: 'none',
        salt: undefined,
        iv: encrypted.iv,
        encryptedKeys: encrypted.ciphertext
      };

      await saveEncryptedIdentity(updatedRecord);
      rootScope.dispatchEvent('nostra_identity_updated', {protectionType: 'none'} as any);
      rootScope.dispatchEvent('nostra_identity_unlocked', {npub: record.npub});
      toast('Protection reset successfully. You can set a new PIN in settings.');
    } catch(err) {
      toast('Recovery failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ==================== Prompt Helpers ====================

  /**
   * Prompt user for current PIN or passphrase.
   * Returns the entered secret, or null if cancelled.
   */
  private promptForSecret(type: string): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.classList.add('prompt-overlay');

      const dialog = document.createElement('div');
      dialog.classList.add('prompt-dialog');

      const label = document.createElement('label');
      label.textContent = type === 'pin' ? 'Enter current PIN:' : 'Enter current passphrase:';

      const input = document.createElement('input');
      input.type = type === 'pin' ? 'tel' : 'password';
      input.classList.add('input-clear');
      if(type === 'pin') {
        input.pattern = '[0-9]*';
        input.maxLength = 6;
      }

      const btnRow = document.createElement('div');
      btnRow.classList.add('prompt-buttons');

      const cancelBtn = Button('btn-primary btn-transparent');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });

      const confirmBtn = Button('btn-primary btn-color-primary');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.addEventListener('click', () => {
        const val = input.value.trim();
        overlay.remove();
        resolve(val || null);
      });

      btnRow.append(cancelBtn, confirmBtn);
      dialog.append(label, input, btnRow);
      overlay.append(dialog);
      document.body.append(overlay);
      input.focus();
    });
  }

  /**
   * Prompt user for a new PIN (4-6 digits, with confirmation).
   */
  private promptForNewPin(): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.classList.add('prompt-overlay');

      const dialog = document.createElement('div');
      dialog.classList.add('prompt-dialog');

      const label1 = document.createElement('label');
      label1.textContent = 'Enter new PIN (4-6 digits):';

      const input1 = document.createElement('input');
      input1.type = 'tel';
      input1.pattern = '[0-9]*';
      input1.maxLength = 6;
      input1.classList.add('input-clear');

      const label2 = document.createElement('label');
      label2.textContent = 'Confirm PIN:';

      const input2 = document.createElement('input');
      input2.type = 'tel';
      input2.pattern = '[0-9]*';
      input2.maxLength = 6;
      input2.classList.add('input-clear');

      const error = document.createElement('div');
      error.classList.add('prompt-error');

      const btnRow = document.createElement('div');
      btnRow.classList.add('prompt-buttons');

      const cancelBtn = Button('btn-primary btn-transparent');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });

      const confirmBtn = Button('btn-primary btn-color-primary');
      confirmBtn.textContent = 'Set PIN';
      confirmBtn.addEventListener('click', () => {
        const pin = input1.value.trim();
        const confirm = input2.value.trim();

        if(pin.length < 4 || pin.length > 6) {
          error.textContent = 'PIN must be 4-6 digits';
          return;
        }
        if(!/^\d+$/.test(pin)) {
          error.textContent = 'PIN must contain only digits';
          return;
        }
        if(pin !== confirm) {
          error.textContent = 'PINs do not match';
          return;
        }

        overlay.remove();
        resolve(pin);
      });

      btnRow.append(cancelBtn, confirmBtn);
      dialog.append(label1, input1, label2, input2, error, btnRow);
      overlay.append(dialog);
      document.body.append(overlay);
      input1.focus();
    });
  }

  /**
   * Prompt user for a new passphrase (with confirmation).
   */
  private promptForNewPassphrase(): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.classList.add('prompt-overlay');

      const dialog = document.createElement('div');
      dialog.classList.add('prompt-dialog');

      const label1 = document.createElement('label');
      label1.textContent = 'Enter new passphrase:';

      const input1 = document.createElement('input');
      input1.type = 'password';
      input1.classList.add('input-clear');

      const label2 = document.createElement('label');
      label2.textContent = 'Confirm passphrase:';

      const input2 = document.createElement('input');
      input2.type = 'password';
      input2.classList.add('input-clear');

      const error = document.createElement('div');
      error.classList.add('prompt-error');

      const btnRow = document.createElement('div');
      btnRow.classList.add('prompt-buttons');

      const cancelBtn = Button('btn-primary btn-transparent');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });

      const confirmBtn = Button('btn-primary btn-color-primary');
      confirmBtn.textContent = 'Set Passphrase';
      confirmBtn.addEventListener('click', () => {
        const pp = input1.value;
        const confirm = input2.value;

        if(pp.length < 1) {
          error.textContent = 'Passphrase cannot be empty';
          return;
        }
        if(pp !== confirm) {
          error.textContent = 'Passphrases do not match';
          return;
        }

        overlay.remove();
        resolve(pp);
      });

      btnRow.append(cancelBtn, confirmBtn);
      dialog.append(label1, input1, label2, input2, error, btnRow);
      overlay.append(dialog);
      document.body.append(overlay);
      input1.focus();
    });
  }

  /**
   * Prompt user for seed phrase (12 words).
   */
  private promptForSeedPhrase(): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.classList.add('prompt-overlay');

      const dialog = document.createElement('div');
      dialog.classList.add('prompt-dialog', 'prompt-dialog--wide');

      const label = document.createElement('label');
      label.textContent = 'Enter your 12-word seed phrase:';

      const textarea = document.createElement('textarea');
      textarea.rows = 3;
      textarea.placeholder = 'word1 word2 word3 ... word12';
      textarea.classList.add('input-clear');

      const error = document.createElement('div');
      error.classList.add('prompt-error');

      const btnRow = document.createElement('div');
      btnRow.classList.add('prompt-buttons');

      const cancelBtn = Button('btn-primary btn-transparent');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });

      const confirmBtn = Button('btn-primary btn-color-primary');
      confirmBtn.textContent = 'Recover';
      confirmBtn.addEventListener('click', () => {
        const seed = textarea.value.trim().toLowerCase();
        const words = seed.split(/\s+/);

        if(words.length !== 12) {
          error.textContent = 'Seed phrase must be exactly 12 words';
          return;
        }

        overlay.remove();
        resolve(seed);
      });

      btnRow.append(cancelBtn, confirmBtn);
      dialog.append(label, textarea, error, btnRow);
      overlay.append(dialog);
      document.body.append(overlay);
      textarea.focus();
    });
  }
}
