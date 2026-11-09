// Shared SQL predicate keeps listing, ranking and cache reload on the same object policy.
// Only application-owned SQL identifiers/placeholders are passed to this helper.
export function documentPermission(alias: string, role: string, actor: string): string {
  return `((${alias}.record_kind='policy' AND (${alias}.audience='all' OR ${alias}.audience=${role} OR ${role}='admin'))
    OR (${alias}.record_kind<>'policy' AND (${alias}.employee_id=${actor}::uuid OR ${role} IN ('admin','hr')
      OR (${role}='accountant' AND ${alias}.record_kind='salary'))))`;
}

export function documentTitle(alias: string): string {
  return `CASE WHEN ${alias}.employee_id IS NULL THEN ${alias}.title ELSE
    (SELECT a.display_name FROM people_cms.accounts a WHERE a.organization_id=${alias}.organization_id AND a.id=${alias}.employee_id)
    || ' · ' || ${alias}.record_kind || ' · ' || ${alias}.title END`;
}
