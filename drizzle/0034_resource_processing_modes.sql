CREATE TABLE "demo_resource_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"prompt" text NOT NULL,
	"quote" text DEFAULT '' NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"answer_source" text DEFAULT 'pending' NOT NULL,
	"coding" jsonb,
	"coding_status" text,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_resource_analyses" ADD COLUMN "processing_mode" text;--> statement-breakpoint
ALTER TABLE "demo_resource_analyses" ADD COLUMN "theory_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD COLUMN "processing_mode" text;--> statement-breakpoint
ALTER TABLE "resource_versions" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "processing_mode" text;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "summary_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_resource_questions" ADD CONSTRAINT "demo_resource_questions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_resource_questions_resource" ON "demo_resource_questions" ("resource_id","position");
--> statement-breakpoint
INSERT INTO "demo_resource_questions" ("resource_id","position","origin","prompt","quote","source_ref","answer","answer_source")
SELECT a."resource_id",
  ((part.ordinality - 1) * 1000 + problem.ordinality - 1)::integer,
  'extracted',
  problem.value->>'prompt',
  coalesce(problem.value->>'quote',''),
  CASE WHEN part.value ? 'page' THEN 'Page ' || (part.value->>'page') ELSE 'Section ' || part.ordinality END,
  coalesce(problem.value->>'answer',''),
  CASE WHEN btrim(coalesce(problem.value->>'answer','')) <> '' THEN 'document' ELSE 'pending' END
FROM "demo_resource_analyses" a
JOIN "resources" r ON r."id" = a."resource_id" AND r."version" = a."version"
CROSS JOIN LATERAL jsonb_array_elements(a."parts") WITH ORDINALITY AS part(value, ordinality)
CROSS JOIN LATERAL jsonb_array_elements(coalesce(part.value->'problems','[]'::jsonb)) WITH ORDINALITY AS problem(value, ordinality)
WHERE coalesce(problem.value->>'prompt','') <> '';
--> statement-breakpoint
UPDATE "resources" r SET "summary" = s."summary"
FROM (
  SELECT a."resource_id", string_agg(
    CASE WHEN part.value ? 'page' THEN '## Page ' || (part.value->>'page') ELSE '## Section ' || part.ordinality END
      || E'\n\n' || coalesce(part.value->>'summary',''), E'\n\n' ORDER BY part.ordinality) AS "summary"
  FROM "demo_resource_analyses" a
  JOIN "resources" r2 ON r2."id" = a."resource_id" AND r2."version" = a."version"
  CROSS JOIN LATERAL jsonb_array_elements(a."parts") WITH ORDINALITY AS part(value, ordinality)
  GROUP BY a."resource_id"
) s
WHERE r."id" = s."resource_id" AND r."summary" = '';
