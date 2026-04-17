import {createSignal, onCleanup, Show} from 'solid-js';
import {render} from 'solid-js/web';
import PopupElement from '@components/popups';
import rootScope from '@lib/rootScope';
import type {Manifest, IntegrityResult, UpdateFlowState} from '@lib/update';
import {getFlowState, startUpdate} from '@lib/update';
import styles from './index.module.scss';

function renderChangelog(md: string): string {
  let html = md
  .replace(/[<>&]/g, (c) => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[c]!))
  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
  .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/(<li>[^]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  return html;
}

export default class UpdateAvailablePopup extends PopupElement {
  private abortController: AbortController;

  constructor(private manifest: Manifest, private integrity: IntegrityResult) {
    super('popup-update-available', {closable: true, body: true});
    this.abortController = new AbortController();
    this._render();
  }

  private _render(): void {
    const [state, setState] = createSignal<UpdateFlowState>(getFlowState());

    const listener = (next: UpdateFlowState) => setState(next);
    rootScope.addEventListener('update_state_changed', listener);
    onCleanup(() => rootScope.removeEventListener('update_state_changed', listener));

    const mount = document.createElement('div');
    this.body.append(mount);

    const self = this;
    render(() => {
      const badgeClass = () => {
        if(self.integrity.verdict === 'verified') return styles.verified;
        if(self.integrity.verdict === 'verified-partial') return styles.partial;
        if(self.integrity.verdict === 'conflict') return styles.conflict;
        return '';
      };
      const badgeText = () => {
        const ok = self.integrity.sources.filter((s) => s.status === 'ok');
        if(self.integrity.verdict === 'verified') return `\u2705 Verificato da ${ok.length} sorgenti: ${ok.map((s) => s.name).join(', ')}`;
        if(self.integrity.verdict === 'verified-partial') return `\u26a0\ufe0f Verificato parzialmente (${ok.length} di ${self.integrity.sources.length})`;
        if(self.integrity.verdict === 'conflict') return '\u274c Incoerenza rilevata tra sorgenti';
        return '';
      };
      const isDownloading = () => state().kind === 'downloading';
      const progressPct = () => {
        const s = state();
        if(s.kind === 'downloading' && s.total > 0) return Math.round((s.completed / s.total) * 100);
        return 0;
      };
      const showButtons = () => state().kind === 'idle' || state().kind === 'available';
      return (
        <div class={styles.popup}>
          <h2 class={styles.title}>Aggiornamento disponibile</h2>
          <p class={styles.version}>versione {self.manifest.version}</p>
          <div class={`${styles.integrityBadge} ${badgeClass()}`}>{badgeText()}</div>
          <div class={styles.divider} />
          <h3>Novità in questa versione</h3>
          <div class={styles.changelogContainer} innerHTML={renderChangelog(self.manifest.changelog)} />
          <Show when={isDownloading()}>
            <div class={styles.progressBar} style={{'--progress': progressPct() + '%'} as any} />
            <p style={{'text-align': 'center'}}>Scaricamento in corso…</p>
          </Show>
          <Show when={showButtons()}>
            <div class={styles.buttons}>
              <button onClick={() => self.hide()}>Più tardi</button>
              <button
                disabled={self.integrity.verdict === 'conflict'}
                onClick={() => {
                  startUpdate(self.manifest, self.abortController).catch((err) => {
                    console.error('[UPDATE] flow failed', err);
                  });
                }}
              >Aggiorna ora</button>
            </div>
          </Show>
        </div>
      );
    }, mount);
  }

  protected onClose(): void {
    this.abortController.abort();
  }
}
