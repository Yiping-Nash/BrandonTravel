import type { Sql } from "postgres";
import type { KernelTrip, KernelSource, TravelTrip } from "@open-sunsama/types";
import { toCanonical, toLegacy } from "./compat.js";
export async function sources(
  sql: Sql,
  tripId: string,
): Promise<KernelSource[]> {
  const rows =
    await sql`SELECT source FROM travel_source_references WHERE trip_id=${tripId}`;
  return rows.map((r) => r.source as KernelSource);
}
export async function legacy(
  sql: Sql,
  state: TravelTrip | KernelTrip,
): Promise<TravelTrip> {
  return toLegacy(
    state,
    "schemaVersion" in state ? await sources(sql, state.id) : [],
  );
}
export async function persist(
  sql: Sql,
  user: string,
  trip: TravelTrip,
  previous?: KernelTrip,
  create = false,
) {
  const converted = toCanonical(trip, previous);
  if (create)
    await sql`INSERT INTO travel_trips(id,user_id,state) VALUES(${trip.id},${user},${sql.json(converted.trip)})`;
  for (const s of converted.sources)
    await sql`INSERT INTO travel_source_references(trip_id,user_id,id,source) VALUES(${trip.id},${user},${s.id},${sql.json(s)}) ON CONFLICT(trip_id,id) DO UPDATE SET source=excluded.source`;
  if (!create)
    await sql`UPDATE travel_trips SET state=${sql.json(converted.trip)} WHERE id=${trip.id} AND user_id=${user}`;
  return converted.trip;
}
