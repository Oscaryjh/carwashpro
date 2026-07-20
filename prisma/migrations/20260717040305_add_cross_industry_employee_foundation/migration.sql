-- CreateEnum
CREATE TYPE "EmployeeAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmployeeMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmployeeAttendanceStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employee_account_id" UUID;

-- CreateTable
CREATE TABLE "employee_accounts" (
    "id" UUID NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EmployeeAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_business_memberships" (
    "id" UUID NOT NULL,
    "employee_account_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "status" "EmployeeMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_business_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_branch_assignments" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attendance" (
    "id" UUID NOT NULL,
    "employee_account_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "EmployeeAttendanceStatus" NOT NULL DEFAULT 'OPEN',
    "clock_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_accounts_phone_normalized_key" ON "employee_accounts"("phone_normalized");

-- CreateIndex
CREATE INDEX "employee_accounts_status_idx" ON "employee_accounts"("status");

-- CreateIndex
CREATE INDEX "employee_business_memberships_business_id_status_idx" ON "employee_business_memberships"("business_id", "status");

-- CreateIndex
CREATE INDEX "employee_business_memberships_employee_account_id_status_idx" ON "employee_business_memberships"("employee_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_business_memberships_employee_account_id_business__key" ON "employee_business_memberships"("employee_account_id", "business_id");

-- CreateIndex
CREATE INDEX "employee_branch_assignments_business_id_branch_id_idx" ON "employee_branch_assignments"("business_id", "branch_id");

-- CreateIndex
CREATE INDEX "employee_branch_assignments_branch_id_idx" ON "employee_branch_assignments"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_branch_assignments_membership_id_branch_id_key" ON "employee_branch_assignments"("membership_id", "branch_id");

-- CreateIndex
CREATE INDEX "employee_attendance_business_id_branch_id_clock_in_at_idx" ON "employee_attendance"("business_id", "branch_id", "clock_in_at");

-- CreateIndex
CREATE INDEX "employee_attendance_employee_account_id_status_idx" ON "employee_attendance"("employee_account_id", "status");

-- CreateIndex
CREATE INDEX "employee_attendance_membership_id_status_idx" ON "employee_attendance"("membership_id", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_account_id_fkey" FOREIGN KEY ("employee_account_id") REFERENCES "employee_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_business_memberships" ADD CONSTRAINT "employee_business_memberships_employee_account_id_fkey" FOREIGN KEY ("employee_account_id") REFERENCES "employee_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_business_memberships" ADD CONSTRAINT "employee_business_memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_branch_assignments" ADD CONSTRAINT "employee_branch_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "employee_business_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_branch_assignments" ADD CONSTRAINT "employee_branch_assignments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_branch_assignments" ADD CONSTRAINT "employee_branch_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_employee_account_id_fkey" FOREIGN KEY ("employee_account_id") REFERENCES "employee_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "employee_business_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
