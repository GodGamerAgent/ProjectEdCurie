ALTER TABLE "practice_problems" ADD COLUMN "question_version_id" uuid;--> statement-breakpoint
UPDATE "practice_problems" p SET "question_version_id"=qv."id"
FROM "questions" q JOIN "question_versions" qv ON qv."question_id"=q."id" AND qv."version"=q."version"
WHERE p."question_id"=q."id";--> statement-breakpoint
ALTER TABLE "practice_problems" ADD CONSTRAINT "practice_problems_question_version_id_question_versions_id_fk" FOREIGN KEY ("question_version_id") REFERENCES "public"."question_versions"("id") ON DELETE no action ON UPDATE no action;