ALTER TABLE "users"
ADD COLUMN "appointment_bookable" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users"
SET "appointment_bookable" = true
WHERE "role" = 'STAFF';
