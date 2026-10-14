import {
  pgTable,
  uuid,
  jsonb,
  text,
  timestamp,
  primaryKey,
  foreignKey,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import type { TravelTrip, TravelProposal } from "@open-sunsama/types";
export const travelTrips = pgTable(
  "travel_trips",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    state: jsonb("state").$type<TravelTrip>().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "travel_trips_user_id_fkey",
    }),
  ],
);
export const travelRequests = pgTable(
  "travel_requests",
  {
    userId: uuid("user_id").notNull(),
    requestId: uuid("request_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    payload: jsonb("payload").notNull(),
    result: jsonb("result").$type<TravelTrip>().notNull(),
  },
  (t) => [
    primaryKey({
      name: "travel_requests_pkey",
      columns: [t.userId, t.requestId],
    }),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "travel_requests_user_id_fkey",
    }),
    foreignKey({
      columns: [t.tripId],
      foreignColumns: [travelTrips.id],
      name: "travel_requests_trip_id_fkey",
    }),
  ],
);
export const travelProposals = pgTable(
  "travel_proposals",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    state: jsonb("state").$type<TravelProposal>().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "travel_proposals_user_id_fkey",
    }),
    foreignKey({
      columns: [t.tripId],
      foreignColumns: [travelTrips.id],
      name: "travel_proposals_trip_id_fkey",
    }),
  ],
);
export const travelKeys = pgTable(
  "travel_keys",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    digest: text("digest").notNull().unique("travel_keys_digest_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "travel_keys_user_id_fkey",
    }),
  ],
);

export const travelRouteEstimates = pgTable(
  "travel_route_estimates",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => travelTrips.id, { onDelete: "cascade" }),
    transitionId: text("transition_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    estimate: jsonb("estimate").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.transitionId] })],
);
export const travelApiUsage = pgTable(
  "travel_api_usage",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id").notNull(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    elapsedMs: integer("elapsed_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("travel_api_usage_session_idx").on(
      t.userId,
      t.sessionId,
      t.createdAt,
    ),
  ],
);
export const travelChatRuns = pgTable("travel_chat_runs", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => travelTrips.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const travelEvents = pgTable("travel_events", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => travelTrips.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
