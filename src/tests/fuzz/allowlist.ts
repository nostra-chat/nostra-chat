/**
 * Known-benign console messages. Anything matching these patterns is filtered
 * out before INV-console-clean evaluates.
 *
 * Additions to this list are a policy decision — each new entry should cite
 * why the noise is benign (dev-only, informational, transient).
 *
 * Keep patterns narrow: prefer matching the specific logger prefix + a
 * substring, rather than broad wildcards. Overly-broad entries silence real
 * bugs.
 */

export const CONSOLE_ALLOWLIST: readonly RegExp[] = [
  // Vite dev server (not our code)
  /\[vite\]/i,
  /\[HMR\]/i,

  // Chromium internal warnings
  /DevTools/,

  // ServiceWorker installation logs — safe and one-shot
  /ServiceWorker registration successful/,
  /SW installed, waiting/i,

  // Nostra.chat informational loggers — NOT errors, they log in info/log channel
  /\[NostraSync\] buffer size \d+/,
  /\[NostraOnboarding\] kind 0 publish/,
  /\[ChatAPI\] subscription active/,
  /\[NostrRelay\] connected to/,

  // Playwright emits console.log of Playwright events when headed
  /pw:/,

  // Chromium headless: Push API unavailable because notification permission is
  // denied by default in headless mode. Benign in fuzz context; the real app
  // path handles permission-denied gracefully.
  /\[PUSH-API\] the user has blocked notifications/,

  // Nostra's internal logger prints informational messages at console.warn
  // level with the shape "%s [<elapsed>] [<MODULE-TAG>] …". Treating ALL
  // warnings as errors was too aggressive — modules like [MP-MTPROTO],
  // [ChatAPI], [NostraSync] routinely log state transitions via warn. Real
  // warnings from browser APIs come without the timing prefix and the
  // uppercased MODULE-TAG shape, and real errors fire as console.error /
  // pageerror which we keep flagging.
  /^\[warning\] %s \[\d+\.\d+\] \[[A-Z][A-Z0-9-]+\]/
];

/**
 * Returns true if the message is in the allowlist (i.e. should be ignored).
 */
export function isAllowlisted(message: string): boolean {
  return CONSOLE_ALLOWLIST.some((re) => re.test(message));
}
