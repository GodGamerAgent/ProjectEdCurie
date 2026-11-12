ALTER TABLE "study_attempts" ADD COLUMN "problem_id" uuid;--> statement-breakpoint
ALTER TABLE "study_attempts" ADD COLUMN "review_session_id" uuid;--> statement-breakpoint
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_problem_id_practice_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."practice_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_attempts_review_session_unique" ON "study_attempts" USING btree ("review_session_id");