import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { INFERENCE_PROVIDER } from './inference-provider';
import { MlxProvider } from './mlx.provider';

@Module({
  imports: [ConfigurationModule],
  providers: [MlxProvider, { provide: INFERENCE_PROVIDER, useExisting: MlxProvider }],
  exports: [INFERENCE_PROVIDER],
})
export class InferenceModule {}
