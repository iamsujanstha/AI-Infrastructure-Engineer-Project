-- A PDF cannot authorize its own owner or disclose another employee's records.
ALTER TABLE people_cms.documents
  ADD COLUMN record_kind text NOT NULL DEFAULT 'policy' CHECK (record_kind IN ('policy','salary','leave')),
  ADD COLUMN employee_id uuid,
  ADD CONSTRAINT documents_employee_owner_fk FOREIGN KEY (organization_id,employee_id)
    REFERENCES people_cms.accounts(organization_id,id),
  ADD CONSTRAINT documents_record_owner_check CHECK (
    (record_kind='policy' AND employee_id IS NULL) OR
    (record_kind IN ('salary','leave') AND employee_id IS NOT NULL AND audience='admin' AND media_type='application/pdf'));
DROP INDEX people_cms.policy_pdf_idempotency;
CREATE UNIQUE INDEX policy_pdf_idempotency ON people_cms.documents
  (organization_id,content_hash,audience,embedding_profile,record_kind,
   COALESCE(employee_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active AND media_type='application/pdf';
UPDATE people_cms.organizations SET policy_revision=policy_revision+1;
