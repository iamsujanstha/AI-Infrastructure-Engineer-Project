import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ServiceDirectoryResponseDto } from './service-directory.dto';
import { ServiceDirectoryService } from './service-directory.service';

@Controller({ path: 'system/services', version: '1' })
@ApiTags('System')
export class ServiceDirectoryController {
  constructor(@Inject(ServiceDirectoryService) private readonly directory: ServiceDirectoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List local service links and connection details',
    description: 'Local-development catalog for the web UI, APIs, PostgreSQL/pgAdmin, Redis, MLX, and the Hermes stdio integration. It reports configured addresses, not live health. Credential values are omitted.',
  })
  @ApiResponse({ status: 200, description: 'Configured local service directory.', type: ServiceDirectoryResponseDto })
  @ApiResponse({ status: 404, description: 'The service directory is disabled outside loopback or explicitly enabled local Docker development.' })
  getServices(): ServiceDirectoryResponseDto {
    return this.directory.getDirectory();
  }
}
