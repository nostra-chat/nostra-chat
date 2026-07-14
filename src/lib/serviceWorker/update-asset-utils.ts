export const SIGNED_UPDATE_CONCURRENCY = 8;
export const UPDATE_PROGRESS_INTERVAL_MS = 100;

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input as any);
  let hex = '';
  for(const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return `sha256-${hex}`;
}

export function manifestAssetUrl(path: string, baseUrl: string): string {
  const encodedPath = path.replace(/#/g, '%23').replace(/\?/g, '%3F');
  return new URL(encodedPath, baseUrl).href;
}

export function responseFromVerifiedBytes(bytes: ArrayBuffer, source: Response): Response {
  return new Response(bytes, {
    status: source.status,
    statusText: source.statusText,
    headers: source.headers
  });
}

export async function runBoundedWorkers(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<void>,
  shouldStop: () => boolean = () => false
): Promise<void> {
  let nextIndex = 0;
  const run = async() => {
    while(!shouldStop()) {
      const index = nextIndex++;
      if(index >= count) return;
      await worker(index);
    }
  };
  const workerCount = Math.min(Math.max(1, concurrency), count);
  const results = await Promise.allSettled(Array.from({length: workerCount}, run));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if(rejected) throw rejected.reason;
}

export interface ProgressReporter {
  report(done: number, total: number): void;
  finish(done: number, total: number): void;
  cancel(): void;
}

export function createProgressReporter(
  callback?: (done: number, total: number) => void,
  intervalMs = UPDATE_PROGRESS_INTERVAL_MS
): ProgressReporter {
  let latest: {done: number; total: number} | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastEmittedAt = 0;

  const flush = () => {
    if(timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if(!latest || !callback) return;
    const value = latest;
    latest = null;
    lastEmittedAt = Date.now();
    callback(value.done, value.total);
  };

  return {
    report(done, total) {
      if(!callback) return;
      latest = {done, total};
      const remaining = intervalMs - (Date.now() - lastEmittedAt);
      if(remaining <= 0) flush();
      else if(timer === undefined) timer = setTimeout(flush, remaining);
    },
    finish(done, total) {
      latest = {done, total};
      flush();
    },
    cancel() {
      latest = null;
      if(timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }
  };
}
