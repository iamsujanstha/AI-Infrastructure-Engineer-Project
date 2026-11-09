import { describe, expect, it } from 'vitest';
import { hybridRank, routePolicyModel } from './policy-rag.service';
import type { RagPassage } from './policy-rag.contracts';

const passage=(id:string):RagPassage=>({documentId:id,title:'Synthetic',ordinal:1,pageNumber:1,lineStart:1,lineEnd:1,content:'source'});
describe('policy retrieval and routing',()=>{
  it('fuses ranks and deduplicates stable source identities',()=>{
    const a=passage('a'),b=passage('b'),c=passage('c');
    expect(hybridRank([[a,b],[b,c]]).map(p=>p.documentId)).toEqual(['b','a','c']);
  });
  it('routes only to models actually reported by the provider',()=>{
    const config={smallModel:'small',largeModel:'large',semanticCache:false};
    expect(routePolicyModel('annual leave',['small','large'],config).model).toBe('small');
    expect(routePolicyModel('Compare policy exceptions',['small','large'],config).model).toBe('large');
    expect(routePolicyModel('annual leave',['large'],config).model).toBe('large');
    expect(()=>routePolicyModel('question',['large'],config,'unavailable')).toThrow();
  });
});
