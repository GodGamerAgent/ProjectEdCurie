CREATE TABLE "mock_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_reviews" ADD CONSTRAINT "mock_reviews_session_id_adaptive_mock_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."adaptive_mock_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_reviews" ADD CONSTRAINT "mock_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_review_session_unique" ON "mock_reviews" USING btree ("session_id");