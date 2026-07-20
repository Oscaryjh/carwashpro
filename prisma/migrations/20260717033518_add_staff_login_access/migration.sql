-- AlterTable
ALTER TABLE "users" ADD COLUMN     "login_enabled" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "password_hash" DROP NOT NULL;
