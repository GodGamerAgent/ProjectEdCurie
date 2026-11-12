CREATE TABLE "demo_ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"pdf_mode" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_resource_analyses" ADD COLUMN "input_mode" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_topics" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "pdf_pages" integer;