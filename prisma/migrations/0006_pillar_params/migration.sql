-- AlterTable: persist per-Solution-Area use-case parameters (OpenAI
-- token volumes, Fabric capacity, SQL vCores, Entra user counts, etc.)
-- so reloaded projects re-price with the same inputs. NULL means
-- "use the pillar module's defaults".
ALTER TABLE "projects" ADD COLUMN "pillar_params" JSONB;
