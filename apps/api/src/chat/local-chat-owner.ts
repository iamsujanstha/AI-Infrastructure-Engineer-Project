import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PostgresService } from '../database/postgres.service';

// One server-owned principal keeps this loopback-only prototype usable without a user token.
// It is not an authentication identity and must be replaced before any shared deployment.
const LOCAL_OWNER_ID = '00000000-0000-4000-8000-000000000001';
const LOCAL_OWNER_EMAIL = 'local-chat@localhost.invalid';

@Injectable()
export class LocalChatOwner {
  constructor(@Inject(PostgresService) private readonly database: PostgresService) {}

  async id(): Promise<string> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, $2, 'Local chat')
       ON CONFLICT (id) DO UPDATE SET updated_at = users.updated_at
       WHERE users.email = EXCLUDED.email AND users.status = 'active' AND users.deleted_at IS NULL
       RETURNING id`,
      [LOCAL_OWNER_ID, LOCAL_OWNER_EMAIL],
    );
    const ownerId = result.rows[0]?.id;
    if (!ownerId) throw new ServiceUnavailableException('The local chat owner is unavailable.');
    return ownerId;
  }
}
