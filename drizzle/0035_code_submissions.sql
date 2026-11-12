CREATE TABLE "demo_code_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"verdict" text NOT NULL,
	"passed" integer NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_code_submissions" ADD CONSTRAINT "demo_code_submissions_question_id_demo_resource_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."demo_resource_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_code_submissions" ADD CONSTRAINT "demo_code_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;