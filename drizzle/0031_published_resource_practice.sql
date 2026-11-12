ALTER TABLE "practice_problems" ALTER COLUMN "question_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD COLUMN "generated_resource_version_id" uuid;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD COLUMN "generated_source_quote" text;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD COLUMN "generated_explanation" text;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD CONSTRAINT "practice_problems_generated_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("generated_resource_version_id") REFERENCES "public"."resource_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "concepts" ("course_id", "name", "resource_id")
SELECT r."course_id", r."title", r."id"
FROM "resources" r
JOIN "resource_versions" rv ON rv."resource_id" = r."id" AND rv."version" = r."version"
WHERE r."status" = 'published' AND rv."status" = 'published' AND length(btrim(rv."text")) > 0
  AND NOT EXISTS (SELECT 1 FROM "concepts" c WHERE c."resource_id" = r."id" AND c."course_id" = r."course_id");
