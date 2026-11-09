-- Small-corpus exact vector retrieval; permission filtering precedes ranking.
ALTER TABLE people_cms.organizations ADD COLUMN policy_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE people_cms.documents ADD COLUMN media_type text NOT NULL DEFAULT 'text/plain';
ALTER TABLE people_cms.documents ADD COLUMN page_count integer;
ALTER TABLE people_cms.documents ADD COLUMN embedding_profile text;
ALTER TABLE people_cms.document_passages DROP CONSTRAINT document_passages_ordinal_check;
ALTER TABLE people_cms.document_passages ADD CONSTRAINT document_passages_ordinal_check CHECK (ordinal BETWEEN 1 AND 200);
ALTER TABLE people_cms.document_passages ADD COLUMN page_number integer CHECK (page_number BETWEEN 1 AND 100);
ALTER TABLE people_cms.document_passages ADD COLUMN embedding vector(384);
ALTER TABLE people_cms.document_passages ADD COLUMN embedding_profile text;
ALTER TABLE people_cms.document_passages ADD CONSTRAINT policy_embedding_profile_pair CHECK ((embedding IS NULL) = (embedding_profile IS NULL));
CREATE UNIQUE INDEX policy_pdf_idempotency ON people_cms.documents(organization_id,content_hash,audience,embedding_profile)
  WHERE active AND media_type='application/pdf';

CREATE TABLE people_cms.policy_cache (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  role text NOT NULL,
  policy_revision bigint NOT NULL,
  embedding_profile text NOT NULL,
  model text NOT NULL,
  question_hash char(64) NOT NULL,
  question_fingerprint char(64) NOT NULL,
  question_embedding vector(384) NOT NULL,
  selected_sources jsonb NOT NULL CHECK (jsonb_typeof(selected_sources)='array' AND jsonb_array_length(selected_sources) BETWEEN 1 AND 3),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
  FOREIGN KEY (organization_id,actor_id) REFERENCES people_cms.accounts(organization_id,id) ON DELETE CASCADE,
  UNIQUE(organization_id,actor_id,role,policy_revision,embedding_profile,model,question_hash)
);
CREATE INDEX policy_cache_scope ON people_cms.policy_cache(organization_id,actor_id,role,policy_revision,expires_at);

CREATE TABLE people_cms.policy_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
  organization_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('pdf_index','policy_answer')),
  outcome text NOT NULL CHECK (outcome IN ('ok','not_found','error')),
  model text,
  embedding_profile text,
  cache_kind text CHECK (cache_kind IN ('miss','exact','semantic')),
  source_count integer NOT NULL DEFAULT 0 CHECK (source_count BETWEEN 0 AND 200),
  retrieval_ms double precision,
  inference_ms double precision,
  total_ms double precision NOT NULL CHECK (total_ms>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id,actor_id) REFERENCES people_cms.accounts(organization_id,id)
);
CREATE INDEX policy_runs_scope ON people_cms.policy_runs(organization_id,created_at DESC);

-- External identity binding is explicit; verified-email matching does not grant a role.
ALTER TABLE people_cms.accounts ADD COLUMN oidc_issuer text;
ALTER TABLE people_cms.accounts ADD COLUMN oidc_subject text;
ALTER TABLE people_cms.accounts ADD CONSTRAINT oidc_identity_pair CHECK ((oidc_issuer IS NULL)=(oidc_subject IS NULL));
CREATE UNIQUE INDEX people_oidc_identity ON people_cms.accounts(oidc_issuer,oidc_subject) WHERE oidc_subject IS NOT NULL;
CREATE TABLE people_cms.oidc_attempts (
  state_hash char(64) PRIMARY KEY,
  verifier text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
