import { Body, Controller, ExecutionContext, Get, HttpException, Inject, Injectable, Param, Post, Req, Res, UseGuards, UseInterceptors, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '../config/environment';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { OrganizationLogin } from './oidc.service';
import { PeopleNoStore, PeopleSessionGuard, setPeopleSession } from './people.http';
import type { Person } from './people.contracts';
import { PeopleError } from './people.policy';

const STATE_COOKIE = 'people_oidc_state';
const STATE_OPTIONS = { httpOnly:true,secure:false,sameSite:'lax' as const,path:'/api/v1/cms/oidc' };
@Injectable()
export class OidcCallbackGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppEnvironment,true>) {}
  canActivate(_context: ExecutionContext): boolean {
    // Cross-site IdP redirects do not carry Origin; validate local deployment here and cryptographic browser state in the callback.
    const host=this.config.get('API_HOST',{infer:true});
    const local=['127.0.0.1','localhost','::1'].includes(host)||(host==='0.0.0.0'&&this.config.get('LOCAL_CHAT_CONTAINER_MODE',{infer:true}));
    if (this.config.get('NODE_ENV',{infer:true})==='production' || !local) throw new HttpException('Organization login is local-only in this pilot.',403);
    return true;
  }
}
@Controller({path:'cms/oidc',version:'1'})
@UseInterceptors(PeopleNoStore)
export class OrganizationLoginController {
  constructor(@Inject(OrganizationLogin) private readonly login: OrganizationLogin,@Inject(ConfigService) private readonly config: ConfigService<AppEnvironment,true>) {}
  @Get('configuration') @UseGuards(LocalChatOriginGuard)
  configuration() { return this.login.configuration(); }
  @Post('start') @UseGuards(LocalChatOriginGuard)
  async start(@Res({passthrough:true}) response:Response) {
    try {
      const started=await this.login.start(); response.cookie(STATE_COOKIE,started.state,{...STATE_OPTIONS,maxAge:5*60*1000});
      return {authorizationUrl:started.authorizationUrl};
    } catch(error) { throw new HttpException(error instanceof PeopleError?error.message:'Organization login provider unavailable.',error instanceof PeopleError?error.status:503); }
  }
  @Get('callback') @UseGuards(OidcCallbackGuard)
  async callback(@Req() request:Request,@Res() response:Response):Promise<void> {
    response.clearCookie(STATE_COOKIE,STATE_OPTIONS);
    const destination=new URL('/cms',this.config.get('OIDC_WEB_ORIGIN',{infer:true}));
    try {
      const url=new URL(this.config.get('OIDC_REDIRECT_URI',{infer:true}));
      const received=new URL(request.originalUrl,'http://loopback.invalid'); url.search=received.search;
      const cookie=(request.headers.cookie??'').split(';').map((v)=>v.trim()).filter((v)=>v.startsWith(`${STATE_COOKIE}=`));
      const session=await this.login.finish(url,cookie.length===1?cookie[0]!.slice(STATE_COOKIE.length+1):undefined);
      setPeopleSession(response,session.token);
    } catch { destination.searchParams.set('login','failed'); }
    response.redirect(303,destination.href);
  }
  @Post('employees/:id') @UseGuards(LocalChatOriginGuard,PeopleSessionGuard)
  async bind(@Req() request:Request&{person:Person},@Param('id') id:string,@Body() body:unknown):Promise<void> {
    try { await this.login.bind(request.person,id,body); }
    catch(error) { throw new HttpException(error instanceof PeopleError?error.message:'Identity mapping unavailable.',error instanceof PeopleError?error.status:503); }
  }
}
