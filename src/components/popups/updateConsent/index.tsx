import {createSignal, Show} from 'solid-js';
import styles from './styles.module.scss';

export interface UpdateConsentProps {
  currentVersion: string;
  newManifest: {
    version: string;
    gitSha: string;
    published: string;
    signingKeyFingerprint: string;
    rotation: null | {newFingerprint: string};
    changelog?: string;
  };
  installedFingerprint: string;
  onAccept: () => Promise<void>;
  onDecline: () => void;
}

export function UpdateConsent(props: UpdateConsentProps) {
  const [busy, setBusy] = createSignal(false);
  const [progress] = createSignal<{done: number; total: number} | null>(null);
  const [error, setError] = createSignal<string>('');

  const keyMatches = () => props.newManifest.signingKeyFingerprint === props.installedFingerprint;
  const isRotation = () => props.newManifest.rotation !== null;

  async function accept() {
    setBusy(true);
    setError('');
    try {
      await props.onAccept();
    } catch(e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div class={styles.popup}>
      <h2>Aggiornamento disponibile</h2>
      <dl class={styles.details}>
        <dt>Versione</dt>
        <dd>{props.currentVersion} → {props.newManifest.version}</dd>
        <dt>Commit</dt>
        <dd><a href={`https://github.com/nostra-chat/nostra-chat/commit/${props.newManifest.gitSha}`} target='_blank' rel='noopener'>{props.newManifest.gitSha.slice(0, 7)}</a></dd>
        <dt>Data</dt>
        <dd>{new Date(props.newManifest.published).toLocaleDateString()}</dd>
        <dt>Chiave di firma</dt>
        <dd>
          <code>{props.newManifest.signingKeyFingerprint}</code>
          <Show when={keyMatches()}><span class={styles.ok}> ✓ stesso di installato</span></Show>
        </dd>
        <Show when={isRotation()}>
          <dt>Rotazione chiave</dt>
          <dd class={styles.warn}>Questa release ruota la chiave di firma a <code>{props.newManifest.rotation!.newFingerprint}</code></dd>
        </Show>
      </dl>
      <Show when={props.newManifest.changelog}>
        <details class={styles.changelog}>
          <summary>Release notes</summary>
          <pre>{props.newManifest.changelog}</pre>
        </details>
      </Show>
      <Show when={progress()}>
        <progress value={progress()!.done} max={progress()!.total} />
        <p>{progress()!.done}/{progress()!.total} chunks verificati</p>
      </Show>
      <Show when={error()}>
        <p class={styles.error}>{error()}</p>
      </Show>
      <div class={styles.actions}>
        <button disabled={busy()} onClick={() => props.onDecline()}>Ignora</button>
        <button disabled={busy()} class={styles.primary} onClick={accept}>{busy() ? 'Applicando...' : 'Accetta'}</button>
      </div>
    </div>
  );
}
