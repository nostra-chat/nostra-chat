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
  active: '#4caf50',    // green
  bootstrap: '#9e9e9e', // gray
  direct: '#ff9800',    // orange
  error: '#f44336'      // red
};

const RELAY_COLORS: Record<RelayState, string> = {
  all: '#4caf50',      // green (>=2 connected)
  partial: '#ffeb3b',  // yellow (1 connected)
  none: '#f44336'      // red (0 connected)
};

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

function NostrichIcon(props: {color: string; onClick?: () => void}): JSX.Element {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke={props.color} stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"
      style={{'cursor': 'pointer', 'margin-left': '4px'}}
      onClick={props.onClick}
    >
      {/* Simplified ostrich/Nostrich outline */}
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9 L12 16" />
      <path d="M8 12 L12 14 L16 12" />
      <path d="M10 16 L8 22" />
      <path d="M14 16 L16 22" />
      <path d="M15 5 L18 3" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export default function SearchBarStatusIcons(props: {
  onTorClick?: () => void;
  onRelayClick?: () => void;
}): JSX.Element {
  const [torState, setTorState] = createSignal<TorState>('direct');
  const [relayState, setRelayState] = createSignal<RelayState>('none');

  // Listen for state change events
  const torHandler = (state: any) => {
    if(typeof state === 'string') {
      setTorState(state as TorState);
    } else if(state?.state) {
      setTorState(state.state as TorState);
    }
  };

  const relayHandler = (state: any) => {
    if(typeof state === 'string') {
      setRelayState(state as RelayState);
    } else if(state?.connected !== undefined) {
      const count = state.connected;
      if(count >= 2) setRelayState('all');
      else if(count >= 1) setRelayState('partial');
      else setRelayState('none');
    }
  };

  rootScope.addEventListener('nostra_tor_state', torHandler);
  rootScope.addEventListener('nostra_relay_state', relayHandler);

  onCleanup(() => {
    rootScope.removeEventListener('nostra_tor_state', torHandler);
    rootScope.removeEventListener('nostra_relay_state', relayHandler);
  });

  // Check initial relay state from ChatAPI
  try {
    const chatAPI = (window as any).__nostraChatAPI;
    const pool = chatAPI?.relayPool;
    if(pool) {
      const connected = pool.getConnectedCount?.() ?? 0;
      if(connected >= 2) setRelayState('all');
      else if(connected >= 1) setRelayState('partial');
    }
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
