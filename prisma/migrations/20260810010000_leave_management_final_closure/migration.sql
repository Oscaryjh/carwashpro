BEGIN;

CREATE TYPE "LeavePolicyOrigin" AS ENUM ('SYSTEM_LEGACY', 'BUSINESS_CUSTOM', 'VERIFIED_LEGAL');
CREATE TYPE "LeaveLegalStatus" AS ENUM ('COMPANY_POLICY_ONLY', 'VERIFIED_LEGAL', 'LEGAL_RULE_NOT_READY', 'LEGACY_REVIEW_REQUIRED');
CREATE TYPE "LeavePolicyVersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TYPE "LeaveUnit" AS ENUM ('FULL_DAY', 'HALF_DAY_AM', 'HALF_DAY_PM');
CREATE TYPE "LeaveLedgerEventType" AS ENUM ('ENTITLEMENT', 'CARRY_FORWARD', 'MANUAL_ADJUSTMENT', 'APPROVED_CONSUMPTION', 'CANCELLATION_RESTORE', 'EXPIRY');
CREATE TYPE "LeaveApplicationEventType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

ALTER TABLE "leave_policies"
  ADD COLUMN "origin" "LeavePolicyOrigin" NOT NULL DEFAULT 'SYSTEM_LEGACY',
  ADD COLUMN "legal_status" "LeaveLegalStatus" NOT NULL DEFAULT 'LEGACY_REVIEW_REQUIRED';

CREATE TABLE "leave_policy_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "LeavePolicyVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "name_snapshot" TEXT NOT NULL,
  "pay_treatment" "LeavePayTreatment" NOT NULL,
  "count_mode" "LeaveCountMode" NOT NULL,
  "balance_tracked" BOOLEAN NOT NULL,
  "default_entitlement_days" DECIMAL(6,2),
  "under_two_years_days" DECIMAL(6,2),
  "two_to_five_years_days" DECIMAL(6,2),
  "five_years_plus_days" DECIMAL(6,2),
  "requires_document" BOOLEAN NOT NULL DEFAULT false,
  "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
  "origin" "LeavePolicyOrigin" NOT NULL,
  "legal_status" "LeaveLegalStatus" NOT NULL,
  "source_reference" VARCHAR(500),
  "reason" VARCHAR(500) NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_policy_versions_policy_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_policy_versions_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_policy_versions_actor_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "leave_policy_versions_period_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "leave_policy_versions_entitlement_check" CHECK (
    COALESCE("default_entitlement_days", 0) >= 0 AND
    COALESCE("under_two_years_days", 0) >= 0 AND
    COALESCE("two_to_five_years_days", 0) >= 0 AND
    COALESCE("five_years_plus_days", 0) >= 0
  ),
  CONSTRAINT "leave_policy_versions_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_policy_versions_policy_revision_key" UNIQUE ("policy_id", "revision")
);
CREATE INDEX "leave_policy_versions_scope_idx" ON "leave_policy_versions"("business_id", "policy_id", "status", "effective_from");

INSERT INTO "leave_policy_versions" (
  "business_id", "policy_id", "revision", "effective_from", "name_snapshot",
  "pay_treatment", "count_mode", "balance_tracked", "default_entitlement_days",
  "under_two_years_days", "two_to_five_years_days", "five_years_plus_days",
  "requires_document", "allow_negative_balance", "origin", "legal_status", "reason", "created_at"
)
SELECT
  p."business_id", p."id", 1, DATE '2000-01-01', p."name",
  p."pay_treatment", p."count_mode", p."balance_tracked", p."default_entitlement_days",
  p."under_two_years_days", p."two_to_five_years_days", p."five_years_plus_days",
  p."requires_document", p."allow_negative_balance", 'SYSTEM_LEGACY',
  'LEGACY_REVIEW_REQUIRED', 'Legacy policy retained for review; no legal verification is asserted.', p."created_at"
FROM "leave_policies" p;

ALTER TABLE "leave_requests"
  ADD COLUMN "policy_version_id" UUID,
  ADD COLUMN "balance_tracked_snapshot" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "legal_status_snapshot" "LeaveLegalStatus" NOT NULL DEFAULT 'LEGACY_REVIEW_REQUIRED',
  ADD COLUMN "leave_unit" "LeaveUnit" NOT NULL DEFAULT 'FULL_DAY',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "client_request_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "cancelled_by_id" UUID,
  ADD COLUMN "cancellation_reason" VARCHAR(500),
  ADD COLUMN "decision_digest" CHAR(64);

UPDATE "leave_requests" r
SET
  "policy_version_id" = v."id",
  "balance_tracked_snapshot" = v."balance_tracked",
  "legal_status_snapshot" = v."legal_status",
  "revision" = CASE WHEN r."status" = 'PENDING' THEN 0 ELSE 1 END
FROM "leave_policy_versions" v
WHERE v."policy_id" = r."policy_id" AND v."revision" = 1;

ALTER TABLE "leave_requests" ALTER COLUMN "policy_version_id" SET NOT NULL;
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_policy_version_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "leave_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_requests_cancelled_by_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_requests_tenant_key" UNIQUE ("id", "business_id"),
  ADD CONSTRAINT "leave_requests_client_request_key" UNIQUE ("business_id", "membership_id", "client_request_id"),
  ADD CONSTRAINT "leave_requests_revision_check" CHECK ("revision" >= 0);

ALTER TABLE "leave_request_days"
  ADD COLUMN "leave_unit" "LeaveUnit" NOT NULL DEFAULT 'FULL_DAY',
  ADD COLUMN "expected_day_id" UUID,
  ADD COLUMN "expected_day_kind_snapshot" "AttendanceExpectedDayKind",
  ADD COLUMN "policy_version_id" UUID,
  ADD COLUMN "pay_treatment_snapshot" "LeavePayTreatment",
  ADD COLUMN "balance_consumption_units" DECIMAL(6,2);

UPDATE "leave_request_days" d
SET
  "policy_version_id" = r."policy_version_id",
  "pay_treatment_snapshot" = r."pay_treatment_snapshot",
  "balance_consumption_units" = d."day_fraction"
FROM "leave_requests" r
WHERE r."id" = d."leave_request_id";

ALTER TABLE "leave_request_days"
  ALTER COLUMN "policy_version_id" SET NOT NULL,
  ALTER COLUMN "pay_treatment_snapshot" SET NOT NULL,
  ALTER COLUMN "balance_consumption_units" SET NOT NULL;
ALTER TABLE "leave_request_days"
  ADD CONSTRAINT "leave_request_days_policy_version_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "leave_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_request_days_expected_day_fkey" FOREIGN KEY ("expected_day_id") REFERENCES "attendance_expected_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_request_days_balance_units_check" CHECK ("balance_consumption_units" > 0 AND "balance_consumption_units" <= 1);

CREATE TABLE "employee_leave_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "leave_year_start" DATE NOT NULL,
  "leave_year_end" DATE NOT NULL,
  "entitled_units" DECIMAL(6,2) NOT NULL,
  "source" VARCHAR(80) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_leave_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_leave_entitlements_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_entitlements_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_entitlements_policy_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_entitlements_version_fkey" FOREIGN KEY ("policy_version_id", "business_id") REFERENCES "leave_policy_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_entitlements_actor_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_entitlements_period_check" CHECK ("leave_year_end" >= "leave_year_start"),
  CONSTRAINT "employee_leave_entitlements_units_check" CHECK ("entitled_units" >= 0),
  CONSTRAINT "employee_leave_entitlements_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "employee_leave_entitlements_year_key" UNIQUE ("business_id", "membership_id", "policy_id", "leave_year_start")
);
CREATE INDEX "employee_leave_entitlements_scope_idx" ON "employee_leave_entitlements"("business_id", "membership_id", "leave_year_start");

CREATE TABLE "leave_balance_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "leave_year_start" DATE NOT NULL,
  "event_type" "LeaveLedgerEventType" NOT NULL,
  "units" DECIMAL(6,2) NOT NULL,
  "source_key" VARCHAR(200) NOT NULL,
  "leave_request_id" UUID,
  "entitlement_id" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "actor_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_balance_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_balance_ledger_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_policy_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_version_fkey" FOREIGN KEY ("policy_version_id", "business_id") REFERENCES "leave_policy_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_request_fkey" FOREIGN KEY ("leave_request_id", "business_id") REFERENCES "leave_requests"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_entitlement_fkey" FOREIGN KEY ("entitlement_id", "business_id") REFERENCES "employee_leave_entitlements"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "leave_balance_ledger_source_key" UNIQUE ("source_key"),
  CONSTRAINT "leave_balance_ledger_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_balance_ledger_units_check" CHECK ("units" <> 0)
);
CREATE INDEX "leave_balance_ledger_scope_idx" ON "leave_balance_ledger_entries"("business_id", "membership_id", "policy_id", "leave_year_start");
CREATE INDEX "leave_balance_ledger_request_idx" ON "leave_balance_ledger_entries"("leave_request_id", "event_type");

CREATE TABLE "leave_application_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "leave_request_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "event_type" "LeaveApplicationEventType" NOT NULL,
  "status_snapshot" "LeaveRequestStatus" NOT NULL,
  "reason" VARCHAR(500),
  "source_key" VARCHAR(200) NOT NULL,
  "actor_user_id" UUID,
  "actor_membership_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_application_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_application_events_request_fkey" FOREIGN KEY ("leave_request_id", "business_id") REFERENCES "leave_requests"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_application_events_actor_user_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "leave_application_events_actor_membership_fkey" FOREIGN KEY ("actor_membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_application_events_revision_key" UNIQUE ("leave_request_id", "revision"),
  CONSTRAINT "leave_application_events_source_key" UNIQUE ("source_key"),
  CONSTRAINT "leave_application_events_revision_check" CHECK ("revision" >= 0)
);
CREATE INDEX "leave_application_events_scope_idx" ON "leave_application_events"("business_id", "leave_request_id", "created_at");

INSERT INTO "leave_application_events" (
  "business_id", "leave_request_id", "revision", "event_type", "status_snapshot",
  "reason", "source_key", "actor_user_id", "created_at"
)
SELECT r."business_id", r."id", 0, 'SUBMITTED', 'PENDING', r."reason",
       'legacy-submit:' || r."id"::text, NULL, r."created_at"
FROM "leave_requests" r;

INSERT INTO "leave_application_events" (
  "business_id", "leave_request_id", "revision", "event_type", "status_snapshot",
  "reason", "source_key", "actor_user_id", "created_at"
)
SELECT r."business_id", r."id", 1,
       CASE r."status" WHEN 'APPROVED' THEN 'APPROVED'::"LeaveApplicationEventType"
                       WHEN 'REJECTED' THEN 'REJECTED'::"LeaveApplicationEventType"
                       ELSE 'WITHDRAWN'::"LeaveApplicationEventType" END,
       r."status", COALESCE(r."review_note", r."reason"),
       'legacy-decision:' || r."id"::text, r."reviewed_by_id", COALESCE(r."reviewed_at", r."cancelled_at", r."updated_at")
FROM "leave_requests" r
WHERE r."status" <> 'PENDING';

WITH entitlement_sources AS (
  SELECT DISTINCT b."business_id", b."membership_id", b."policy_id", b."year"
  FROM "employee_leave_balances" b
  UNION
  SELECT DISTINCT r."business_id", r."membership_id", r."policy_id", EXTRACT(YEAR FROM r."starts_on")::int
  FROM "leave_requests" r
  WHERE r."status" = 'APPROVED'
), resolved AS (
  SELECT s."business_id", s."membership_id", s."policy_id", s."year",
    m."joined_at", p."default_entitlement_days", p."under_two_years_days",
    p."two_to_five_years_days", p."five_years_plus_days", v."id" AS "version_id",
    GREATEST(0, EXTRACT(YEAR FROM AGE(make_date(s."year", 12, 31), m."joined_at"))::int) AS service_years,
    b."entitlement_override_days"
  FROM entitlement_sources s
  JOIN "employee_business_memberships" m ON m."id" = s."membership_id" AND m."business_id" = s."business_id"
  JOIN "leave_policies" p ON p."id" = s."policy_id" AND p."business_id" = s."business_id"
  JOIN "leave_policy_versions" v ON v."policy_id" = p."id" AND v."revision" = 1
  LEFT JOIN "employee_leave_balances" b ON b."membership_id" = s."membership_id" AND b."policy_id" = s."policy_id" AND b."year" = s."year"
)
INSERT INTO "employee_leave_entitlements" (
  "business_id", "membership_id", "policy_id", "policy_version_id", "leave_year_start", "leave_year_end",
  "entitled_units", "source", "source_digest", "created_at"
)
SELECT "business_id", "membership_id", "policy_id", "version_id", make_date("year", 1, 1), make_date("year", 12, 31),
  COALESCE("entitlement_override_days",
    CASE WHEN service_years < 2 THEN "under_two_years_days"
         WHEN service_years < 5 THEN "two_to_five_years_days"
         ELSE "five_years_plus_days" END,
    "default_entitlement_days", 0),
  'LEGACY_MIGRATION', encode(public.digest(
    "membership_id"::text || ':' || "policy_id"::text || ':' || "year"::text || ':legacy-entitlement', 'sha256'::text), 'hex'),
  CURRENT_TIMESTAMP
FROM resolved;

INSERT INTO "leave_balance_ledger_entries" (
  "business_id", "membership_id", "policy_id", "policy_version_id", "leave_year_start", "event_type", "units",
  "source_key", "entitlement_id", "reason", "created_at"
)
SELECT e."business_id", e."membership_id", e."policy_id", e."policy_version_id", e."leave_year_start", 'ENTITLEMENT',
       e."entitled_units", 'legacy-entitlement:' || e."id"::text, e."id", 'Legacy entitlement migrated with provenance.', e."created_at"
FROM "employee_leave_entitlements" e
WHERE e."entitled_units" <> 0;

INSERT INTO "leave_balance_ledger_entries" (
  "business_id", "membership_id", "policy_id", "policy_version_id", "leave_year_start", "event_type", "units",
  "source_key", "reason", "created_at"
)
SELECT b."business_id", b."membership_id", b."policy_id", v."id", make_date(b."year", 1, 1), 'CARRY_FORWARD',
       b."carried_forward_days", 'legacy-carry:' || b."id"::text, COALESCE(b."note", 'Legacy carry forward migrated.'), b."created_at"
FROM "employee_leave_balances" b
JOIN "leave_policy_versions" v ON v."policy_id" = b."policy_id" AND v."revision" = 1
WHERE b."carried_forward_days" <> 0;

INSERT INTO "leave_balance_ledger_entries" (
  "business_id", "membership_id", "policy_id", "policy_version_id", "leave_year_start", "event_type", "units",
  "source_key", "reason", "created_at"
)
SELECT b."business_id", b."membership_id", b."policy_id", v."id", make_date(b."year", 1, 1), 'MANUAL_ADJUSTMENT',
       b."adjustment_days", 'legacy-adjustment:' || b."id"::text, COALESCE(b."note", 'Legacy adjustment migrated.'), b."created_at"
FROM "employee_leave_balances" b
JOIN "leave_policy_versions" v ON v."policy_id" = b."policy_id" AND v."revision" = 1
WHERE b."adjustment_days" <> 0;

INSERT INTO "leave_balance_ledger_entries" (
  "business_id", "membership_id", "policy_id", "policy_version_id", "leave_year_start", "event_type", "units",
  "source_key", "leave_request_id", "reason", "actor_user_id", "created_at"
)
SELECT r."business_id", r."membership_id", r."policy_id", r."policy_version_id", make_date(EXTRACT(YEAR FROM r."starts_on")::int, 1, 1),
       'APPROVED_CONSUMPTION', -r."requested_days", 'legacy-approval:' || r."id"::text, r."id",
       'Legacy approved leave consumption migrated.', r."reviewed_by_id", COALESCE(r."reviewed_at", r."updated_at")
FROM "leave_requests" r
WHERE r."status" = 'APPROVED' AND r."balance_tracked_snapshot" = true;

CREATE OR REPLACE FUNCTION leave_immutable_row_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '%_IMMUTABLE', upper(TG_TABLE_NAME);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_policy_versions_immutable BEFORE UPDATE OR DELETE ON "leave_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER employee_leave_entitlements_immutable BEFORE UPDATE OR DELETE ON "employee_leave_entitlements"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER leave_balance_ledger_immutable BEFORE UPDATE OR DELETE ON "leave_balance_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER leave_application_events_immutable BEFORE UPDATE OR DELETE ON "leave_application_events"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER leave_request_days_immutable BEFORE UPDATE OR DELETE ON "leave_request_days"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();

CREATE OR REPLACE FUNCTION enforce_leave_final_closure_scope() RETURNS trigger AS $$
DECLARE
  policy_business UUID;
  version_business UUID;
  version_policy UUID;
BEGIN
  IF TG_TABLE_NAME = 'leave_policy_versions' THEN
    SELECT "business_id" INTO policy_business FROM "leave_policies" WHERE "id" = NEW."policy_id";
    IF policy_business IS NULL OR policy_business <> NEW."business_id" THEN
      RAISE EXCEPTION 'Leave policy version tenant mismatch';
    END IF;
    RETURN NEW;
  END IF;

  SELECT "business_id" INTO policy_business FROM "leave_policies" WHERE "id" = NEW."policy_id";
  SELECT "business_id", "policy_id" INTO version_business, version_policy FROM "leave_policy_versions" WHERE "id" = NEW."policy_version_id";
  IF policy_business IS NULL OR policy_business <> NEW."business_id" OR
     version_business IS NULL OR version_business <> NEW."business_id" OR version_policy <> NEW."policy_id" THEN
    RAISE EXCEPTION 'Leave final closure tenant or policy version mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_policy_versions_scope_guard BEFORE INSERT ON "leave_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION enforce_leave_final_closure_scope();
CREATE TRIGGER employee_leave_entitlements_scope_guard BEFORE INSERT ON "employee_leave_entitlements"
  FOR EACH ROW EXECUTE FUNCTION enforce_leave_final_closure_scope();
CREATE TRIGGER leave_balance_ledger_scope_guard BEFORE INSERT ON "leave_balance_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION enforce_leave_final_closure_scope();

CREATE OR REPLACE FUNCTION guard_leave_request_transition() RETURNS trigger AS $$
DECLARE
  self_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LEAVE_REQUEST_HISTORY_IMMUTABLE';
  END IF;

  IF OLD."status" IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'LEAVE_APPLICATION_UPDATED';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'LEAVE_APPLICATION_UPDATED';
  END IF;
  IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid leave transition';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'LEAVE_APPLICATION_UPDATED';
  END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."membership_id" <> OLD."membership_id" OR
     NEW."branch_id" <> OLD."branch_id" OR NEW."policy_id" <> OLD."policy_id" OR
     NEW."policy_version_id" <> OLD."policy_version_id" OR NEW."leave_unit" <> OLD."leave_unit" OR
     NEW."starts_on" <> OLD."starts_on" OR NEW."ends_on" <> OLD."ends_on" OR
     NEW."requested_days" <> OLD."requested_days" OR NEW."pay_treatment_snapshot" <> OLD."pay_treatment_snapshot" OR
     NEW."balance_tracked_snapshot" <> OLD."balance_tracked_snapshot" OR NEW."client_request_id" <> OLD."client_request_id" THEN
    RAISE EXCEPTION 'LEAVE_APPLICATION_FACTS_IMMUTABLE';
  END IF;

  IF NEW."status" IN ('APPROVED', 'REJECTED') THEN
    SELECT "id" INTO self_user FROM "users" WHERE "employee_business_membership_id" = NEW."membership_id";
    IF self_user IS NOT NULL AND self_user = NEW."reviewed_by_id" THEN
      RAISE EXCEPTION 'LEAVE_SELF_APPROVAL_FORBIDDEN';
    END IF;
  END IF;

  IF OLD."status" = 'APPROVED' AND NEW."status" = 'CANCELLED' THEN
    IF COALESCE(length(trim(NEW."cancellation_reason")), 0) < 3 THEN
      RAISE EXCEPTION 'Leave cancellation reason is required';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "attendance_p2_final_results" f
      JOIN "attendance_timesheet_p2_day_snapshots" s ON s."final_result_id" = f."id"
      JOIN "attendance_timesheet_revisions" tr ON tr."id" = s."revision_id"
      JOIN "attendance_monthly_timesheets" mt ON mt."current_revision_id" = tr."id" AND mt."status" = 'LOCKED'
      WHERE f."leave_request_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'LEAVE_LOCKED_TIMESHEET_REOPEN_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_request_transition_guard BEFORE UPDATE OR DELETE ON "leave_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_request_transition();

CREATE OR REPLACE FUNCTION guard_approved_leave_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'APPROVED' AND OLD."status" <> 'APPROVED' AND EXISTS (
    SELECT 1
    FROM "leave_request_days" proposed
    JOIN "leave_request_days" existing_day ON existing_day."membership_id" = proposed."membership_id"
      AND existing_day."leave_date" = proposed."leave_date"
      AND existing_day."leave_request_id" <> NEW."id"
    JOIN "leave_requests" existing_request ON existing_request."id" = existing_day."leave_request_id"
      AND existing_request."business_id" = NEW."business_id"
      AND existing_request."status" = 'APPROVED'
    WHERE proposed."leave_request_id" = NEW."id"
      AND (
        proposed."leave_unit" = 'FULL_DAY' OR existing_day."leave_unit" = 'FULL_DAY' OR
        proposed."leave_unit" = existing_day."leave_unit"
      )
  ) THEN
    RAISE EXCEPTION 'LEAVE_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leave_request_overlap_guard BEFORE UPDATE ON "leave_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_approved_leave_overlap();

CREATE OR REPLACE FUNCTION prevent_leave_policy_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "leave_policy_versions" WHERE "policy_id" = OLD."id") THEN
    RAISE EXCEPTION 'LEAVE_POLICY_HISTORY_IMMUTABLE';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leave_policy_delete_guard BEFORE DELETE ON "leave_policies"
  FOR EACH ROW EXECUTE FUNCTION prevent_leave_policy_delete();

COMMIT;
