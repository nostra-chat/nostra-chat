/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import pause from '@helpers/schedulers/pause';

const ctx = self as any as ServiceWorkerGlobalScope;
export const CACHE_ASSETS_NAME = 'cachedAssets';

function isCorrectResponse(response: Response) {
  return response.ok && response.status === 200;
}

function timeoutRace<T extends Promise<any>>(promise: T) {
  return Promise.race([
    promise,
    pause(10000).then(() => Promise.reject())
  ]);
}

export async function requestCache(event: FetchEvent) {
  try {
    // const cache = await ctx.caches.open(CACHE_ASSETS_NAME);
    const cache = await timeoutRace(ctx.caches.open(CACHE_ASSETS_NAME));
    const file = await timeoutRace(cache.match(event.request, {ignoreVary: true}));

    if(file && isCorrectResponse(file)) {
      return file;
    }

    const headers: HeadersInit = {'Vary': '*'};
    let response = await fetch(event.request, {headers});
    if(isCorrectResponse(response)) {
      cache.put(event.request, response.clone());
    } else if(response.status === 304) { // possible fix for 304 in Safari
      const url = event.request.url.replace(/\?.+$/, '') + '?' + (Math.random() * 100000 | 0);
      response = await fetch(url, {headers});
      if(isCorrectResponse(response)) {
        cache.put(event.request, response.clone());
      }
    }

    return response;
  } catch(err) {
    return fetch(event.request);
  }
}

import {getActiveVersion} from './shell-cache';

async function currentShellCacheName(): Promise<string> {
  const active = await getActiveVersion();
  if(!active) throw new Error('no active version');
  return `shell-v${active.version}`;
}

export async function requestCacheStrict(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(await currentShellCacheName());
  let hit = await cache.match(event.request);
  if(!hit) {
    // Navigation to root or explicit path → fall back to index.html
    const url = new URL(event.request.url);
    if(url.pathname === '/' || event.request.mode === 'navigate') {
      const indexUrl = new URL('./index.html', url).href;
      hit = await cache.match(indexUrl);
    }
  }
  if(hit) return hit;
  const body = '<!DOCTYPE html><meta charset=utf-8><title>Nostra.chat — cache corrupted</title><style>body{font-family:system-ui;padding:2rem;max-width:40rem;margin:auto}button{padding:0.5rem 1rem;font-size:1rem;cursor:pointer}</style><h1>Nostra.chat — cache corrupted</h1><p>An app-shell asset is missing from the local cache. Reinstall the app to continue. Your identity seed is safe.</p><p><strong>Missing:</strong> <code>' + event.request.url + '</code></p><button onclick="caches.keys().then(k=>Promise.all(k.map(c=>caches.delete(c)))).then(()=>navigator.serviceWorker.getRegistration()).then(r=>r&&r.unregister()).then(()=>location.reload())">Reinstall</button>';
  return new Response(body, {status: 503, headers: {'content-type': 'text/html; charset=utf-8'}});
}
