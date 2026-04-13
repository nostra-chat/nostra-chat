import {JSX} from 'solid-js';

/**
 * Confirmation popup shown when the user clicks Skip on the Tor startup
 * banner. Spells out the privacy trade-off, points at Settings for the
 * permanent disable toggle, and calls onConfirm only after an explicit
 * destructive action.
 */
export default function TorStartupSkipConfirm(props: {
  onCancel: () => void;
  onConfirm: () => void;
  onOpenSettings?: () => void;
}): JSX.Element {
  // NOTE: do NOT attach stopPropagation via Solid onClick on the overlay or
  // popup container. Solid uses document-level event delegation; if a
  // synthetic handler on an ancestor stops propagation, descendant handlers
  // (the Cancel / Continue buttons) never fire. The modal stays open purely
  // because the buttons are the only interactive elements inside — there is
  // no dismiss-on-outside-click behaviour to protect against.
  return (
    <div class="tor-popup-overlay">
      <div class="tor-popup tor-startup-skip-popup">
        <div class="tor-popup__title">Continue without Tor?</div>
        <div class="tor-popup__body">
          <p>
            Your IP address will be visible to the Nostr relays you connect to.
            Messages stay end-to-end encrypted, but relays can log your network
            location alongside the encrypted blobs you send and receive.
          </p>
          <p>
            This choice only applies to this session. Next launch will try Tor
            again automatically.
          </p>
          <p>
            If Tor isn't working on this network,{' '}
            <a
              href="#"
              class="tor-startup-skip-popup__settings-link"
              onClick={(e) => {
                e.preventDefault();
                props.onOpenSettings?.();
              }}
            >
              disable it permanently in Settings → Privacy &amp; Security
            </a>.
          </p>
        </div>
        <div class="tor-popup__actions">
          <button
            type="button"
            class="tor-popup__btn tor-popup__btn--secondary"
            onClick={() => props.onCancel()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="tor-popup__btn tor-popup__btn--warning"
            onClick={() => props.onConfirm()}
          >
            Continue without Tor
          </button>
        </div>
      </div>
    </div>
  );
}
