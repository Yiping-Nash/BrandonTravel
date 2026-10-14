import type { TravelTrip } from "@open-sunsama/types";
/** Display-only projection shared by the SVG and AMap renderers. */
export function mapPoints(trip: TravelTrip, date: string) {
  const activities = trip.activities
    .filter(
      (a) => a.date && a.start !== null && (date === "all" || a.date === date),
    )
    .sort(
      (a, b) =>
        a.date!.localeCompare(b.date!) ||
        a.start! - b.start! ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  const items = activities.flatMap((activity, i) => {
    const entity = trip.entities?.find((e) => e.id === activity.entityId);
    return entity ? [{ activity, entity, number: i + 1 }] : [];
  });
  return { items, missing: activities.length - items.length };
}
