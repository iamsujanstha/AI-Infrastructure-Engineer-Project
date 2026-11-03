export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceCompletionInput {
  model: string;
  requestId: string;
  messages: readonly InferenceMessage[];
  maxOutputTokens: number;
}

export interface InferenceProvider {
  listModels(): Promise<readonly string[]>;
  complete(input: InferenceCompletionInput): Promise<string>;
}

export const INFERENCE_PROVIDER = Symbol('INFERENCE_PROVIDER');

export class InferenceUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Inference provider is unavailable', options);
    this.name = 'InferenceUnavailableError';
  }
}

export class InferenceTimeoutError extends Error {
  constructor(options?: ErrorOptions) {
    super('Inference provider request timed out', options);
    this.name = 'InferenceTimeoutError';
  }
}

export class InferenceResponseError extends Error {
  constructor() {
    super('Inference provider returned an invalid response');
    this.name = 'InferenceResponseError';
  }
}
