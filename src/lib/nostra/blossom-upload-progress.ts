/*
 * Nostra.chat — Blossom upload with progress + abort
 *
 * XHR-based variant of blossom-upload.ts used by media send (voice/image/file).
 * Emits progress via callback and supports AbortSignal. Same NIP-24242 auth,
 * same fallback chain. Signs a fresh auth event per server attempt.
 */

import {finalizeEvent} from 'nostr-tools/pure';

export const BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://cdn.satellite.earth',
  'https://blossom.band'
] as const;

export interface BlossomUploadProgressResult {
  url: string;
  sha256: string;
}

export interface BlossomUploadProgressOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for(let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Returns a synchronous sha256 string when running under Node.js (test/SSR env),
// or null when the fast path is unavailable. The Node path avoids the extra
// event-loop turns that jsdom's FileReader-backed Blob.arrayBuffer() introduces.
function sha256HexSync(blob: Blob): string | null {
  // Access jsdom's internal Buffer (available when vitest runs under jsdom)
  const syms = Object.getOwnPropertySymbols(blob);
  const implSym = syms.find(s => s.toString() === 'Symbol(impl)');
  if(implSym) {
    const buf: unknown = (blob as any)[implSym]?._buffer;
    // Buffer.isBuffer is more reliable than instanceof Uint8Array across jsdom/Node contexts
    if(typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
      try {
        const nc = require('crypto') as typeof import('crypto');
        return nc.createHash('sha256').update(buf as any).digest('hex');
      } catch{}
    }
  }
  return null;
}

async function sha256HexAsync(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for(let i = 0; i < digest.length; i++) s += digest[i].toString(16).padStart(2, '0');
  return s;
}

function sha256Hex(blob: Blob): string | Promise<string> {
  return sha256HexSync(blob) ?? sha256HexAsync(blob);
}

function signAuth(privkeyHex: string, hash: string): string {
  const privkey = hexToBytes(privkeyHex);
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const event = finalizeEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    content: 'Upload media',
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', expiration.toString()]
    ]
  }, privkey);
  return 'Nostr ' + btoa(JSON.stringify(event));
}

function putWithProgress(
  server: string,
  blob: Blob,
  authHeader: string,
  onProgress: ((p: number) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<BlossomUploadProgressResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const onAbort = () => {
      try { xhr.abort(); } catch{}
      reject(new Error('upload aborted'));
    };

    if(signal) {
      if(signal.aborted) {
        reject(new Error('upload aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, {once: true});
    }

    xhr.upload.onprogress = (e: any) => {
      if(!e.lengthComputable || !onProgress) return;
      const p = Math.max(0, Math.min(100, Math.floor((e.loaded / e.total) * 100)));
      onProgress(p);
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if(xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`${server}: HTTP ${xhr.status}`));
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText);
        if(!data.url) {
          reject(new Error(`${server}: no url in response`));
          return;
        }
        resolve({url: data.url, sha256: data.sha256 || ''});
      } catch(err) {
        reject(new Error(`${server}: invalid JSON`));
      }
    };

    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`${server}: network error`));
    };

    xhr.open('PUT', server + '/upload');
    xhr.setRequestHeader('Authorization', authHeader);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.send(blob);
  });
}

export async function uploadToBlossomWithProgress(
  blob: Blob,
  privkeyHex: string,
  options: BlossomUploadProgressOptions
): Promise<BlossomUploadProgressResult> {
  const hash = await sha256Hex(blob);
  const errors: string[] = [];
  for(const server of BLOSSOM_SERVERS) {
    if(options.signal?.aborted) throw new Error('upload aborted');
    const authHeader = signAuth(privkeyHex, hash);
    try {
      const result = await putWithProgress(server, blob, authHeader, options.onProgress, options.signal);
      return result;
    } catch(err) {
      const msg = err instanceof Error ? err.message : String(err);
      if(msg === 'upload aborted') throw err;
      errors.push(msg);
    }
  }
  throw new Error(`all blossom servers failed: ${errors.join('; ')}`);
}
