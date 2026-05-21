-- AlterTable: persist the CAF Landing Zone tier selected in Stage 3 so
-- saved projects reload with the same hub assumptions. Default 'none'
-- preserves the workload-only behaviour for projects saved before this
-- migration.
ALTER TABLE "projects" ADD COLUMN "landing_zone_tier" TEXT NOT NULL DEFAULT 'none';
