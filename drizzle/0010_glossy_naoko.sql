CREATE TABLE "lesson_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option" integer NOT NULL,
	"citations" jsonb NOT NULL,
	"selected_option" integer,
	"correct" boolean,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lesson_checks" ADD CONSTRAINT "lesson_checks_lesson_id_tutor_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."tutor_lessons"("id") ON DELETE no action ON UPDATE no action;