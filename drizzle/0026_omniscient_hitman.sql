CREATE TABLE "lesson_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutor_lessons" ADD COLUMN "requested_format" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_feedback" ADD CONSTRAINT "lesson_feedback_lesson_id_tutor_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."tutor_lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_feedback" ADD CONSTRAINT "lesson_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_feedback_lesson_unique" ON "lesson_feedback" USING btree ("lesson_id");