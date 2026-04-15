import {JSX, For, createSignal, onMount, onCleanup} from 'solid-js';
import classNames from '@helpers/string/classNames';
import appSidebarLeft from '@components/sidebarLeft';

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

  const [liveStates, setLiveStates] = createSignal<RelayStateInfo[]>(props.relayStates);
  const states = () => liveStates();

  const refresh = () => {
    const pool = (window as any).__nostraPool;
    if(!pool) return;
    try {
      pool.measureAll?.();
    } catch{}
    setTimeout(() => {
      try {
        const next = pool.getRelayStates?.();
        if(Array.isArray(next)) setLiveStates(next);
      } catch{}
    }, 600);
  };

  onMount(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    onCleanup(() => clearInterval(id));
  });

  const dotClass = (relay: RelayStateInfo) => {
    if(!relay.connected) return 'tor-status-dot--red';
    if(relay.latencyMs > 1000) return 'tor-status-dot--yellow';
    if(relay.latencyMs < 0) return 'tor-status-dot--yellow';
    return 'tor-status-dot--green';
  };

  const formatLatency = (relay: RelayStateInfo) => {
    if(!relay.connected) return 'n/a';
    if(relay.latencyMs < 0) return '…';
    return `${relay.latencyMs}ms`;
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

        <For each={states()}>
          {(relay) => (
            <div class="tor-status-relay">
              <span class={classNames('tor-status-dot', dotClass(relay))} />
              <span class="tor-status-url">{relay.url}</span>
              <span class="tor-status-latency">{formatLatency(relay)}</span>
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
          <button
            class="tor-popup__btn tor-popup__btn--link"
            onClick={() => {
              props.onClose();
              import('@components/sidebarLeft/tabs/nostraTorDashboard').then(({default: AppNostraTorDashboardTab}) => {
                appSidebarLeft.createTab(AppNostraTorDashboardTab).open();
              });
            }}
          >
            View circuit details
          </button>
        </div>
      </div>
    </div>
  );
}
