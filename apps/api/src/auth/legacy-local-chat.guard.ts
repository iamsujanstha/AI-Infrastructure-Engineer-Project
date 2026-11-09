import { ForbiddenException, Inject, Injectable, type CanActivate } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';

@Injectable()
export class LegacyLocalChatGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config:ConfigService<AppEnvironment,true>) {}
  canActivate():boolean {
    if(!this.config.get('LEGACY_LOCAL_CHAT_ENABLED',{infer:true}))throw new ForbiddenException('The legacy single-user workspace is disabled. Use the authenticated CMS.');
    return true;
  }
}
