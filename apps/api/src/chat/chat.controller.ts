import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { LocalConversationChatService } from './local-conversation-chat.service';
import {
  CompleteRequest,
  CompletionResponse,
  ConversationListResponse,
  ConversationMessagesResponse,
  ConversationSummaryResponse,
  ConversationTurnResponse,
  CreateConversationRequest,
  ModelListResponse,
  SendConversationTurnRequest,
} from './chat.openapi';

@Controller({ path: 'chat', version: '1' })
@UseGuards(LocalChatOriginGuard)
@ApiTags('Chat')
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(LocalConversationChatService) private readonly conversations: LocalConversationChatService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List saved local conversations', description: 'Returns conversations for the fixed local-development owner. This prototype does not provide user authentication.' })
  @ApiResponse({ status: 200, description: 'Conversation summaries.', type: ConversationListResponse })
  @ApiResponse({ status: 403, description: 'Request Origin is not configured for local web access.' })
  listConversations(): ReturnType<LocalConversationChatService['list']> {
    return this.conversations.list();
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Create a conversation' })
  @ApiBody({ type: CreateConversationRequest })
  @ApiResponse({ status: 201, description: 'Created conversation.', type: ConversationSummaryResponse })
  @ApiResponse({ status: 400, description: 'Invalid conversation input.' })
  @ApiResponse({ status: 403, description: 'Request Origin is not configured for local web access.' })
  createConversation(@Body() body: unknown): ReturnType<LocalConversationChatService['create']> {
    return this.conversations.create(body);
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'List recent messages in a conversation' })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Messages in sequence order.', type: ConversationMessagesResponse })
  @ApiResponse({ status: 400, description: 'Conversation ID is invalid.' })
  @ApiResponse({ status: 403, description: 'Request Origin is not configured for local web access.' })
  listConversationMessages(@Param('conversationId') conversationId: string): ReturnType<LocalConversationChatService['getMessages']> {
    return this.conversations.getMessages(conversationId);
  }

  @Post('conversations/:conversationId/turns')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Persist a user turn and generate its assistant reply', description: 'Stores the user message and assistant lifecycle record in PostgreSQL. Generation waits for the configured inference provider to complete.' })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiBody({ type: SendConversationTurnRequest })
  @ApiResponse({ status: 200, description: 'Completed conversation turn.', type: ConversationTurnResponse })
  @ApiResponse({ status: 400, description: 'Invalid turn, unsupported model, or context budget exceeded.' })
  @ApiResponse({ status: 403, description: 'Request Origin is not configured for local web access.' })
  @ApiResponse({ status: 502, description: 'Inference provider returned an invalid response.' })
  @ApiResponse({ status: 503, description: 'Inference provider is unavailable.' })
  @ApiResponse({ status: 504, description: 'Inference provider timed out.' })
  sendConversationTurn(@Param('conversationId') conversationId: string, @Body() body: unknown, @Req() request: Request): ReturnType<LocalConversationChatService['send']> {
    return this.conversations.send(conversationId, body, String(request.id));
  }

  @Get('models')
  @ApiOperation({ summary: 'List models available from the configured inference provider' })
  @ApiResponse({ status: 200, description: 'Live model list and selected default.', type: ModelListResponse })
  @ApiResponse({ status: 403, description: 'Request Origin is not configured for local web access.' })
  @ApiResponse({ status: 503, description: 'Inference provider is unavailable.' })
  models(): ReturnType<ChatService['listModels']> {
    return this.chat.listModels();
  }

  @Post('completions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a completion from supplied chat history', description: 'Raw local inference only. This endpoint does not retrieve project files or attach project context.' })
  @ApiBody({ type: CompleteRequest })
  @ApiResponse({ status: 200, description: 'Generated completion and labeled context-budget estimate.', type: CompletionResponse })
  @ApiResponse({ status: 400, description: 'Invalid history, unavailable model ID, or context budget exceeded.' })
  @ApiResponse({ status: 403, description: 'Request Origin is not configured for local web access.' })
  @ApiResponse({ status: 502, description: 'Inference provider returned an invalid response.' })
  @ApiResponse({ status: 503, description: 'Inference provider is unavailable.' })
  @ApiResponse({ status: 504, description: 'Inference provider timed out.' })
  complete(@Body() body: unknown, @Req() request: Request): ReturnType<ChatService['complete']> {
    return this.chat.complete(body, String(request.id));
  }
}
