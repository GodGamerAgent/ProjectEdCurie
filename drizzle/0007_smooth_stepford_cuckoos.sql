CREATE TABLE "question_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"resource_version_id" uuid,
	"concept_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"extraction_status" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"file_data" "bytea",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "resource_version_id" uuid;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tutor_lessons" ADD COLUMN "resource_version_id" uuid;--> statement-breakpoint
INSERT INTO "resource_versions" ("resource_id","version","title","text","status","extraction_status","file_name","mime_type","file_data","created_at")
SELECT "id","version","title","text","status","extraction_status","file_name","mime_type","file_data","created_at" FROM "resources";--> statement-breakpoint
UPDATE "questions" q SET "resource_version_id"=rv."id" FROM "resource_versions" rv WHERE rv."resource_id"=q."resource_id" AND rv."version"=1;--> statement-breakpoint
INSERT INTO "question_versions" ("question_id","version","prompt","answer","resource_version_id","concept_id","created_at")
SELECT "id","version","prompt","answer","resource_version_id","concept_id",now() FROM "questions";--> statement-breakpoint
UPDATE "tutor_lessons" tl SET "resource_version_id"=rv."id"
FROM "resource_versions" rv WHERE rv."resource_id"=(tl."citations"->0->>'resourceId')::uuid AND rv."version"=1;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "public"."resource_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_versions_question_version_unique" ON "question_versions" USING btree ("question_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_resource_version_unique" ON "resource_versions" USING btree ("resource_id","version");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "public"."resource_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_lessons" ADD CONSTRAINT "tutor_lessons_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "public"."resource_versions"("id") ON DELETE no action ON UPDATE no action;