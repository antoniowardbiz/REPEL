-- Model's free-trial OF link (redirect target) + per-VA tracking slug.
ALTER TABLE "Creator" ADD COLUMN "ofTrialUrl" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "trackSlug" TEXT;
CREATE UNIQUE INDEX "Assignment_trackSlug_key" ON "Assignment"("trackSlug");
