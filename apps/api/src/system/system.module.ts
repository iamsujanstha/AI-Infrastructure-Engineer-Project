import { Module } from '@nestjs/common';
import { ServiceDirectoryController } from './service-directory.controller';
import { ServiceDirectoryService } from './service-directory.service';

@Module({
  controllers: [ServiceDirectoryController],
  providers: [ServiceDirectoryService],
})
export class SystemModule {}
