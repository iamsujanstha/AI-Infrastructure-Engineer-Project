import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  index(): { service: string; apiVersion: string } {
    return { service: 'local-ai-platform-api', apiVersion: 'v1' };
  }
}
