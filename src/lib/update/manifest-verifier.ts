import type {Manifest, IntegrityResult, IntegrityVerdict} from '@lib/update/types';
import {updateTransport} from '@lib/update/update-transport';

interface ManifestSource {
  name: string;
  url: string;
}

export const MANIFEST_SOURCES: ManifestSource[] = [
  {name: 'cdn', url: '/update-manifest.json'},
  {name: 'github-release', url: 'https://github.com/nostra-chat/nostra-chat/releases/latest/download/manifest.json'},
  {name: 'ipfs', url: 'https://ipfs.nostra.chat/manifest.json'}
];

const SUPPORTED_SCHEMA = 1;

async function fetchOne(source: ManifestSource): Promise<Manifest> {
  const res = await updateTransport.fetch(source.url, {cache: 'no-store'});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = await res.json() as Manifest;
  if(m.schemaVersion !== SUPPORTED_SCHEMA) {
    throw new Error(`unsupported schemaVersion ${m.schemaVersion}`);
  }
  if(!m.version || !m.swUrl || !m.bundleHashes || !m.bundleHashes[m.swUrl]) {
    throw new Error('malformed manifest');
  }
  return m;
}

function keyFields(m: Manifest): string {
  return JSON.stringify({
    version: m.version,
    gitSha: m.gitSha,
    swUrl: m.swUrl,
    swHash: m.bundleHashes[m.swUrl]
  });
}

export async function verifyManifestsAcrossSources(): Promise<IntegrityResult> {
  const results = await Promise.allSettled(MANIFEST_SOURCES.map(fetchOne));

  const sourcesBreakdown: IntegrityResult['sources'] = MANIFEST_SOURCES.map((src, i) => {
    const r = results[i];
    if(r.status === 'fulfilled') {
      const m = r.value;
      return {name: src.name, status: 'ok', version: m.version, gitSha: m.gitSha, swUrl: m.swUrl};
    }
    return {name: src.name, status: 'error', error: String((r.reason as Error)?.message || r.reason)};
  });

  const ok = results
  .map((r, i) => r.status === 'fulfilled' ? {source: MANIFEST_SOURCES[i].name, manifest: r.value} : null)
  .filter((x): x is {source: string; manifest: Manifest} => x !== null);

  const checkedAt = Date.now();

  if(ok.length === 0) {
    return {verdict: 'offline', sources: sourcesBreakdown, checkedAt};
  }

  if(ok.length === 1) {
    return {verdict: 'insufficient', sources: sourcesBreakdown, checkedAt};
  }

  const byKey = new Map<string, Manifest>();
  for(const {manifest} of ok) {
    byKey.set(keyFields(manifest), manifest);
  }

  if(byKey.size > 1) {
    return {verdict: 'conflict', sources: sourcesBreakdown, checkedAt};
  }

  const agreed = ok[0].manifest;
  const verdict: IntegrityVerdict = ok.length >= 3 ? 'verified' : 'verified-partial';
  return {verdict, manifest: agreed, sources: sourcesBreakdown, checkedAt};
}
