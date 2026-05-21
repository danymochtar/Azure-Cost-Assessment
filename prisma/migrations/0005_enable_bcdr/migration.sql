-- AlterTable: persist the "BCDR — Azure Site Recovery" design parameter
-- so reloaded projects price the replication lines consistently. Default
-- false so existing rows match their pre-feature behaviour.
ALTER TABLE "projects" ADD COLUMN "enable_bcdr" BOOLEAN NOT NULL DEFAULT false;
