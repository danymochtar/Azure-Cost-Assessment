-- AlterTable: persist the optional Landing Zone customization. NULL
-- means "use whatever the tier picker resolves to"; a JSON array means
-- the user explicitly picked components in Stage 3's customise mode.
ALTER TABLE "projects" ADD COLUMN "landing_zone_components" JSONB;
ALTER TABLE "projects" ADD COLUMN "landing_zone_params" JSONB;
