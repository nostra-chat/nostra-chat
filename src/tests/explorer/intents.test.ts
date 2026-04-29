import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {registry} from '../../../scripts/explorer/intents/registry';

describe('intent registry', () => {
  it('returns an object (catalog grows in subsequent tasks)', () => {
    expect(typeof registry).toBe('object');
  });

  it('every intent has name, area, paramsSchema, description, exec', () => {
    for(const [name, def] of Object.entries(registry)) {
      expect(def.name).toBe(name);
      expect(def.area).toMatch(/^(messaging|profile|media|navigation|settings|network|edge)$/);
      expect(def.paramsSchema).toBeInstanceOf(z.ZodType);
      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(10);
      expect(typeof def.exec).toBe('function');
    }
  });
});
