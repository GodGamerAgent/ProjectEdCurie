CREATE TABLE "demo_baselines" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"draft_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_onboardings" (
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"score" integer NOT NULL,
	"total" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_resource_analyses" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "enrolled_on" date;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_baselines" ADD CONSTRAINT "demo_baselines_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_onboardings" ADD CONSTRAINT "demo_onboardings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_onboardings" ADD CONSTRAINT "demo_onboardings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_resource_analyses" ADD CONSTRAINT "demo_resource_analyses_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_topics" ADD CONSTRAINT "demo_topics_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_onboardings_course_user_revision" ON "demo_onboardings" USING btree ("course_id","user_id","revision");--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_topic_id_demo_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."demo_topics"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "demo_topics" ("id","course_id","title")
SELECT "id","course_id","title" FROM "resources" WHERE "status" <> 'archived';
--> statement-breakpoint
UPDATE "resources" SET "topic_id" = "id" WHERE "status" <> 'archived';
