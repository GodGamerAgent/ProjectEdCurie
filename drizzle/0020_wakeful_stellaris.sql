ALTER TABLE "assignment_submissions" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD COLUMN "file_data" "bytea";--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD COLUMN "extraction_status" text DEFAULT 'manual' NOT NULL;