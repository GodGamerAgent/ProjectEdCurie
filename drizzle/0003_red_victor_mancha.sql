CREATE TABLE "concept_prerequisites" (
	"concept_id" uuid NOT NULL,
	"prerequisite_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"hints" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"kind" text DEFAULT 'practice' NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"correct" boolean NOT NULL,
	"assisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_goals" (
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"deadline" text NOT NULL,
	"availability" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baseline_submissions" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "baseline_submissions" ADD COLUMN "total" integer;--> statement-breakpoint
ALTER TABLE "baseline_submissions" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "concept_id" uuid;--> statement-breakpoint
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_prerequisite_id_concepts_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD CONSTRAINT "practice_problems_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD CONSTRAINT "practice_problems_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_problem_id_practice_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."practice_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_attempts" ADD CONSTRAINT "study_attempts_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_goals" ADD CONSTRAINT "study_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_goals" ADD CONSTRAINT "study_goals_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_prerequisites_unique" ON "concept_prerequisites" USING btree ("concept_id","prerequisite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_goals_unique" ON "study_goals" USING btree ("user_id","course_id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;