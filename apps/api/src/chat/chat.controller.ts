import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { ChatService } from './chat.service';

@Controller({ path: 'chat', version: '1' })
@UseGuards(LocalChatOriginGuard)
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Get('models')
  models(): ReturnType<ChatService['listModels']> {
    return this.chat.listModels();
  }

  @Post('completions')
  @HttpCode(HttpStatus.OK)
  complete(@Body() body: unknown, @Req() request: Request): ReturnType<ChatService['complete']> {
    return this.chat.complete(body, String(request.id));
  }
}
