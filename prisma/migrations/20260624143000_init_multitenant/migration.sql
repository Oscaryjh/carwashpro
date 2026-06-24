CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "BusinessStatus" AS ENUM ('active', 'inactive');
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'BUSINESS_OWNER', 'STAFF');
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive');

CREATE TABLE "businesses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "status" "BusinessStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");
CREATE INDEX "businesses_slug_idx" ON "businesses"("slug");

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_business_id_idx" ON "users"("business_id");
CREATE INDEX "users_role_idx" ON "users"("role");

ALTER TABLE "users"
  ADD CONSTRAINT "users_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER businesses_set_updated_at
BEFORE UPDATE ON "businesses"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
