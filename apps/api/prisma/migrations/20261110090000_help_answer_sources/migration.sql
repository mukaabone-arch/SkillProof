-- Help assistant: record where each answer came from (pre-built library,
-- cache of an earlier live answer, or a live AI call) and the cache key.
ALTER TABLE "HelpQuestion" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "HelpQuestion" ADD COLUMN "normalizedQuestion" TEXT;
ALTER TABLE "HelpQuestion" ADD COLUMN "guideHash" TEXT;
CREATE INDEX "HelpQuestion_audience_normalizedQuestion_idx" ON "HelpQuestion"("audience", "normalizedQuestion");
