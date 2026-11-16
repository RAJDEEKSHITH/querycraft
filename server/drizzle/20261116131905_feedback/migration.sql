CREATE TYPE "feedback_rating" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"question_id" uuid NOT NULL UNIQUE,
	"rating" "feedback_rating" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_question_id_questions_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id");