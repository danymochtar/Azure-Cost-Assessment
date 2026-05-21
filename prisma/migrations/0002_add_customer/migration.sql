-- DropIndex
DROP INDEX IF EXISTS "uniq_user_project_name";

-- AlterTable: add customer with empty-string default so the migration is
-- safe to apply against an existing populated table; the default is
-- stripped immediately after so new rows must supply a value.
ALTER TABLE "projects" ADD COLUMN "customer" TEXT NOT NULL DEFAULT '';
ALTER TABLE "projects" ALTER COLUMN "customer" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "uniq_user_customer_project_name" ON "projects"("user_id", "customer", "name");
