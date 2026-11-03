import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller()
@ApiTags('Platform')
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Identify this API service' })
  @ApiResponse({ status: 200, schema: { example: { service: 'local-ai-platform-api', apiVersion: 'v1' } } })
  index(): { service: string; apiVersion: string } {
    return { service: 'local-ai-platform-api', apiVersion: 'v1' };
  }
}
