CREATE TABLE "roster_shift_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(80) NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "color_token" VARCHAR(20) NOT NULL DEFAULT 'TEAL',
    "cross_midnight" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_shift_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roster_shift_templates_time_bounds" CHECK (
      "start_minute" >= 0 AND "start_minute" < 1440
      AND "end_minute" >= 0 AND "end_minute" < 1440
      AND "start_minute" <> "end_minute"
      AND "break_minutes" >= 0 AND "break_minutes" < 1440
    )
);

CREATE UNIQUE INDEX "roster_shift_templates_id_business_id_key"
ON "roster_shift_templates"("id", "business_id");

CREATE UNIQUE INDEX "roster_shift_templates_scoped_name_key"
ON "roster_shift_templates"("business_id", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));

CREATE INDEX "roster_shift_templates_business_id_branch_id_active_idx"
ON "roster_shift_templates"("business_id", "branch_id", "active");

CREATE INDEX "roster_shift_templates_business_id_name_idx"
ON "roster_shift_templates"("business_id", "name");

ALTER TABLE "roster_shift_templates"
ADD CONSTRAINT "roster_shift_templates_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roster_shift_templates"
ADD CONSTRAINT "roster_shift_templates_branch_id_business_id_fkey"
FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roster_shift_templates"
ADD CONSTRAINT "roster_shift_templates_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roster_shift_templates"
ADD CONSTRAINT "roster_shift_templates_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roster_assignments"
ADD COLUMN "shift_template_id" UUID,
ADD COLUMN "shift_name_snapshot" VARCHAR(80),
ADD COLUMN "shift_color_snapshot" VARCHAR(20),
ADD COLUMN "cross_midnight_snapshot" BOOLEAN;

ALTER TABLE "roster_assignments"
ADD CONSTRAINT "roster_assignments_shift_template_id_business_id_fkey"
FOREIGN KEY ("shift_template_id", "business_id") REFERENCES "roster_shift_templates"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roster_published_assignments"
ADD COLUMN "shift_template_id" UUID,
ADD COLUMN "shift_name_snapshot" VARCHAR(80),
ADD COLUMN "shift_color_snapshot" VARCHAR(20),
ADD COLUMN "cross_midnight_snapshot" BOOLEAN;
