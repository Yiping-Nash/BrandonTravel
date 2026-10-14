import type { TravelTrip, IntelligenceSnapshot } from "@open-sunsama/types";
export type RefreshKind = "weather" | "route_estimate";
/** Only server-derived states decide validity; the UI never recalculates freshness. */
export function refreshDemand(
  trip: TravelTrip,
  snapshot: IntelligenceSnapshot | null,
): RefreshKind[] {
  if (!snapshot || snapshot.evaluation.tripRevision !== trip.revision)
    return [];
  const kinds: RefreshKind[] = [];
  if (
    (snapshot.days ?? []).some(
      (d) =>
        d.weatherQuery?.canQuery &&
        d.regions.some(
          (r) =>
            r.status !== "AVAILABLE" &&
            r.status !== "OUT_OF_RANGE" &&
            !(
              r.status === "NOT_PROVIDED" &&
              r.factRefs.some((ref) =>
                snapshot.facts.some(
                  (f) => f.id === ref.id && f.freshness === "fresh",
                ),
              )
            ),
        ),
    )
  )
    kinds.push("weather");
  if (
    (snapshot.connections ?? []).some((c) => {
      const from = trip.activities.find((a) => a.id === c.fromId),
        to = trip.activities.find((a) => a.id === c.toId);
      return !!from?.entityId && !!to?.entityId && c.state === "UNKNOWN";
    })
  )
    kinds.push("route_estimate");
  return kinds;
}
export function refreshInputKey(trip: TravelTrip, kind: RefreshKind) {
  return JSON.stringify([
    kind,
    trip.activities
      .filter((a) => a.date && a.start !== null)
      .map((a) => [
        a.id,
        a.date,
        a.entityId,
        kind === "route_estimate" ? a.start : null,
        kind === "route_estimate" ? a.duration : null,
      ]),
    trip.entities?.map((e) => [e.id, e.longitude, e.latitude]),
    kind === "route_estimate" ? trip.transitionModes : null,
  ]);
}
export type RefreshAttempt = { input: string; nextAttemptAt: number };
export function attemptAllowed(
  attempt: RefreshAttempt | null,
  input: string,
  now: number,
) {
  return !attempt || attempt.input !== input || now >= attempt.nextAttemptAt;
}
