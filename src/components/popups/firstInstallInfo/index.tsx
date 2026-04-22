import {createSignal, Show} from 'solid-js';

export interface FirstInstallInfoProps {
  fingerprint: string;
  version: string;
  onDismiss: () => void;
}

const S = {
  popup: 'max-width:32rem;width:100%;padding:1.5rem;background:var(--body-background-color,#2a2a2a);color:var(--primary-text-color,#fff);border-radius:0.75rem;box-shadow:0 8px 32px rgba(0,0,0,0.4)',
  h2: 'margin:0 0 1rem 0;font-size:1.25rem;font-weight:600',
  p: 'margin:0 0 1rem 0;font-size:0.95rem;line-height:1.5',
  code: 'font-family:ui-monospace,monospace;font-size:0.85rem;padding:0.1rem 0.3rem;background:rgba(255,255,255,0.08);border-radius:0.25rem;word-break:break-all',
  details: 'margin:0 0 1rem 0;font-size:0.9rem;color:var(--secondary-text-color,#999);line-height:1.5',
  link: 'color:var(--primary-color,#8774e1);text-decoration:none',
  actions: 'display:flex;justify-content:flex-end;margin-top:1.5rem',
  btnPrimary: 'padding:0.6rem 1.25rem;border:none;border-radius:0.5rem;font-size:0.95rem;cursor:pointer;background:var(--primary-color,#8774e1);color:#fff;font-weight:600',
  toggle: 'background:transparent;color:var(--primary-color,#8774e1);border:none;padding:0;font-size:0.9rem;cursor:pointer;text-decoration:underline'
};

export function FirstInstallInfo(props: FirstInstallInfoProps) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div style={S.popup}>
      <h2 style={S.h2}>Installazione completata</h2>
      <p style={S.p}>
        Nostra.chat v{props.version} è stato installato con chiave di firma <code style={S.code}>{props.fingerprint}</code>.
      </p>
      <p style={S.p}>
        Future aggiornamenti richiederanno il tuo consenso esplicito prima di essere applicati.
      </p>
      <button type='button' style={S.toggle} onClick={() => setExpanded(!expanded())}>
        {expanded() ? 'Nascondi dettagli' : 'Mostra dettagli'}
      </button>
      <Show when={expanded()}>
        <p style={S.details}>
          La tua copia di Nostra.chat è bloccata a questa versione. Il browser non scaricherà nuovo codice automaticamente. Quando un aggiornamento sarà disponibile, vedrai un popup che ti chiederà conferma. Puoi verificare la chiave di firma su <a style={S.link} href='https://github.com/nostra-chat/nostra-chat' target='_blank' rel='noopener'>GitHub</a>.
        </p>
      </Show>
      <div style={S.actions}>
        <button type='button' style={S.btnPrimary} onClick={() => props.onDismiss()}>OK</button>
      </div>
    </div>
  );
}

const FIRST_INSTALL_SEEN = 'nostra.update.first-install-seen';

export function shouldShowFirstInstall(): boolean {
  return !localStorage.getItem(FIRST_INSTALL_SEEN);
}

export function markFirstInstallSeen(): void {
  localStorage.setItem(FIRST_INSTALL_SEEN, '1');
}
