import postgres from "postgres";
import type { TravelTrip } from "@open-sunsama/types";
import { legacy } from "./kernel/repository.js";
import { TravelError } from "./domain.js";
let connection: ReturnType<typeof postgres>;
export const db = () =>
  (connection ??= postgres(process.env.DATABASE_URL!, {
    max: 5,
    connect_timeout: 3,
  }));
export async function ownedTrip(user: string, id: string): Promise<TravelTrip> {
  const rows =
    await db()`SELECT state FROM travel_trips WHERE id=${id} AND user_id=${user}`;
  if (!rows[0]) throw new TravelError("行程不存在", 404);
  return legacy(db(), rows[0].state);
}
