CREATE TABLE "staff_role_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_role_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "service_fixed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "service_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "product_fixed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "product_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "package_fixed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "package_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_levels_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "users" ADD COLUMN "staff_role_profile_id" UUID;
ALTER TABLE "users" ADD COLUMN "staff_level_id" UUID;

CREATE UNIQUE INDEX "staff_role_profiles_business_id_name_key" ON "staff_role_profiles"("business_id", "name");
CREATE INDEX "staff_role_profiles_business_id_active_idx" ON "staff_role_profiles"("business_id", "active");
CREATE UNIQUE INDEX "staff_levels_business_id_name_key" ON "staff_levels"("business_id", "name");
CREATE INDEX "staff_levels_business_id_active_idx" ON "staff_levels"("business_id", "active");
CREATE INDEX "users_staff_role_profile_id_idx" ON "users"("staff_role_profile_id");
CREATE INDEX "users_staff_level_id_idx" ON "users"("staff_level_id");

ALTER TABLE "staff_role_profiles" ADD CONSTRAINT "staff_role_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_levels" ADD CONSTRAINT "staff_levels_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_staff_role_profile_id_fkey" FOREIGN KEY ("staff_role_profile_id") REFERENCES "staff_role_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_staff_level_id_fkey" FOREIGN KEY ("staff_level_id") REFERENCES "staff_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
