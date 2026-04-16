import {createSignal, Show} from 'solid-js';
import {render} from 'solid-js/web';
import type {CompromiseReason} from '@lib/update/types';
import styles from './index.module.scss';

function CompromiseAlertView(props: {reason: CompromiseReason}) {
  const [expanded, setExpanded] = createSignal(false);
  const onClose = () => {
    try { window.close(); } catch{}
    window.location.href = 'about:blank';
  };
  return (
    <div class={styles.overlay} role="alertdialog" aria-live="assertive">
      <div class={styles.content}>
        <div class={styles.icon}>\u26a0\ufe0f</div>
        <h1 class={styles.title}>Possibile compromissione rilevata</h1>
        <p class={styles.body}>
          Il sistema di distribuzione dell'app sta servendo contenuto diverso da quello previsto.
          Per sicurezza, l'applicazione è stata bloccata.
        </p>
        <div class={styles.details}>
          <div class={styles.detailsToggle} onClick={() => setExpanded(!expanded())}>
            {expanded() ? '\u25be' : '\u25b8'} Mostra dettagli tecnici
          </div>
          <Show when={expanded()}>
            <pre class={styles.detailsContent}>{JSON.stringify(props.reason, null, 2)}</pre>
          </Show>
        </div>
        <ul class={styles.todoList}>
          <li>Chiudi l'app e riprova più tardi</li>
          <li>Verifica la versione su github.com/nostra-chat/nostra-chat</li>
          <li>Non inserire password o dati sensibili</li>
        </ul>
        <button class={styles.closeButton} onClick={onClose} ref={(el) => setTimeout(() => el?.focus(), 0)}>
          Chiudi applicazione
        </button>
      </div>
    </div>
  );
}

export function mountCompromiseAlert(reason: CompromiseReason): void {
  document.body.innerHTML = '';
  render(() => <CompromiseAlertView reason={reason} />, document.body);
}
