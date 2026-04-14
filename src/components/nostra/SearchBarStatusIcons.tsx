/**
 * SearchBarStatusIcons — Tor onion + Nostrich relay status indicators
 *
 * Two small SVG icons (16px) on the right side of the search bar input.
 * Colors indicate connection state. Clicking opens the Status page.
 */

import {createSignal, onCleanup, JSX} from 'solid-js';
import rootScope from '@lib/rootScope';

// ─── Types ───────────────────────────────────────────────────────

type TorState = 'active' | 'bootstrap' | 'direct' | 'error';
type RelayState = 'all' | 'partial' | 'none';

// ─── Color mapping ───────────────────────────────────────────────

const TOR_COLORS: Record<TorState, string> = {
  active: '#4caf50',    // green  — circuit ready
  bootstrap: '#f44336', // red    — still bootstrapping (not usable yet)
  direct: '#ff9800',    // orange — clearnet fallback
  error: '#f44336'      // red    — failed/offline
};

const RELAY_COLORS: Record<RelayState, string> = {
  all: '#4caf50',      // green  — every configured relay up
  partial: '#ffeb3b',  // yellow — some but not all
  none: '#f44336'      // red    — zero connected
};

// Map every privacy-transport state to one of our 4 buckets.
// `bootstrapping` / `offline` / `failed` / unknown → red.
function normalizeTorState(raw: string | undefined): TorState {
  switch(raw) {
    case 'active': return 'active';
    case 'direct': return 'direct';
    case 'bootstrap':
    case 'bootstrapping': return 'bootstrap';
    default: return 'error';
  }
}

// ─── SVG Icons ───────────────────────────────────────────────────

function TorOnionIcon(props: {color: string; onClick?: () => void}): JSX.Element {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke={props.color} stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"
      style={{'cursor': 'pointer', 'margin-left': '4px'}}
      onClick={props.onClick}
    >
      <ellipse cx="12" cy="14" rx="4" ry="6" />
      <ellipse cx="12" cy="14" rx="7" ry="9" />
      <ellipse cx="12" cy="14" rx="10" ry="10" />
      <line x1="12" y1="4" x2="12" y2="2" />
      <line x1="10" y1="3" x2="14" y2="3" />
    </svg>
  );
}

// Nostrich ostrich silhouette — the PNG is pre-processed (cropped + alpha
// channel, ~1.5KB). Used as a CSS mask so we can tint it via background-color.
function NostrichIcon(props: {color: string; onClick?: () => void}): JSX.Element {
  return (
    <div
      role="img"
      aria-label="Nostr relay status"
      onClick={props.onClick}
      style={{
        'width': '28px',
        'height': '16px',
        'cursor': 'pointer',
        'margin-left': '0',
        'background-color': props.color,
        '-webkit-mask-image': 'url(assets/img/nostrich.png)',
        'mask-image': 'url(assets/img/nostrich.png)',
        '-webkit-mask-size': 'contain',
        'mask-size': 'contain',
        '-webkit-mask-repeat': 'no-repeat',
        'mask-repeat': 'no-repeat',
        '-webkit-mask-position': 'center',
        'mask-position': 'center'
      }}
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────

export default function SearchBarStatusIcons(props: {
  onTorClick?: () => void;
  onRelayClick?: () => void;
}): JSX.Element {
  // Default both to red — "prove you're connected" rather than the other way.
  const [torState, setTorState] = createSignal<TorState>('error');
  const [relayState, setRelayState] = createSignal<RelayState>('none');

  // Per-URL connection map. `nostra_relay_state` fires once per relay with
  // `{url, connected: boolean}`, so we aggregate here rather than treating
  // `connected` as a count.
  const relayConnections = new Map<string, boolean>();

  const recomputeRelayState = () => {
    const total = relayConnections.size;
    if(total === 0) { setRelayState('none'); return; }
    let up = 0;
    for(const ok of relayConnections.values()) if(ok) up++;
    if(up === 0) setRelayState('none');
    else if(up === total) setRelayState('all');
    else setRelayState('partial');
  };

  const torHandler = (state: any) => {
    const raw = typeof state === 'string' ? state : state?.state;
    setTorState(normalizeTorState(raw));
  };

  const relayHandler = (state: any) => {
    if(!state || typeof state !== 'object' || typeof state.url !== 'string') return;
    relayConnections.set(state.url, !!state.connected);
    recomputeRelayState();
  };

  rootScope.addEventListener('nostra_tor_state', torHandler);
  rootScope.addEventListener('nostra_relay_state', relayHandler);

  onCleanup(() => {
    rootScope.removeEventListener('nostra_tor_state', torHandler);
    rootScope.removeEventListener('nostra_relay_state', relayHandler);
  });

  // Seed from the live pool so the icon is correct on first paint, before
  // any state event fires.
  try {
    const chatAPI = (window as any).__nostraChatAPI;
    const pool = chatAPI?.relayPool;
    if(pool?.relayEntries) {
      for(const entry of pool.relayEntries) {
        relayConnections.set(
          entry.config.url,
          entry.instance?.getState?.() === 'connected'
        );
      }
      recomputeRelayState();
    }
  } catch{}

  // Seed Tor state from the live privacy transport if present.
  try {
    const transport = (window as any).__nostraPrivacyTransport;
    const s = transport?.state ?? transport?.getState?.();
    if(s) setTorState(normalizeTorState(s));
  } catch{}

  return (
    <div
      class="search-bar-status-icons"
      style={{
        'display': 'flex',
        'align-items': 'center',
        'position': 'absolute',
        'right': '36px',
        'top': '50%',
        'transform': 'translateY(-50%)',
        'z-index': '2',
        'pointer-events': 'auto'
      }}
    >
      <TorOnionIcon
        color={TOR_COLORS[torState()]}
        onClick={props.onTorClick}
      />
      <NostrichIcon
        color={RELAY_COLORS[relayState()]}
        onClick={props.onRelayClick}
      />
    </div>
  );
}
