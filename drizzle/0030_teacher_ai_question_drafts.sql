CREATE TABLE "ai_question_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"source_quote" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_question_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_question_drafts" ADD CONSTRAINT "ai_question_drafts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_question_drafts" ADD CONSTRAINT "ai_question_drafts_generation_id_ai_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ai_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_question_drafts" ADD CONSTRAINT "ai_question_drafts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_question_drafts" ADD CONSTRAINT "ai_question_drafts_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "public"."resource_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_question_drafts" ADD CONSTRAINT "ai_question_drafts_accepted_question_id_questions_id_fk" FOREIGN KEY ("accepted_question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;