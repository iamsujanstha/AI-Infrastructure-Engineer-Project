import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { OpenIdProvider } from './oidc.provider';

const issuer='https://identity.example.test'; const clientId='synthetic-client'; const redirect='http://127.0.0.1:4000/api/v1/cms/oidc/callback';
let privateKey:KeyObject;let publicKey:KeyObject;let wrongKey:KeyObject;
function token(payload:Record<string,unknown>,forged=false):string{
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture-key'})).toString('base64url');
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${head}.${body}.${sign('RSA-SHA256',Buffer.from(`${head}.${body}`),forged?wrongKey:privateKey).toString('base64url')}`;
}
describe('real OpenID protocol validation with a synthetic HTTPS issuer transport',()=>{
  beforeAll(()=>{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});privateKey=keys.privateKey;publicKey=keys.publicKey;
    wrongKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  });
  afterEach(()=>vi.unstubAllGlobals());
  async function scenario(change:Record<string,unknown>={},forged=false,domain=''){
    let nonce='';
    vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      if(url.pathname.endsWith('/.well-known/openid-configuration'))return Response.json({issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,jwks_uri:`${issuer}/jwks`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['none']});
      if(url.pathname==='/jwks')return Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'}]});
      if(url.pathname==='/token')return Response.json({access_token:'synthetic-token',token_type:'Bearer',expires_in:60,id_token:token({iss:issuer,aud:clientId,sub:'provider-subject',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,nonce,roles:['admin'],...change},forged)});
      throw new Error('Unexpected synthetic provider request');
    }));
    const provider=new OpenIdProvider(issuer,clientId,'',redirect,['identity.example.test'],domain);
    const started=await provider.begin();nonce=started.nonce;
    const auth=new URL(started.url);expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const callback=new URL(redirect);callback.searchParams.set('code','synthetic-code');callback.searchParams.set('state',started.state);
    return {provider,callback,expected:{state:started.state,verifier:started.verifier,nonce:started.nonce}};
  }
  it('verifies a signed ID token and exposes only issuer/subject, never token roles',async()=>{
    const flow=await scenario();
    await expect(flow.provider.finish(flow.callback,flow.expected)).resolves.toEqual({issuer,subject:'provider-subject'});
  });
  it.each([{aud:'another-client'},{iss:'https://other.example.test'},{nonce:'wrong-nonce'},{exp:1}])('rejects invalid identity claims %j',async(change)=>{
    const flow=await scenario(change);await expect(flow.provider.finish(flow.callback,flow.expected)).rejects.toThrow();
  });
  it('rejects a forged signature even with otherwise valid claims',async()=>{
    const flow=await scenario({},true);await expect(flow.provider.finish(flow.callback,flow.expected)).rejects.toThrow();
  });
  it('requires the signed Google Workspace hosted-domain claim rather than an email suffix',async()=>{
    const bad=await scenario({email:'person@company.example',hd:'outside.example'},false,'company.example');
    await expect(bad.provider.finish(bad.callback,bad.expected)).rejects.toThrow();
    const good=await scenario({hd:'company.example'},false,'company.example');
    await expect(good.provider.finish(good.callback,good.expected)).resolves.toEqual({issuer,subject:'provider-subject'});
  });
  it('rejects browser state mismatch before accepting a login',async()=>{
    const flow=await scenario();await expect(flow.provider.finish(flow.callback,{...flow.expected,state:'wrong-state'})).rejects.toThrow();
  });
});
