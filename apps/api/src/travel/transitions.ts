import {
  routeResult,
  scheduled,
} from "@open-sunsama/utils/travel-intelligence";
import { DEFAULT_TRAVEL_MODE } from "@open-sunsama/utils/travel-contract";
import { createHash } from "node:crypto";
import type {
  TravelTrip,
  TravelTransition,
  TravelEstimate,
  FactView,
} from "@open-sunsama/types";
export const ROUTE_TTL = 20 * 60 * 1000;
export function transitions(
  trip: TravelTrip,
  estimates: Record<string, TravelEstimate> = {},
  now = Date.now(),
): TravelTransition[] {
  const result: TravelTransition[] = [];
  const activities = scheduled(trip);
  for (let i = 1; i < activities.length; i++) {
    const from = activities[i - 1]!,
      to = activities[i]!;
    if (from.date !== to.date) continue;
    const id = `${from.id}:${to.id}`,
      mode = trip.transitionModes?.[id] ?? DEFAULT_TRAVEL_MODE;
    const a = trip.entities?.find((e) => e.id === from.entityId),
      b = trip.entities?.find((e) => e.id === to.entityId);
    const fingerprint =
      a && b
        ? createHash("sha256")
            .update(
              JSON.stringify([
                a.poiId,
                a.longitude,
                a.latitude,
                b.poiId,
                b.longitude,
                b.latitude,
                mode,
              ]),
            )
            .digest("hex")
        : null;
    const estimate = fingerprint ? (estimates[fingerprint] ?? null) : null;
    const gapMinutes = to.start! - (from.start! + from.duration);
    const freshness =
      !estimate || estimate.status !== "ready"
        ? "unknown"
        : now - Date.parse(estimate.queriedAt) < ROUTE_TTL
          ? "fresh"
          : "stale";
    const fact: FactView | undefined = estimate
      ? {
          id: "legacy-route",
          version: 1,
          kind: "route_estimate",
          subjectKey: id,
          inputFingerprint: fingerprint!,
          sourceRefId: null,
          collectionId: null,
          status: estimate.status === "ready" ? "available" : "failed",
          retrievedAt: estimate.queriedAt,
          sourcePublishedAt: null,
          expiresAt: new Date(
            Date.parse(estimate.queriedAt) + ROUTE_TTL,
          ).toISOString(),
          retryAfter: null,
          appliesTo: { dates: [], regionRef: null, basis: "current_estimate" },
          quality: estimate.status === "ready" ? "complete" : "failed",
          value:
            estimate.status === "ready"
              ? {
                  kind: "route_estimate",
                  distanceMeters: estimate.distanceMeters!,
                  durationSeconds: estimate.durationSeconds!,
                  mode,
                  fromEntityId: from.entityId!,
                  toEntityId: to.entityId!,
                }
              : null,
          error: null,
          freshness,
          unknownReason: null,
        }
      : undefined;
    const evaluation = routeResult(from, to, mode, fact, now);
    result.push({
      id,
      fromId: from.id,
      toId: to.id,
      date: from.date!,
      mode,
      fingerprint,
      gapMinutes,
      estimate,
      freshness,
      shortageMinutes:
        evaluation.rule === "TRANSITION_GAP"
          ? evaluation.details.shortageMinutes
          : null,
    });
  }
  return result;
}
