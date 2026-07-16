ALTER TABLE "services"
ADD COLUMN "duration_minutes" INTEGER;

CREATE TABLE "service_staff_assignments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_staff_assignments_service_id_user_id_key"
ON "service_staff_assignments"("service_id", "user_id");

CREATE INDEX "service_staff_assignments_business_id_idx"
ON "service_staff_assignments"("business_id");

CREATE INDEX "service_staff_assignments_user_id_idx"
ON "service_staff_assignments"("user_id");

ALTER TABLE "service_staff_assignments"
ADD CONSTRAINT "service_staff_assignments_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_staff_assignments"
ADD CONSTRAINT "service_staff_assignments_service_id_fkey"
FOREIGN KEY ("service_id") REFERENCES "services"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_staff_assignments"
ADD CONSTRAINT "service_staff_assignments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
