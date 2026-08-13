CREATE TYPE "RosterPeriodStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "RosterAssignmentKind" AS ENUM ('WORK_SHIFT', 'REST_DAY', 'NOT_SCHEDULED');
CREATE TYPE "RosterEvidenceDisposition" AS ENUM ('APPLIED', 'RETROSPECTIVE_REVIEW_REQUIRED');

CREATE TABLE "roster_periods" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "week_start" DATE NOT NULL,
  "status" "RosterPeriodStatus" NOT NULL DEFAULT 'DRAFT',
  "draft_revision" INTEGER NOT NULL DEFAULT 0,
  "publication_revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roster_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roster_periods_week_start_monday_check" CHECK (EXTRACT(ISODOW FROM "week_start") = 1),
  CONSTRAINT "roster_periods_revision_check" CHECK ("draft_revision" >= 0 AND "publication_revision" >= 0)
);

CREATE TABLE "roster_assignments" (
  "id" UUID NOT NULL,
  "roster_period_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "kind" "RosterAssignmentKind" NOT NULL,
  "start_at" TIMESTAMP(3),
  "end_at" TIMESTAMP(3),
  "break_minutes" INTEGER NOT NULL DEFAULT 0,
  "note" VARCHAR(500),
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roster_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roster_assignments_shape_check" CHECK (
    ("kind" = 'WORK_SHIFT' AND "start_at" IS NOT NULL AND "end_at" IS NOT NULL AND "end_at" > "start_at" AND "end_at" <= "start_at" + INTERVAL '24 hours') OR
    ("kind" <> 'WORK_SHIFT' AND "start_at" IS NULL AND "end_at" IS NULL AND "break_minutes" = 0)
  ),
  CONSTRAINT "roster_assignments_break_check" CHECK ("break_minutes" >= 0 AND "break_minutes" <= 720)
);

CREATE TABLE "roster_publications" (
  "id" UUID NOT NULL,
  "roster_period_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "operation_key" VARCHAR(128) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "reason" VARCHAR(500),
  "published_by_id" UUID NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roster_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roster_publications_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "roster_publications_digest_check" CHECK ("source_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "roster_published_assignments" (
  "id" UUID NOT NULL,
  "publication_id" UUID NOT NULL,
  "source_assignment_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "kind" "RosterAssignmentKind" NOT NULL,
  "start_at" TIMESTAMP(3),
  "end_at" TIMESTAMP(3),
  "break_minutes" INTEGER NOT NULL,
  "note" VARCHAR(500),
  "timezone_snapshot" VARCHAR(100) NOT NULL,
  "evidence_disposition" "RosterEvidenceDisposition" NOT NULL DEFAULT 'APPLIED',
  "evidence_reference" VARCHAR(160),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roster_published_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roster_published_assignments_shape_check" CHECK (
    ("kind" = 'WORK_SHIFT' AND "start_at" IS NOT NULL AND "end_at" IS NOT NULL AND "end_at" > "start_at") OR
    ("kind" <> 'WORK_SHIFT' AND "start_at" IS NULL AND "end_at" IS NULL AND "break_minutes" = 0)
  ),
  CONSTRAINT "roster_published_assignments_break_check" CHECK ("break_minutes" >= 0 AND "break_minutes" <= 720)
);

CREATE UNIQUE INDEX "roster_periods_business_branch_week_key" ON "roster_periods"("business_id", "branch_id", "week_start");
CREATE UNIQUE INDEX "roster_periods_id_business_key" ON "roster_periods"("id", "business_id");
CREATE INDEX "roster_periods_business_week_status_idx" ON "roster_periods"("business_id", "week_start", "status");
CREATE INDEX "roster_periods_business_branch_week_idx" ON "roster_periods"("business_id", "branch_id", "week_start");

CREATE UNIQUE INDEX "roster_assignments_period_member_date_key" ON "roster_assignments"("roster_period_id", "membership_id", "work_date");
CREATE UNIQUE INDEX "roster_assignments_business_member_date_key" ON "roster_assignments"("business_id", "membership_id", "work_date");
CREATE UNIQUE INDEX "roster_assignments_id_business_key" ON "roster_assignments"("id", "business_id");
CREATE INDEX "roster_assignments_business_branch_date_idx" ON "roster_assignments"("business_id", "branch_id", "work_date");
CREATE INDEX "roster_assignments_business_member_interval_idx" ON "roster_assignments"("business_id", "membership_id", "start_at", "end_at");

CREATE UNIQUE INDEX "roster_publications_period_revision_key" ON "roster_publications"("roster_period_id", "revision");
CREATE UNIQUE INDEX "roster_publications_business_operation_key" ON "roster_publications"("business_id", "operation_key");
CREATE UNIQUE INDEX "roster_publications_id_business_key" ON "roster_publications"("id", "business_id");
CREATE INDEX "roster_publications_business_branch_published_idx" ON "roster_publications"("business_id", "branch_id", "published_at");
CREATE INDEX "roster_publications_business_period_revision_idx" ON "roster_publications"("business_id", "roster_period_id", "revision");

CREATE UNIQUE INDEX "roster_published_assignments_publication_member_date_key" ON "roster_published_assignments"("publication_id", "membership_id", "work_date");
CREATE UNIQUE INDEX "roster_published_assignments_id_business_key" ON "roster_published_assignments"("id", "business_id");
CREATE INDEX "roster_published_assignments_business_branch_date_idx" ON "roster_published_assignments"("business_id", "branch_id", "work_date");
CREATE INDEX "roster_published_assignments_business_member_date_idx" ON "roster_published_assignments"("business_id", "membership_id", "work_date");
CREATE INDEX "roster_published_assignments_publication_source_idx" ON "roster_published_assignments"("publication_id", "source_assignment_id");

ALTER TABLE "roster_periods"
  ADD CONSTRAINT "roster_periods_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_periods_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_periods_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_periods_updated_by_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "roster_assignments"
  ADD CONSTRAINT "roster_assignments_period_scope_fkey" FOREIGN KEY ("roster_period_id", "business_id") REFERENCES "roster_periods"("id", "business_id") ON DELETE CASCADE,
  ADD CONSTRAINT "roster_assignments_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_assignments_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_assignments_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_assignments_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_assignments_updated_by_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "roster_publications"
  ADD CONSTRAINT "roster_publications_period_scope_fkey" FOREIGN KEY ("roster_period_id", "business_id") REFERENCES "roster_periods"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_publications_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_publications_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_publications_published_by_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "roster_published_assignments"
  ADD CONSTRAINT "roster_published_assignments_publication_scope_fkey" FOREIGN KEY ("publication_id", "business_id") REFERENCES "roster_publications"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_published_assignments_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_published_assignments_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "roster_published_assignments_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION tetamu_roster_period_scope_guard() RETURNS trigger AS $$
DECLARE period_row RECORD;
BEGIN
  SELECT business_id, branch_id, week_start INTO period_row FROM roster_periods WHERE id = NEW.roster_period_id;
  IF period_row IS NULL OR period_row.business_id <> NEW.business_id OR period_row.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Roster assignment period scope mismatch';
  END IF;
  IF NEW.work_date < period_row.week_start OR NEW.work_date >= period_row.week_start + 7 THEN
    RAISE EXCEPTION 'Roster assignment must fall inside its weekly period';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "roster_assignment_period_scope_guard"
BEFORE INSERT OR UPDATE ON "roster_assignments"
FOR EACH ROW EXECUTE FUNCTION tetamu_roster_period_scope_guard();

CREATE OR REPLACE FUNCTION tetamu_roster_publication_scope_guard() RETURNS trigger AS $$
DECLARE parent_row RECORD;
BEGIN
  SELECT business_id, branch_id INTO parent_row FROM roster_periods WHERE id = NEW.roster_period_id;
  IF parent_row IS NULL OR parent_row.business_id <> NEW.business_id OR parent_row.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Roster publication period scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "roster_publication_period_scope_guard"
BEFORE INSERT ON "roster_publications"
FOR EACH ROW EXECUTE FUNCTION tetamu_roster_publication_scope_guard();

CREATE OR REPLACE FUNCTION tetamu_roster_published_assignment_scope_guard() RETURNS trigger AS $$
DECLARE publication_row RECORD;
BEGIN
  SELECT business_id, branch_id INTO publication_row FROM roster_publications WHERE id = NEW.publication_id;
  IF publication_row IS NULL OR publication_row.business_id <> NEW.business_id OR publication_row.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Published roster assignment scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "roster_published_assignment_scope_guard"
BEFORE INSERT ON "roster_published_assignments"
FOR EACH ROW EXECUTE FUNCTION tetamu_roster_published_assignment_scope_guard();

CREATE OR REPLACE FUNCTION tetamu_roster_immutable_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Published roster history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "roster_publications_immutable_guard"
BEFORE UPDATE OR DELETE ON "roster_publications"
FOR EACH ROW EXECUTE FUNCTION tetamu_roster_immutable_guard();

CREATE TRIGGER "roster_published_assignments_immutable_guard"
BEFORE UPDATE OR DELETE ON "roster_published_assignments"
FOR EACH ROW EXECUTE FUNCTION tetamu_roster_immutable_guard();
