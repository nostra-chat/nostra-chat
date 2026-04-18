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
  // [ChatAPI], [NostraSync], [IDB-tweb-common] routinely log state transitions
  // via warn. Real warnings from browser APIs come without the timing prefix
  // and module-tag shape, and real errors fire as console.error / pageerror
  // which we keep flagging. Tag allows mixed-case because some modules use
  // kebab-case with lowercase segments (e.g. `IDB-tweb-common`).
  /^\[warning\] %s \[\d+\.\d+\] \[[A-Za-z][A-Za-z0-9-]+\]/,

  // SolidJS dev-only developer warning for signals created outside a
  // reactive root. Emitted only by the dev build (`pnpm start`) — production
  // builds have these warnings stripped. For the fuzzer's --backend=local
  // mode (dev-server only) this is unavoidable noise; the production path is
  // checked separately in --backend=real runs (Phase 3).
  /computations created outside a `createRoot` or `render`/
];

/**
 * Returns true if the message is in the allowlist (i.e. should be ignored).
 */
export function isAllowlisted(message: string): boolean {
  return CONSOLE_ALLOWLIST.some((re) => re.test(message));
}
