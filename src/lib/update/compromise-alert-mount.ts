import type {CompromiseReason} from '@lib/update/types';

export async function mountCompromiseAlert(reason: CompromiseReason): Promise<void> {
  // Stub — full Solid.js implementation in Ship 5. For now a plain DOM overlay
  // so the code path is exercisable and Ship 3 ships self-contained.
  document.body.innerHTML = '';
  const el = document.createElement('div');
  el.setAttribute('role', 'alertdialog');
  el.style.cssText = 'position:fixed;inset:0;background:#1a0808;color:#fff;padding:2rem;font-family:sans-serif;z-index:99999';
  el.innerHTML = `<h1 style="color:#ffcc00">⚠️ Possible compromise detected</h1>
    <p>The app has detected inconsistency in its distribution pipeline.</p>
    <pre style="background:#000;padding:1rem;overflow:auto">${JSON.stringify(reason, null, 2)}</pre>
    <button id="nostra-compromise-close" style="padding:0.5rem 1rem;margin-top:1rem">Close application</button>`;
  document.body.appendChild(el);
  document.getElementById('nostra-compromise-close')?.addEventListener('click', () => {
    try { window.close(); } catch{}
    window.location.href = 'about:blank';
  });
}
