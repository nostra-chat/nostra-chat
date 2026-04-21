import {createSignal, Show} from 'solid-js';

const FIRST_INSTALL_SEEN = 'nostra.update.first-install-seen';

export function FirstInstallInfo(props: {fingerprint: string; version: string; onDismiss: () => void}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <div style='position:fixed;top:0;left:0;right:0;background:var(--primary-color);color:#fff;padding:0.75rem 1rem;z-index:9999;font-size:0.9rem;display:flex;gap:1rem;align-items:center'>
      <span>Nostra.chat v{props.version} installato con chiave <code>{props.fingerprint}</code>. Future aggiornamenti richiederanno il tuo consenso.</span>
      <button onClick={() => setExpanded(!expanded())} style='background:transparent;color:#fff;border:1px solid #fff;padding:0.25rem 0.5rem'>{expanded() ? 'Nascondi' : 'Dettagli'}</button>
      <button onClick={() => { localStorage.setItem(FIRST_INSTALL_SEEN, '1'); props.onDismiss(); }} style='background:#fff;color:var(--primary-color);border:0;padding:0.25rem 0.75rem;border-radius:0.25rem'>OK</button>
      <Show when={expanded()}>
        <div style='position:absolute;top:100%;left:1rem;right:1rem;background:#fff;color:#000;padding:1rem;border-radius:0.5rem;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:0.85rem;max-width:40rem;margin:auto'>
          La tua copia di Nostra.chat è bloccata a questa versione. Il browser non scaricherà nuovo codice automaticamente. Quando un aggiornamento sarà disponibile, vedrai un popup che ti chiederà conferma. Puoi verificare la chiave di firma su <a href='https://github.com/nostra-chat/nostra-chat' target='_blank' rel='noopener'>GitHub</a>.
        </div>
      </Show>
    </div>
  );
}

export function shouldShowFirstInstall(): boolean {
  return !localStorage.getItem(FIRST_INSTALL_SEEN);
}
