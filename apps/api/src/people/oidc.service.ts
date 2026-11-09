import { z } from 'zod';
import type { PeopleSecurity, PeopleStore, Person } from './people.contracts';
import type { OidcProtocol } from './oidc.contracts';
import { PeopleError, requireRole } from './people.policy';

export class OrganizationLogin {
  constructor(private readonly store: PeopleStore, private readonly security: PeopleSecurity, private readonly protocol: OidcProtocol | null) {}
  configuration(): { enabled: boolean } { return { enabled: this.protocol !== null }; }
  async start(): Promise<{ authorizationUrl: string; state: string }> {
    if (!this.protocol) throw new PeopleError(503, 'Organization login is not configured.');
    if (!await this.store.queries.setupExists()) throw new PeopleError(409, 'Complete local administrator setup first.');
    const pending = await this.protocol.begin();
    await this.store.queries.rememberOidc(this.security.hashToken(pending.state), pending.verifier, pending.nonce);
    return { authorizationUrl: pending.url, state: pending.state };
  }
  async finish(url: URL, cookieState: string | undefined): Promise<{ person: Person; token: string }> {
    if (!this.protocol) throw new PeopleError(503, 'Organization login is not configured.');
    const state = url.searchParams.get('state');
    if (!state || state.length>256 || !cookieState || this.security.hashToken(state)!==this.security.hashToken(cookieState)) throw new PeopleError(401, 'Organization login state mismatch.');
    const pending = await this.store.queries.takeOidc(this.security.hashToken(state));
    if (!pending) throw new PeopleError(401, 'Organization login expired or was already used.');
    const identity = await this.protocol.finish(url, { state, ...pending });
    return this.store.transaction(async (q) => {
      const account = await q.oidcAccount(identity.issuer,identity.subject);
      if (!account) throw new PeopleError(403, 'This organization identity is not linked to an active employee account.');
      const session = this.security.newSession(); await q.saveSession(session.hash,account);
      await q.audit(account.organizationId,account.id,'session.oidc_login',account.id);
      return { person: account, token: session.token };
    });
  }
  async bind(actor: Person, target: string, input: unknown): Promise<void> {
    requireRole(actor,['admin']);
    if (!this.protocol) throw new PeopleError(503,'Configure the organization identity provider first.');
    const parsed = z.object({ subject: z.string().min(1).max(255) }).strict().safeParse(input);
    if (!parsed.success || !z.string().uuid().safeParse(target).success) throw new PeopleError(400,'Supply the identity provider subject for this employee.');
    const issuer = this.protocol.issuer;
    await this.store.transaction(async (q) => {
      await q.lockPerson(actor.organizationId,actor.id);
      const current = await q.person(actor.organizationId,actor.id);
      if (!current?.active || current.role!=='admin') throw new PeopleError(403,'Administrator access changed.');
      if (!await q.person(actor.organizationId,target)) throw new PeopleError(404,'Employee not found.');
      await q.bindOidc(actor.organizationId,target,issuer,parsed.data.subject);
      await q.audit(actor.organizationId,actor.id,'account.bind_oidc_revoke_sessions',target);
    });
  }
}
