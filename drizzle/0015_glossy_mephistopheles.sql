CREATE TABLE "study_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"explanation" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"version" integer NOT NULL,
	"deadline" text NOT NULL,
	"feasibility_score" integer NOT NULL,
	"required_minutes" integer NOT NULL,
	"capacity_minutes" integer NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_plans_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "learning_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "practice_minutes" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "revision_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "difficulty" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_availability" ADD COLUMN "session_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "study_blocks" ADD CONSTRAINT "study_blocks_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_blocks" ADD CONSTRAINT "study_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_blocks" ADD CONSTRAINT "study_blocks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_blocks" ADD CONSTRAINT "study_blocks_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;