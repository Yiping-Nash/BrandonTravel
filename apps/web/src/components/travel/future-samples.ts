import type { TravelTrip } from "@open-sunsama/types";
import samples from "../../../../../fixtures/travel/future-plans.json";
import { travelApi } from "./api";

/** Only planned activities are imported. Mock operational facts never enter REST. */
export async function importFutureSamples(
  client = travelApi,
): Promise<TravelTrip[]> {
  const imported: TravelTrip[] = [];
  const current = await client<TravelTrip[]>("/trips");
  for (const fixture of samples.fixtures) {
    const source = fixture.trip as TravelTrip;
    const matches = current.filter(
      (t) =>
        t.title === source.title &&
        t.startDate === source.startDate &&
        t.endDate === source.endDate,
    );
    if (matches.length > 1)
      throw Error("已有多个同名模拟样例，请先选择保留哪一条，导入已停止");
    let trip =
      matches[0] ??
      (await client<TravelTrip>("/trips", "POST", {
        title: source.title,
        startDate: source.startDate,
        endDate: source.endDate,
      }));
    // Resume a partial import; preserve any existing edits and stable IDs.
    const existingIds = new Set(trip.activities.map((a) => a.id));
    const missing = source.activities.filter((a) => !existingIds.has(a.id));
    for (let i = 0; i < missing.length; i += 50) {
      trip = await client<TravelTrip>(`/trips/${trip.id}/operations`, "POST", {
        requestId: crypto.randomUUID(),
        expectedRevision: trip.revision,
        operations: missing
          .slice(i, i + 50)
          .map((activity) => ({ type: "add" as const, activity })),
      });
    }
    imported.push(trip);
  }
  return imported;
}
