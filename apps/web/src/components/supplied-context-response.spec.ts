import { describe, expect, it } from 'vitest';
import { parseContextAnswer } from './supplied-context-response';

const valid = {
  mode: 'supplied_context_extracts', status: 'evidence_selected', content: 'source', model: 'model-a',
  sources: [{ id: 'S1', lineStart: 1, lineEnd: 2, text: 'source' }],
  budget: { promptTokenEstimate: 100, contextWindowTokens: 8192 },
};

describe('context answer browser boundary', () => {
  it('accepts explicit source references and not-found responses', () => {
    expect(parseContextAnswer(valid).sources[0]?.text).toBe('source');
    expect(parseContextAnswer({ ...valid, status: 'not_found', sources: [] }).status).toBe('not_found');
  });
  it.each([
    null, { ...valid, mode: 'general' }, { ...valid, sources: [{ id: 'S1', text: 'broken' }] },
    { ...valid, status: 'not_found' }, { ...valid, sources: [] },
    { ...valid, budget: { promptTokenEstimate: NaN, contextWindowTokens: 8192 } },
    { ...valid, sources: [{ id: 'S1', text: 'x', lineStart: 2, lineEnd: 1 }] },
  ])('rejects malformed or inconsistent API responses: %j', (value) => {
    expect(() => parseContextAnswer(value)).toThrow();
  });
});
