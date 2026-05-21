-- AlterTable: persist Stage 1 context so reloading a saved project
-- restores everything the user typed / uploaded — not just the
-- post-extraction inventory.
--
--   paste_text    — the raw text the user pasted into Stage 1.
--   source_files  — array of { name, sizeBytes } for the files they
--                   uploaded. Bytes themselves are not stored; users
--                   re-upload if they want to redo extraction.
--   profile       — the AssessmentProfile returned by the classifier
--                   (pillar, confidence, signals, summary) so the
--                   "Detected by AI" badge in Stage 2 reappears.
ALTER TABLE "projects" ADD COLUMN "paste_text" TEXT;
ALTER TABLE "projects" ADD COLUMN "source_files" JSONB;
ALTER TABLE "projects" ADD COLUMN "profile" JSONB;
