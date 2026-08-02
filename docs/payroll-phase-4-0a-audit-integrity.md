# Payroll Phase 4.0A audit integrity boundary

## Implemented in Phase 4.0A

- Payroll-sensitive mutations write their audit record with the throwing audit
  writer inside the same database transaction as the business mutation.
- Sensitive audit call sites build explicit safe DTOs instead of passing Prisma
  records directly.
- Audit payload sanitization covers real Prisma field names, nested values, pay
  amounts and common identifier variants.
- Free-text audit reasons and notes are trimmed and redact email addresses,
  currency amounts, long numeric values and mixed alphanumeric identifiers.
- Production application source treats `AuditLog` as append-only: the audit
  module exposes create-only persistence and no application source may call
  `auditLog.update`, `auditLog.delete`, `auditLog.upsert` or `auditLog.deleteMany`.

## Database enforcement boundary

A database trigger that blocks every `UPDATE`, `DELETE` and `TRUNCATE` is not
added in this phase. The repository's integration fixtures currently remove
tenant audit rows during teardown, and the product does not yet have a separate
database maintenance role or an approved retention/purge procedure. Adding a
bypass controlled by the normal application database role would create a false
security boundary.

Before database-level append-only enforcement is released, the product must
provide all of the following in one controlled migration:

1. a dedicated maintenance database role that is not available to the web app;
2. an approved retention and tenant-deletion procedure;
3. a trigger that rejects update/delete/truncate for the normal app role;
4. migration and integration tests proving the web role cannot enable a bypass;
5. an independently recorded maintenance audit whenever retention runs.

Until that boundary is available, regression tests scan production source for
direct AuditLog mutation calls. This is an application append-only guarantee,
not a claim of database tamper resistance.
