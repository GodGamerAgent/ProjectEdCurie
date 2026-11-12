CREATE TABLE "practice_diagnostic_sessions" (
	"diagnostic_session_id" uuid PRIMARY KEY NOT NULL,
	"parent_session_id" uuid NOT NULL,
	CONSTRAINT "practice_diagnostic_sessions_parent_session_id_unique" UNIQUE("parent_session_id")
);
--> statement-breakpoint
ALTER TABLE "practice_sessions" DROP CONSTRAINT "practice_sessions_parent_session_id_practice_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "practice_diagnostic_sessions" ADD CONSTRAINT "practice_diagnostic_sessions_diagnostic_session_id_practice_sessions_id_fk" FOREIGN KEY ("diagnostic_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_diagnostic_sessions" ADD CONSTRAINT "practice_diagnostic_sessions_parent_session_id_practice_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" DROP COLUMN "parent_session_id";