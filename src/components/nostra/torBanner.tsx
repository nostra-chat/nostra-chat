import {createSignal, onMount, onCleanup, Show} from 'solid-js';
import classNames from '@helpers/string/classNames';
import rootScope from '@lib/rootScope';

type TorState = 'bootstrapping' | 'active' | 'direct' | 'failed';

const DISMISS_KEY = 'nostra_direct_banner_dismissed';

export default function TorBanner(props: {
  onRetryTor?: () => void;
}) {
  const [state, setState] = createSignal<TorState>('bootstrapping');
  const [prevState, setPrevState] = createSignal<TorState | null>(null);
  const [dismissed, setDismissed] = createSignal(
    sessionStorage.getItem(DISMISS_KEY) === '1'
  );
  const [fading, setFading] = createSignal(false);
  const [showReconnected, setShowReconnected] = createSignal(false);

  onMount(() => {
    const handler = (e: {state: TorState; error?: string}) => {
      const prev = state();
      setPrevState(prev);
      setState(e.state);

      // Reset dismiss when state changes away from direct
      if(e.state !== 'direct') {
        setDismissed(false);
        sessionStorage.removeItem(DISMISS_KEY);
      }

      // Show reconnected banner when transitioning from direct to active
      if(e.state === 'active' && prev === 'direct') {
        setShowReconnected(true);
        setFading(false);
        const fadeTimer = setTimeout(() => {
          setFading(true);
        }, 2500);
        const hideTimer = setTimeout(() => {
          setShowReconnected(false);
        }, 3000);
        onCleanup(() => {
          clearTimeout(fadeTimer);
          clearTimeout(hideTimer);
        });
      }
    };
    rootScope.addEventListener('nostra_tor_state', handler);
    onCleanup(() => {
      rootScope.removeEventListener('nostra_tor_state', handler);
    });
  });

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, '1');
  };

  return (
    <>
      <Show when={state() === 'bootstrapping'}>
        <div class={classNames('tor-banner', 'tor-banner--bootstrap')}>
          <span class="tor-banner__text">Avvio di Tor...</span>
        </div>
      </Show>

      <Show when={state() === 'direct' && !dismissed()}>
        <div class={classNames('tor-banner', 'tor-banner--direct')}>
          <span class="tor-banner__text">
            Connessione diretta - IP visibile ai relay
          </span>
          <button
            class="tor-banner__retry-btn"
            onClick={() => props.onRetryTor?.()}
          >
            Riprova Tor
          </button>
          <button
            class="tor-banner__dismiss"
            onClick={handleDismiss}
            aria-label="Chiudi"
          >
            &#x2715;
          </button>
        </div>
      </Show>

      <Show when={showReconnected()}>
        <div
          class={classNames(
            'tor-banner',
            'tor-banner--reconnected',
            fading() && 'tor-banner--fading'
          )}
        >
          <span class="tor-banner__text">Connesso via Tor</span>
        </div>
      </Show>
    </>
  );
}
