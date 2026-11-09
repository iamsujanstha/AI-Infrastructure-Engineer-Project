import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationRequest {
  @ApiPropertyOptional({ type: String, maxLength: 200, description: 'Optional title; an omitted title is assigned by the service.' })
  title?: string;
}

export class SendConversationTurnRequest {
  @ApiProperty({ type: String, example: 'mlx-community/Qwen3-8B-4bit', maxLength: 250 })
  model!: string;

  @ApiProperty({ type: String, example: 'Explain the request lifecycle.', minLength: 1, maxLength: 32000 })
  content!: string;
}

export class CompletionMessageRequest {
  @ApiProperty({ type: String, enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty({ type: String, minLength: 1, maxLength: 32000 })
  content!: string;
}

export class CompleteRequest {
  @ApiProperty({ type: String, example: 'mlx-community/Qwen3-8B-4bit', maxLength: 250 })
  model!: string;

  @ApiProperty({ type: () => [CompletionMessageRequest], minItems: 1, maxItems: 100 })
  messages!: CompletionMessageRequest[];
}

export class SuppliedContextRequest {
  @ApiProperty({ type: String, maxLength: 250, description: 'Model ID from the running provider.' })
  model!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 2000 })
  question!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 24000, description: 'Reference text for this request only. Not saved as conversation history. Budget limits may reject shorter inputs.' })
  context!: string;
}

export class SuppliedPassageResponse {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: Number })
  lineStart!: number;

  @ApiProperty({ type: Number })
  lineEnd!: number;

  @ApiProperty({ type: String, description: 'Exact passage from reference text after CRLF/CR normalization.' })
  text!: string;
}

export class ChatBudgetResponse {
  @ApiProperty({ type: Number, description: 'UTF-8 byte estimate plus the fixed template reserve; not provider-reported token usage.' })
  promptTokenEstimate!: number;

  @ApiProperty({ type: Number })
  reservedOutputTokens!: number;

  @ApiProperty({ type: Number })
  contextWindowTokens!: number;

  @ApiProperty({ type: String, enum: ['utf8_bytes_plus_256_template_reserve'] })
  estimator!: string;
}

export class SuppliedContextResponse {
  @ApiProperty({ type: String, enum: ['supplied_context_extracts'] })
  mode!: string;

  @ApiProperty({ type: String, enum: ['evidence_selected', 'not_found'], description: 'Selection status, not a guarantee that the selected passages answer the question correctly.' })
  status!: string;

  @ApiProperty({ type: String, description: 'Server-assembled source extracts or the fixed no-evidence response; no generated answer prose.' })
  content!: string;

  @ApiProperty({ type: () => [SuppliedPassageResponse] })
  sources!: SuppliedPassageResponse[];

  @ApiProperty({ type: String })
  model!: string;

  @ApiProperty({ type: () => ChatBudgetResponse })
  budget!: ChatBudgetResponse;
}

export class ConversationSummaryResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  lastMessageAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class ConversationListResponse {
  @ApiProperty({ type: () => [ConversationSummaryResponse] })
  conversations!: ConversationSummaryResponse[];
}

export class MessageResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Number })
  sequence!: number;

  @ApiProperty({ type: String, enum: ['user', 'assistant', 'system', 'tool'] })
  role!: string;

  @ApiProperty({ type: String, enum: ['streaming', 'complete', 'failed', 'cancelled'] })
  status!: string;

  @ApiProperty({ type: String })
  content!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class ConversationMessagesResponse {
  @ApiProperty({ type: () => [MessageResponse] })
  messages!: MessageResponse[];
}

export class ModelListResponse {
  @ApiProperty({ type: [String], description: 'Model IDs currently reported by the configured inference provider.' })
  models!: string[];

  @ApiProperty({ type: String, nullable: true, description: 'Configured model when available, otherwise the first provider model, or null.' })
  defaultModel!: string | null;
}

export class CompletionResponse {
  @ApiProperty({ type: String })
  model!: string;

  @ApiProperty({ type: String })
  content!: string;

  @ApiProperty({ type: () => ChatBudgetResponse })
  budget!: ChatBudgetResponse;
}

export class ConversationTurnResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ type: () => MessageResponse })
  userMessage!: MessageResponse;

  @ApiProperty({ type: () => MessageResponse })
  assistantMessage!: MessageResponse;

  @ApiProperty({ type: String })
  model!: string;

  @ApiProperty({ type: () => ChatBudgetResponse })
  budget!: ChatBudgetResponse;
}
