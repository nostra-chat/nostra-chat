import type {IntegritySourceDetail} from '@lib/update/update-baseline';

export type IntegritySourcePresentation = 'agreeing' | 'divergent' | 'error' | 'warning';

function sourceKey(source: IntegritySourceDetail): string {
  return JSON.stringify({
    version: source.version ?? '',
    gitSha: source.gitSha ?? '',
    swUrl: source.swUrl ?? '',
    swHash: source.swHash ?? ''
  });
}

/**
 * Classify source rows independently from transport validity.
 *
 * A valid manifest is green only when at least two valid sources agree with it.
 * If there is no unique consensus (for example two sources disagree), every
 * valid row is a warning. This prevents a valid-but-stale mirror from looking
 * consistent with the release currently served by the other origins.
 */
export function classifyIntegritySources(details: IntegritySourceDetail[]): IntegritySourcePresentation[] {
  const valid = details
  .map((source, index) => ({source, index, key: sourceKey(source)}))
  .filter(({source}) => source.status === 'ok');

  const counts = new Map<string, number>();
  for(const {key} of valid) counts.set(key, (counts.get(key) ?? 0) + 1);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const consensusKey = ranked.length > 0 && ranked[0][1] >= 2 && ranked[0][1] > (ranked[1]?.[1] ?? 0) ?
    ranked[0][0] : undefined;

  return details.map((source) => {
    if(source.status === 'error') return 'error';
    if(source.status !== 'ok') return 'warning';
    return consensusKey && sourceKey(source) === consensusKey ? 'agreeing' : 'divergent';
  });
}
