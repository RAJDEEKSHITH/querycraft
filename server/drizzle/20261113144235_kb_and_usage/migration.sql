CREATE TYPE "example_source" AS ENUM('seed', 'feedback', 'admin');--> statement-breakpoint
CREATE TYPE "example_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "column_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"schema_name" text NOT NULL,
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "column_values_column_value_key" UNIQUE("schema_name","table_name","column_name","value")
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"day" date,
	"source" "request_source",
	"llm_tokens" integer DEFAULT 0 NOT NULL,
	"embedding_tokens" integer DEFAULT 0 NOT NULL,
	"llm_requests" integer DEFAULT 0 NOT NULL,
	"embedding_requests" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12,6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_usage_pkey" PRIMARY KEY("day","source")
);
--> statement-breakpoint
CREATE TABLE "examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"question" text NOT NULL,
	"sql" text NOT NULL,
	"status" "example_status" NOT NULL,
	"source" "example_source" NOT NULL,
	"content_hash" text,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"term" text NOT NULL CONSTRAINT "glossary_terms_term_key" UNIQUE,
	"definition" text NOT NULL,
	"sql_hint" text,
	"content_hash" text,
	"embedding" vector(768),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"schema_name" text NOT NULL,
	"table_name" text NOT NULL,
	"description" text NOT NULL,
	"columns" jsonb NOT NULL,
	"content_hash" text,
	"embedding" vector(768),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_tables_schema_table_key" UNIQUE("schema_name","table_name")
);
--> statement-breakpoint
CREATE INDEX "column_values_value_trgm_idx" ON "column_values" USING gin ("value" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "examples_status_idx" ON "examples" ("status");--> statement-breakpoint
CREATE INDEX "examples_embedding_idx" ON "examples" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "glossary_terms_embedding_idx" ON "glossary_terms" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "schema_tables_embedding_idx" ON "schema_tables" USING hnsw ("embedding" vector_cosine_ops);