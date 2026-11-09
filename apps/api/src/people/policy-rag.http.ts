import { Body, Controller, ExecutionContext, Get, HttpException, Inject, Injectable, Post, Req, UploadedFile, UseGuards, UseInterceptors, type CanActivate } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { PeopleSessionGuard, PeopleNoStore } from './people.http';
import type { Person } from './people.contracts';
import { PeopleError } from './people.policy';
import { PolicyRagService } from './policy-rag.service';

type AuthRequest = Request & { person: Person };
@Injectable()
export class PolicyUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<AuthRequest>().person.role !== 'admin') throw new HttpException('Only admins can upload policy PDFs.',403);
    return true;
  }
}
@Controller({ path: 'cms', version: '1' })
@UseGuards(LocalChatOriginGuard, PeopleSessionGuard)
@UseInterceptors(PeopleNoStore)
export class PolicyRagController {
  constructor(@Inject(PolicyRagService) private readonly rag: PolicyRagService) {}
  @Post('documents/pdf')
  @UseGuards(PolicyUploadGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5*1024*1024, files: 1, fields: 3, fieldSize: 100 } }))
  async upload(@Req() request: AuthRequest, @Body() body: unknown, @UploadedFile() input: unknown) {
    if (typeof input !== 'object' || input === null || !('buffer' in input) || !Buffer.isBuffer(input.buffer)
        || !('originalname' in input) || typeof input.originalname !== 'string'
        || typeof body !== 'object' || body === null || !('audience' in body) || Object.keys(body).some(k=>!['audience','recordKind','employeeId'].includes(k))) {
      throw new HttpException('Upload one PDF and choose its audience.',400);
    }
    try { return await this.rag.uploadPdf(request.person, { filename: input.originalname, audience: body.audience, ...('recordKind'in body?{recordKind:body.recordKind}:{}),...('employeeId'in body?{employeeId:body.employeeId}:{}) }, input.buffer, String(request.id)); }
    catch (error) {
      if (error instanceof PeopleError) throw new HttpException(error.message,error.status);
      if (error instanceof HttpException) throw error;
      throw new HttpException('Policy indexing dependency unavailable. Nothing was published.',503);
    }
  }
  @Get('rag/metrics')
  async metrics(@Req() request: AuthRequest) {
    try { return await this.rag.metrics(request.person); }
    catch (error) { throw new HttpException(error instanceof PeopleError ? error.message : 'Policy metrics unavailable.',error instanceof PeopleError ? error.status : 503); }
  }
}
