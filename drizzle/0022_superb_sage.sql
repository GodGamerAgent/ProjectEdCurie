CREATE TABLE "assignment_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"misconception_code" text,
	"reviewed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD COLUMN "misconception_code" text;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD COLUMN "verified_evidence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "concept_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_evidence" ADD CONSTRAINT "assignment_evidence_submission_id_assignment_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."assignment_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evidence" ADD CONSTRAINT "assignment_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evidence" ADD CONSTRAINT "assignment_evidence_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evidence" ADD CONSTRAINT "assignment_evidence_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_evidence" ADD CONSTRAINT "assignment_evidence_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_evidence_submission_unique" ON "assignment_evidence" USING btree ("submission_id");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;