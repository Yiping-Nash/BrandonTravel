CREATE TABLE IF NOT EXISTS "travel_api_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"elapsed_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "travel_chat_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "travel_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "travel_route_estimates" (
	"trip_id" uuid NOT NULL,
	"transition_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"estimate" jsonb NOT NULL,
	CONSTRAINT "travel_route_estimates_trip_id_transition_id_pk" PRIMARY KEY("trip_id","transition_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_api_usage" ADD CONSTRAINT "travel_api_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_chat_runs" ADD CONSTRAINT "travel_chat_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_chat_runs" ADD CONSTRAINT "travel_chat_runs_trip_id_travel_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."travel_trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_events" ADD CONSTRAINT "travel_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_events" ADD CONSTRAINT "travel_events_trip_id_travel_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."travel_trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_route_estimates" ADD CONSTRAINT "travel_route_estimates_trip_id_travel_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."travel_trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
