CREATE TYPE "audit_decision" AS ENUM('allowed', 'blocked', 'needs_approval');--> statement-breakpoint
CREATE TYPE "audit_stage" AS ENUM('input', 'validation', 'cost', 'execution', 'output');--> statement-breakpoint
CREATE TYPE "request_source" AS ENUM('app', 'mcp', 'eval');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"question_id" uuid,
	"source" "request_source" NOT NULL,
	"stage" "audit_stage" NOT NULL,
	"decision" "audit_decision" NOT NULL,
	"rule" text NOT NULL,
	"message" text NOT NULL,
	"sql" text,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_decision_idx" ON "audit_events" ("decision");