CREATE TYPE "question_status" AS ENUM('running', 'awaiting_clarification', 'awaiting_approval', 'answered', 'blocked', 'cannot_answer', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"conversation_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" "question_status" DEFAULT 'running'::"question_status" NOT NULL,
	"final_sql" text,
	"answer" text,
	"explanation" text,
	"tables_used" jsonb,
	"assumptions" jsonb,
	"result_columns" jsonb,
	"row_count" integer,
	"truncated" boolean,
	"attempts" integer DEFAULT 0 NOT NULL,
	"trace" jsonb DEFAULT '[]' NOT NULL,
	"error_code" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"embedding_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12,6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "questions_conversation_created_idx" ON "questions" ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_question_id_questions_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id");