import { CanActivate, Controller, ExecutionContext, Get, Post, Put, Body, Param, Query, Req, Res, Inject, Injectable, SetMetadata, UseGuards, HttpException, UseInterceptors, type CallHandler, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { PeopleService } from './people.service';
import { PeopleError } from './people.policy';
import type { Person } from './people.contracts';

const ANONYMOUS = 'people:anonymous';
const Anonymous = () => SetMetadata(ANONYMOUS, true);
const COOKIE = 'people_session';
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict' as const, secure: false, path: '/api/v1/cms' };
export function setPeopleSession(response: Response, token: string): void {
  response.cookie(COOKIE,token,{...COOKIE_OPTIONS,maxAge:8*60*60*1000});
}
type PeopleRequest = Request & { person?: Person; sessionToken?: string };

function tokenFrom(request: Request): string | undefined {
  const found = (request.headers.cookie ?? '').split(';').map((v) => v.trim()).filter((v) => v.startsWith(`${COOKIE}=`));
  return found.length === 1 ? found[0]!.slice(COOKIE.length + 1) : undefined;
}
async function transport<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof PeopleError) throw new HttpException(error.message, error.status);
    if (error instanceof HttpException) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new HttpException('An account or record with this identity already exists.', 409);
    throw new HttpException('The CMS dependency is unavailable. Retry after it recovers.', 503);
  }
}
function actor(request: PeopleRequest): Person {
  if (!request.person) throw new HttpException('Sign in to the CMS.', 401);
  return request.person;
}

@Injectable()
export class PeopleSessionGuard implements CanActivate {
  constructor(@Inject(PeopleService) private readonly people: PeopleService, @Inject(Reflector) private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(ANONYMOUS, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<PeopleRequest>();
    request.sessionToken = tokenFrom(request);
    request.person = await transport(() => this.people.authenticate(request.sessionToken));
    return true;
  }
}
@Injectable()
export class PeopleNoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

@Controller({ path: 'cms', version: '1' })
@UseGuards(LocalChatOriginGuard, PeopleSessionGuard)
@UseInterceptors(PeopleNoStore)
export class PeopleController {
  constructor(@Inject(PeopleService) private readonly people: PeopleService) {}

  @Get('setup') @Anonymous()
  setupStatus() { return transport(() => this.people.setupStatus()); }

  @Post('setup') @Anonymous()
  setup(@Body() input: unknown) { return transport(() => this.people.setup(input)); }

  @Post('login') @Anonymous()
  login(@Body() input: unknown, @Res({ passthrough: true }) response: Response) {
    return transport(async () => {
      const session = await this.people.login(input);
      setPeopleSession(response,session.token);
      return { person: session.person };
    });
  }
  @Post('logout')
  logout(@Req() request: PeopleRequest, @Res({ passthrough: true }) response: Response) {
    return transport(async () => {
      await this.people.logout(actor(request), request.sessionToken!);
      response.clearCookie(COOKIE, COOKIE_OPTIONS);
    });
  }
  @Post('password')
  password(@Req() request: PeopleRequest, @Body() input: unknown, @Res({ passthrough: true }) response: Response) {
    return transport(async () => { await this.people.changePassword(actor(request), input); response.clearCookie(COOKIE, COOKIE_OPTIONS); });
  }
  @Get('session')
  me(@Req() request: PeopleRequest) { return { person: actor(request) }; }
  @Get('employees')
  employees(@Req() request: PeopleRequest) { return transport(() => this.people.employees(actor(request))); }
  @Post('employees')
  create(@Req() request: PeopleRequest, @Body() input: unknown) { return transport(() => this.people.createAccount(actor(request), input)); }
  @Put('employees/:id')
  update(@Req() request: PeopleRequest, @Param('id') id: string, @Body() input: unknown) { return transport(() => this.people.updateAccount(actor(request), id, input)); }
  @Get('employees/:id/records')
  records(@Req() request: PeopleRequest, @Param('id') id: string, @Query('year') year: string, @Query('month') month: string) {
    return transport(() => this.people.snapshot(actor(request), id, year, month));
  }
  @Put('employees/:id/entitlement')
  entitlement(@Req() request: PeopleRequest, @Param('id') id: string, @Body() input: unknown) { return transport(() => this.people.entitlement(actor(request), id, input)); }
  @Put('employees/:id/payroll')
  payroll(@Req() request: PeopleRequest, @Param('id') id: string, @Body() input: unknown) { return transport(() => this.people.setPayroll(actor(request), id, input)); }
  @Post('leave')
  apply(@Req() request: PeopleRequest, @Body() input: unknown) { return transport(() => this.people.applyLeave(actor(request), input)); }
  @Get('leave')
  queue(@Req() request: PeopleRequest, @Query('year') year: string) { return transport(() => this.people.leaveQueue(actor(request), year)); }
  @Put('leave/:id')
  decide(@Req() request: PeopleRequest, @Param('id') id: string, @Body() input: unknown) { return transport(() => this.people.decide(actor(request), id, input)); }
  @Get('documents')
  documents(@Req() request: PeopleRequest) { return transport(() => this.people.documents(actor(request))); }
  @Post('documents')
  upload(@Req() request: PeopleRequest, @Body() input: unknown) { return transport(() => this.people.upload(actor(request), input)); }
  @Post('documents/:id/archive')
  archive(@Req() request: PeopleRequest, @Param('id') id: string) { return transport(() => this.people.archive(actor(request), id)); }
  @Get('audit')
  audit(@Req() request: PeopleRequest) { return transport(() => this.people.audits(actor(request))); }
  @Get('models')
  models() { return transport(() => this.people.models()); }
  @Post('assistant')
  ask(@Req() request: PeopleRequest, @Body() input: unknown) {
    return transport(async()=>{
      const result=await this.people.ask(actor(request),input,String(request.id));
      await this.people.authenticate(request.sessionToken); // A long inference must not return evidence to a revoked session.
      return result;
    });
  }
}
