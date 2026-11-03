import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppEnvironment } from '../config/environment';
import {
  INFERENCE_PROVIDER,
  InferenceResponseError,
  InferenceTimeoutError,
  InferenceUnavailableError,
} from '../inference/inference-provider';
import type { InferenceMessage, InferenceProvider } from '../inference/inference-provider';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(32_000),
});
const requestSchema = z.object({
  model: z.string().min(1).max(250),
  messages: z.array(messageSchema).min(1).max(100),
});
const CHAT_TEMPLATE_TOKEN_RESERVE = 256;

export interface ChatBudget {
  promptTokenEstimate: number;
  reservedOutputTokens: number;
  contextWindowTokens: number;
  estimator: 'utf8_bytes_plus_256_template_reserve';
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(INFERENCE_PROVIDER) private readonly provider: InferenceProvider,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async listModels(): Promise<{ models: readonly string[]; defaultModel: string | null }> {
    try {
      const models = await this.provider.listModels();
      const configuredDefault = this.config.get('MLX_DEFAULT_MODEL', { infer: true });
      return { models, defaultModel: models.includes(configuredDefault) ? configuredDefault : (models[0] ?? null) };
    } catch (error) {
      this.mapProviderError(error);
    }
  }

  async complete(input: unknown, requestId: string): Promise<{
    model: string;
    content: string;
    budget: ChatBudget;
  }> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Chat request is invalid.');
    const messages = parsed.data.messages;
    if (messages.length % 2 !== 1 || messages.at(-1)?.role !== 'user'
        || messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant'))) {
      throw new BadRequestException('Chat history must alternate user and assistant turns and end with a user message.');
    }

    let models: readonly string[];
    try {
      models = await this.provider.listModels();
    } catch (error) {
      this.mapProviderError(error);
    }
    if (!models.includes(parsed.data.model)) throw new BadRequestException('The selected model is not available from the configured provider.');

    const systemMessage: InferenceMessage = {
      role: 'system',
      content: `The current local date and time is ${new Date().toString()}. Use this value for questions about the current date or time.`,
    };
    const inferenceMessages: InferenceMessage[] = [systemMessage, ...messages];
    const promptTokenEstimate = inferenceMessages.reduce(
      (total, message) => total + Buffer.byteLength(message.content, 'utf8'),
      CHAT_TEMPLATE_TOKEN_RESERVE,
    );
    const reservedOutputTokens = this.config.get('MLX_MAX_OUTPUT_TOKENS', { infer: true });
    const contextWindowTokens = this.config.get('MLX_CONTEXT_WINDOW_TOKENS', { infer: true });
    const budget: ChatBudget = {
      promptTokenEstimate,
      reservedOutputTokens,
      contextWindowTokens,
      estimator: 'utf8_bytes_plus_256_template_reserve',
    };
    if (promptTokenEstimate + reservedOutputTokens > contextWindowTokens) {
      throw new BadRequestException('Conversation exceeds the configured context budget; shorten the prompt or start a new conversation.');
    }

    try {
      const content = await this.provider.complete({
        model: parsed.data.model,
        requestId,
        messages: inferenceMessages,
        maxOutputTokens: reservedOutputTokens,
      });
      return { model: parsed.data.model, content, budget };
    } catch (error) {
      this.mapProviderError(error);
    }
  }

  private mapProviderError(error: unknown): never {
    if (error instanceof InferenceTimeoutError) throw new GatewayTimeoutException('Local model request timed out.');
    if (error instanceof InferenceUnavailableError) throw new ServiceUnavailableException('Local model provider is unavailable. Start the configured model server and retry.');
    if (error instanceof InferenceResponseError) throw new BadGatewayException('Local model provider returned an invalid response.');
    throw new ServiceUnavailableException('Local model provider is unavailable.');
  }
}
