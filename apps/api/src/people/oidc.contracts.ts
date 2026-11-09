import type { Person } from './people.contracts';

export interface OidcQueries {
  rememberOidc(hash: string, verifier: string, nonce: string): Promise<void>;
  takeOidc(hash: string): Promise<{ verifier: string; nonce: string } | null>;
  oidcAccount(issuer: string, subject: string): Promise<Person | null>;
  bindOidc(org: string, employee: string, issuer: string, subject: string): Promise<void>;
}
export interface OidcProtocol {
  readonly issuer: string;
  begin(): Promise<{ url: string; state: string; verifier: string; nonce: string }>;
  finish(url: URL, expected: { state: string; verifier: string; nonce: string }): Promise<{ issuer: string; subject: string }>;
}
