ALTER TABLE "appointments"
ADD COLUMN "assigned_staff_id" UUID;

CREATE INDEX "appointments_assigned_staff_id_idx"
ON "appointments"("assigned_staff_id");

ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_assigned_staff_id_fkey"
FOREIGN KEY ("assigned_staff_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
