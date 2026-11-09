export interface ContextSource {
  id: string;
  lineStart: number;
  lineEnd: number;
  text: string;
}

export interface ContextAnswer {
  status: 'evidence_selected' | 'not_found';
  content: string;
  sources: ContextSource[];
  model: string;
  budget: { promptTokenEstimate: number; contextWindowTokens: number };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseContextAnswer(value: unknown): ContextAnswer {
  if (!record(value) || value.mode !== 'supplied_context_extracts'
      || !['evidence_selected', 'not_found'].includes(String(value.status))
      || typeof value.content !== 'string' || typeof value.model !== 'string'
      || !Array.isArray(value.sources) || value.sources.length > 3
      || !record(value.budget) || typeof value.budget.promptTokenEstimate !== 'number'
      || !Number.isFinite(value.budget.promptTokenEstimate) || value.budget.promptTokenEstimate < 0
      || typeof value.budget.contextWindowTokens !== 'number'
      || !Number.isFinite(value.budget.contextWindowTokens) || value.budget.contextWindowTokens <= 0) {
    throw new Error('The API returned an invalid context answer.');
  }
  const sources = value.sources.map((source: unknown): ContextSource => {
    if (!record(source) || typeof source.id !== 'string' || !/^S\d+$/.test(source.id)
        || typeof source.text !== 'string' || typeof source.lineStart !== 'number'
        || !Number.isInteger(source.lineStart) || source.lineStart < 1
        || typeof source.lineEnd !== 'number' || !Number.isInteger(source.lineEnd) || source.lineEnd < source.lineStart) {
      throw new Error('The API returned invalid source references.');
    }
    return { id: source.id, text: source.text, lineStart: source.lineStart, lineEnd: source.lineEnd };
  });
  if ((value.status === 'not_found') !== (sources.length === 0)) {
    throw new Error('The API returned an inconsistent context answer.');
  }
  return {
    status: value.status as ContextAnswer['status'], content: value.content, sources, model: value.model,
    budget: { promptTokenEstimate: value.budget.promptTokenEstimate, contextWindowTokens: value.budget.contextWindowTokens },
  };
}
