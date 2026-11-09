import { Body, Controller, Header, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { LegacyLocalChatGuard } from '../auth/legacy-local-chat.guard';
import { SuppliedContextRequest, SuppliedContextResponse } from './chat.openapi';
import { SuppliedContextService, type SuppliedContextAnswer } from './supplied-context.service';

@Controller({ path: 'chat', version: '1' })
@UseGuards(LocalChatOriginGuard,LegacyLocalChatGuard)
@ApiTags('Chat')
export class SuppliedContextController {
  constructor(@Inject(SuppliedContextService) private readonly context: SuppliedContextService) {}

  @Post('context-answers')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Select exact evidence from reference text supplied with this request', description: 'Local single-user prototype. No retrieval, saved history, tools, Hermes, or generated answer prose. Model-selected passage IDs are validated and rendered from the submitted source; relevance is not guaranteed.' })
  @ApiBody({ type: SuppliedContextRequest })
  @ApiResponse({ status: 200, type: SuppliedContextResponse, description: 'Selected source extracts or an explicit not-found response.' })
  @ApiResponse({ status: 400, description: 'Invalid, credential-like, oversized, over-budget input or unavailable model ID.' })
  @ApiResponse({ status: 403, description: 'Local development/origin restriction denied the request.' })
  @ApiResponse({ status: 502, description: 'Invalid provider response or evidence selection; no generated answer accepted.' })
  @ApiResponse({ status: 503, description: 'Local model provider unavailable.' })
  @ApiResponse({ status: 504, description: 'Local model request timed out.' })
  answer(@Body() body: unknown, @Req() request: Request): Promise<SuppliedContextAnswer> {
    return this.context.answer(body, String(request.id));
  }
}
