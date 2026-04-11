import {JSX, For} from 'solid-js';
import classNames from '@helpers/string/classNames';

export interface RelayStateInfo {
  url: string;
  connected: boolean;
  latencyMs: number;
  read: boolean;
  write: boolean;
}

type TorState = 'bootstrapping' | 'active' | 'direct' | 'failed';

const STATE_LABELS: Record<TorState, {text: string; color: string}> = {
  active: {text: 'Attivo', color: 'green'},
  bootstrapping: {text: 'Bootstrap...', color: 'yellow'},
  direct: {text: 'Diretto', color: 'yellow'},
  failed: {text: 'Errore', color: 'red'}
};

export default function TorStatus(props: {
  relayStates: RelayStateInfo[];
  torState: TorState;
  onClose: () => void;
}): JSX.Element {
  const stateInfo = () => STATE_LABELS[props.torState] || STATE_LABELS.failed;

  const dotClass = (relay: RelayStateInfo) => {
    if(!relay.connected) return 'tor-status-dot--red';
    if(relay.latencyMs > 1000) return 'tor-status-dot--yellow';
    return 'tor-status-dot--green';
  };

  return (
    <div class="tor-popup-overlay" onClick={() => props.onClose()}>
      <div
        class={classNames('tor-popup', 'tor-status-popup')}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="tor-popup__title">Stato Tor</div>
        <div class="tor-popup__body">
          <span
            class={classNames('tor-status-dot', `tor-status-dot--${stateInfo().color}`)}
            style={{'margin-right': '8px'}}
          />
          {stateInfo().text}
        </div>

        <div class="tor-popup__title" style={{'font-size': '15px'}}>
          Relay connessi
        </div>

        <For each={props.relayStates}>
          {(relay) => (
            <div class="tor-status-relay">
              <span class={classNames('tor-status-dot', dotClass(relay))} />
              <span class="tor-status-url">{relay.url}</span>
              <span class="tor-status-latency">{relay.latencyMs}ms</span>
              <span class="tor-status-badges">
                {relay.read && <span>R</span>}
                {relay.write && <span>W</span>}
              </span>
            </div>
          )}
        </For>

        <div class="tor-popup__actions" style={{'margin-top': '16px'}}>
          <button
            class="tor-popup__btn tor-popup__btn--secondary"
            onClick={() => props.onClose()}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
