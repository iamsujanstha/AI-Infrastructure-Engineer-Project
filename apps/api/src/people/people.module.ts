import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { ConfigurationModule } from '../config/configuration.module';
import { DatabaseModule } from '../database/database.module';
import { PostgresService } from '../database/postgres.service';
import { ChatModule } from '../chat/chat.module';
import { ChatService } from '../chat/chat.service';
import { SuppliedContextService } from '../chat/supplied-context.service';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { PgPeopleStore } from './people.repository';
import { LocalPeopleSecurity } from './people.security';
import { PeopleService } from './people.service';
import { PeopleController, PeopleNoStore, PeopleSessionGuard } from './people.http';
import { PolicyRagService } from './policy-rag.service';
import { PolicyComputeClient } from './policy-compute.client';
import { PolicyRagController, PolicyUploadGuard } from './policy-rag.http';
import { OrganizationLogin } from './oidc.service';
import { OpenIdProvider } from './oidc.provider';
import { OrganizationLoginController, OidcCallbackGuard } from './oidc.http';

@Module({
  imports: [ConfigurationModule, DatabaseModule, ChatModule],
  controllers: [PeopleController, PolicyRagController, OrganizationLoginController],
  providers: [
    LocalChatOriginGuard, PeopleSessionGuard, PeopleNoStore, PolicyUploadGuard, OidcCallbackGuard,
    { provide: OrganizationLogin,inject:[PostgresService,ConfigService],useFactory:(db:PostgresService,config:ConfigService<AppEnvironment,true>) => {
      const issuer=config.get('OIDC_ISSUER',{infer:true});
      return new OrganizationLogin(new PgPeopleStore(db,config.get('PEOPLE_DB_TIMEOUT_MS',{infer:true})),new LocalPeopleSecurity(),issuer ? new OpenIdProvider(issuer,
        config.get('OIDC_CLIENT_ID',{infer:true}),config.get('OIDC_CLIENT_SECRET',{infer:true}),config.get('OIDC_REDIRECT_URI',{infer:true}),
        [...new Set([new URL(issuer).hostname,...config.get('OIDC_ALLOWED_HOSTS',{infer:true}).split(',').map((h)=>h.trim()).filter(Boolean)])],config.get('OIDC_GOOGLE_WORKSPACE_DOMAIN',{infer:true})) : null);
    }},
    { provide: PolicyRagService, inject: [PostgresService, SuppliedContextService, ChatService, ConfigService],
      useFactory: (db: PostgresService, references: SuppliedContextService, chat: ChatService, config: ConfigService<AppEnvironment,true>) => new PolicyRagService(new PgPeopleStore(db,config.get('PEOPLE_DB_TIMEOUT_MS',{infer:true})), new LocalPeopleSecurity(), {
        prepare: (text) => references.prepareReference(text), select: (model,question,passages,id) => references.selectPrepared(model,question,passages,id), models: () => chat.listModels(),
      },new PolicyComputeClient(config.get('CONTEXT_ENGINE_URL',{infer:true}),config.get('CONTEXT_ENGINE_TOKEN',{infer:true}),config.get('POLICY_COMPUTE_TIMEOUT_MS',{infer:true})), {
        smallModel: config.get('POLICY_SMALL_MODEL',{infer:true}), largeModel: config.get('POLICY_LARGE_MODEL',{infer:true}) || config.get('MLX_DEFAULT_MODEL',{infer:true}), semanticCache: config.get('POLICY_SEMANTIC_CACHE_ENABLED',{infer:true}),
      }),
    },
    { provide: PeopleService, inject: [PostgresService, SuppliedContextService, ChatService, ConfigService, PolicyRagService],
      useFactory: (db: PostgresService, references: SuppliedContextService, chat: ChatService, config: ConfigService<AppEnvironment, true>, rag: PolicyRagService) => new PeopleService(new PgPeopleStore(db, config.get('PEOPLE_DB_TIMEOUT_MS', { infer: true })), new LocalPeopleSecurity(), {
        prepare: (text) => references.prepareReference(text),
        select: (model, question, passages, requestId) => references.selectPrepared(model, question, passages, requestId),
        models: () => chat.listModels(),
      },rag),
    },
  ],
})
export class PeopleModule {}
