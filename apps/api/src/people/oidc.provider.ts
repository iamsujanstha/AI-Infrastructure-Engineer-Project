import * as oidc from 'openid-client';
import type { OidcProtocol } from './oidc.contracts';

export class OpenIdProvider implements OidcProtocol {
  private configuration?: Promise<oidc.Configuration>;
  constructor(readonly issuer: string, private readonly clientId: string, private readonly secret: string,
    private readonly redirectUri: string, private readonly allowedHosts: readonly string[], private readonly workspaceDomain = '') {}
  private config(): Promise<oidc.Configuration> {
    if (!this.configuration) {
      const fetcher: oidc.CustomFetch = async (input, init) => {
        const url = new URL(input);
        if (url.protocol !== 'https:' || !this.allowedHosts.includes(url.hostname) || url.username || url.password) throw new Error('OIDC destination not allowed');
        const body=init.body instanceof Uint8Array?Uint8Array.from(init.body).buffer:init.body;
        return fetch(input, { ...init, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
      };
      this.configuration = oidc.discovery(new URL(this.issuer), this.clientId,
        { id_token_signed_response_alg: 'RS256', ...(this.secret ? { client_secret: this.secret } : {}) },
        this.secret ? oidc.ClientSecretPost(this.secret) : oidc.None(),
        { timeout: 10, [oidc.customFetch]: fetcher, execute: [oidc.enableNonRepudiationChecks] }).catch((error: unknown) => { this.configuration = undefined; throw error; });
    }
    return this.configuration;
  }
  async begin() {
    const state = oidc.randomState(); const nonce = oidc.randomNonce(); const verifier = oidc.randomPKCECodeVerifier();
    const config = await this.config();
    const url = oidc.buildAuthorizationUrl(config, { redirect_uri: this.redirectUri, scope: this.workspaceDomain ? 'openid email' : 'openid', ...(this.workspaceDomain?{hd:this.workspaceDomain}:{}),state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' });
    if (url.protocol !== 'https:' || !this.allowedHosts.includes(url.hostname)) throw new Error('OIDC authorization destination not allowed');
    return { url: url.href, state, nonce, verifier };
  }
  async finish(url: URL, expected: { state: string; verifier: string; nonce: string }) {
    const tokens = await oidc.authorizationCodeGrant(await this.config(), url,
      { expectedState: expected.state, expectedNonce: expected.nonce, pkceCodeVerifier: expected.verifier, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims || claims.iss !== this.issuer || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length>255) throw new Error('Invalid organization identity');
    if(this.workspaceDomain && claims.hd!==this.workspaceDomain)throw new Error('Google Workspace domain is not permitted');
    // No role, tenant, or privilege is taken from the browser or unbound token claims.
    return { issuer: claims.iss, subject: claims.sub };
  }
}
