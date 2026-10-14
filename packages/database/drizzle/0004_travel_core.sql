CREATE TABLE IF NOT EXISTS travel_trips (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), state jsonb NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS travel_requests (user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL, trip_id uuid NOT NULL REFERENCES travel_trips(id), payload jsonb NOT NULL, result jsonb NOT NULL, PRIMARY KEY(user_id, request_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS travel_proposals (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), trip_id uuid NOT NULL REFERENCES travel_trips(id), state jsonb NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS travel_keys (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), digest text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
