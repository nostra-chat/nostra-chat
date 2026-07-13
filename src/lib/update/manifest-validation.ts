import type {Manifest} from './types';

export const MAX_MANIFEST_FILES = 10_000;
export const MAX_MANIFEST_PATH_LENGTH = 2048;
export const MAX_MANIFEST_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_MANIFEST_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export interface ManifestValidationResult {
  ok: boolean;
  reason?: string;
}

/** A manifest entry is a bundle-relative path, never an origin or traversal. */
export function isSafeManifestPath(path: string): boolean {
  if(typeof path !== 'string' || path.length < 3 || path.length > MAX_MANIFEST_PATH_LENGTH) return false;
  if(!path.startsWith('./') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) return false;
  if(/%(?:2f|2F|5c|5C|00)/.test(path)) return false;
  const segments = path.slice(2).split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function validateUpdateManifest(value: unknown): ManifestValidationResult {
  if(!value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, reason: 'manifest must be an object'};
  const m = value as Partial<Manifest> & Record<string, unknown>;
  if(m.schemaVersion !== 1 && m.schemaVersion !== 2) return {ok: false, reason: `unsupported schemaVersion ${String(m.schemaVersion)}`};
  if(typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(m.version)) {
    return {ok: false, reason: 'invalid version'};
  }
  if(typeof m.gitSha !== 'string' || !/^[a-f0-9]{7,40}$/i.test(m.gitSha)) return {ok: false, reason: 'invalid gitSha'};
  if(typeof m.published !== 'string' || !Number.isFinite(Date.parse(m.published))) return {ok: false, reason: 'invalid published timestamp'};
  if(typeof m.swUrl !== 'string' || !isSafeManifestPath(m.swUrl)) return {ok: false, reason: 'unsafe swUrl'};
  if(!m.bundleHashes || typeof m.bundleHashes !== 'object' || Array.isArray(m.bundleHashes)) {
    return {ok: false, reason: 'invalid bundleHashes'};
  }
  const entries = Object.entries(m.bundleHashes as Record<string, unknown>);
  if(entries.length === 0 || entries.length > MAX_MANIFEST_FILES) return {ok: false, reason: 'invalid bundle file count'};
  for(const [path, hash] of entries) {
    if(!isSafeManifestPath(path)) return {ok: false, reason: `unsafe bundle path: ${path}`};
    if(typeof hash !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(hash)) return {ok: false, reason: `invalid hash: ${path}`};
  }
  if(!(m.swUrl in (m.bundleHashes as Record<string, unknown>))) return {ok: false, reason: 'swUrl is not covered'};
  return {ok: true};
}

export function validateManifestFreshness(published: string, now = Date.now()): ManifestValidationResult {
  const timestamp = Date.parse(published);
  if(!Number.isFinite(timestamp)) return {ok: false, reason: 'invalid published timestamp'};
  if(timestamp > now + MAX_MANIFEST_FUTURE_SKEW_MS) return {ok: false, reason: 'manifest timestamp is too far in the future'};
  if(timestamp < now - MAX_MANIFEST_AGE_MS) return {ok: false, reason: 'manifest is older than 30 days'};
  return {ok: true};
}
