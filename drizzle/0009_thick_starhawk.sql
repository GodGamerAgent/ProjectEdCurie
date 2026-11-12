CREATE TABLE "practice_twin_links" (
	"original_problem_id" uuid PRIMARY KEY NOT NULL,
	"twin_problem_id" uuid NOT NULL,
	"linked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_twin_links_twin_problem_id_unique" UNIQUE("twin_problem_id")
);
--> statement-breakpoint
CREATE TABLE "practice_twin_sessions" (
	"original_session_id" uuid PRIMARY KEY NOT NULL,
	"twin_session_id" uuid NOT NULL,
	CONSTRAINT "practice_twin_sessions_twin_session_id_unique" UNIQUE("twin_session_id")
);
--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "practice_twin_links" ADD CONSTRAINT "practice_twin_links_original_problem_id_practice_problems_id_fk" FOREIGN KEY ("original_problem_id") REFERENCES "public"."practice_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_twin_links" ADD CONSTRAINT "practice_twin_links_twin_problem_id_practice_problems_id_fk" FOREIGN KEY ("twin_problem_id") REFERENCES "public"."practice_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_twin_links" ADD CONSTRAINT "practice_twin_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_twin_sessions" ADD CONSTRAINT "practice_twin_sessions_original_session_id_practice_sessions_id_fk" FOREIGN KEY ("original_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_twin_sessions" ADD CONSTRAINT "practice_twin_sessions_twin_session_id_practice_sessions_id_fk" FOREIGN KEY ("twin_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE no action ON UPDATE no action;