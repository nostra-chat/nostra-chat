import {createEffect, createSignal, onCleanup, onMount, Show} from 'solid-js';
import rootScope from '@lib/rootScope';
import classNames from '@helpers/string/classNames';

type TorState = 'offline' | 'bootstrapping' | 'active' | 'direct' | 'failed';

/**
 * Global startup banner. Mounted once on document.body by nostra-bridge
 * at transport construction time so it is visible before any chat is
 * opened. Renders:
 *   - bootstrapping → dark bar with spinner + Skip button
 *   - failed        → red bar with Retry + "Continue without Tor"
 *   - active        → transient green "Connected via Tor" that fades away
 *   - direct        → hidden (user explicitly chose direct mode)
 *
 * The Skip button opens a confirmation popup that explains the privacy
 * implications before calling confirmDirectFallback.
 */
export default function TorStartupBanner(props: {
  onSkip?: () => void;
  onRetry?: () => void;
  onContinueDirect?: () => void;
}) {
  const [state, setState] = createSignal<TorState>('bootstrapping');
  const [fading, setFading] = createSignal(false);
  const [hidden, setHidden] = createSignal(false);

  const setBannerHeightVar = (px: number) => {
    document.documentElement.style.setProperty('--tor-banner-height', `${px}px`);
  };

  onMount(() => {
    const handler = (e: {state: TorState; error?: string}) => {
      const prev = state();
      setState(e.state);

      // Any transition back into bootstrapping or failed makes the banner
      // visible again after a previous dismissal.
      if(e.state === 'bootstrapping' || e.state === 'failed') {
        setHidden(false);
        setFading(false);
      }

      // Transition to active → show a brief "connected" confirmation then fade out.
      if(e.state === 'active' && (prev === 'bootstrapping' || prev === 'failed' || prev === 'direct')) {
        setFading(false);
        const fadeTimer = setTimeout(() => setFading(true), 2500);
        const hideTimer = setTimeout(() => setHidden(true), 3200);
        onCleanup(() => {
          clearTimeout(fadeTimer);
          clearTimeout(hideTimer);
        });
      }

      // Direct mode is invisible — user already saw the skip confirmation.
      if(e.state === 'direct') {
        setHidden(true);
      }
    };
    rootScope.addEventListener('nostra_tor_state', handler);

    // Seed from whatever state the transport is in right now.
    const t = (window as any).__nostraTransport;
    if(t?.getState) {
      setState(t.getState());
      if(t.getState() === 'direct' || t.getState() === 'active') {
        setHidden(true);
      }
    }

    onCleanup(() => {
      rootScope.removeEventListener('nostra_tor_state', handler);
      setBannerHeightVar(0);
    });
  });

  createEffect(() => {
    // Track reactive deps so we re-measure on state/visibility changes.
    const _hidden = hidden();
    const _state = state();
    const _fading = fading();
    if(_hidden) {
      setBannerHeightVar(0);
      return;
    }
    // During the fade-out we keep the reserved space pinned so the UI doesn't
    // jump before the banner finishes its opacity transition.
    if(_fading) return;
    // Measure on next frame so Solid has mounted the new DOM.
    requestAnimationFrame(() => {
      if(hidden()) return;
      const el = document.querySelector<HTMLElement>('.tor-startup-banner');
      const h = el?.getBoundingClientRect().height ?? 0;
      if(h > 0) setBannerHeightVar(h);
    });
  });

  return (
    <Show when={!hidden()}>
      <Show when={state() === 'bootstrapping'}>
        <div class="tor-startup-banner tor-startup-banner--bootstrap">
          <div class="tor-startup-banner__inner">
            <span class="tor-startup-banner__spinner" aria-hidden="true"></span>
            <span class="tor-startup-banner__text">
              Connecting via Tor to hide your IP from relays…
            </span>
            <button
              type="button"
              class="tor-startup-banner__btn tor-startup-banner__btn--ghost"
              onClick={() => props.onSkip?.()}
            >
              Skip
            </button>
          </div>
        </div>
      </Show>

      <Show when={state() === 'failed'}>
        <div class="tor-startup-banner tor-startup-banner--failed">
          <div class="tor-startup-banner__inner">
            <span class="tor-startup-banner__text">
              Tor failed to connect. Retry or continue without Tor?
            </span>
            <button
              type="button"
              class="tor-startup-banner__btn tor-startup-banner__btn--ghost"
              onClick={() => props.onRetry?.()}
            >
              Retry
            </button>
            <button
              type="button"
              class="tor-startup-banner__btn tor-startup-banner__btn--warning"
              onClick={() => props.onContinueDirect?.()}
            >
              Continue without Tor
            </button>
          </div>
        </div>
      </Show>

      <Show when={state() === 'active'}>
        <div
          class={classNames(
            'tor-startup-banner',
            'tor-startup-banner--active',
            fading() && 'tor-startup-banner--fading'
          )}
        >
          <div class="tor-startup-banner__inner">
            <span class="tor-startup-banner__text">Connected via Tor</span>
          </div>
        </div>
      </Show>
    </Show>
  );
}
