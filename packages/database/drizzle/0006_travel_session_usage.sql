ALTER TABLE "travel_api_usage" ADD COLUMN "session_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_api_usage" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "travel_api_usage" ADD COLUMN "output_tokens" integer;