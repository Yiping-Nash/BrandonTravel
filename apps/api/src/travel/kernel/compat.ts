import type { KernelTrip, KernelSource, TravelTrip } from "@open-sunsama/types";
import { TravelError } from "../domain.js";
export function toCanonical(
  trip: TravelTrip,
  previous?: KernelTrip,
): { trip: KernelTrip; sources: KernelSource[] } {
  const sources = (trip.entities ?? []).map((e) => ({
    id: e.id,
    providerId: e.provider,
    externalId: e.poiId,
    kind: "place" as const,
    displayName: e.name,
  }));
  const { entities: _entities, ...body } = trip;
  const canonical: KernelTrip = {
    ...body,
    schemaVersion: 2,
    activities: trip.activities.map((a) => ({
      ...a,
      environment:
        previous?.activities.find((p) => p.id === a.id)?.environment ??
        "unspecified",
    })),
  };
  if (trip.entities)
    canonical.entities = trip.entities.map((e) => ({
      id: e.id,
      name: e.name,
      address: e.address,
      region: { name: e.city },
      coordinates: {
        longitude: e.longitude,
        latitude: e.latitude,
        coordinateSystem: e.coordinateSystem,
      },
      selectedAt: e.selectedAt,
      sourceRefIds: [e.id],
    }));
  return { trip: canonical, sources };
}
export function toLegacy(
  state: TravelTrip | KernelTrip,
  sources: KernelSource[] = [],
): TravelTrip {
  if (!("schemaVersion" in state)) return state;
  const { schemaVersion: _version, entities: _entities, ...data } = state;
  const trip: TravelTrip = {
    ...data,
    activities: state.activities.map(
      ({ environment: _environment, ...a }) => a,
    ),
    entities: undefined,
  };
  if (state.entities)
    trip.entities = state.entities.map((e) => {
      const source = sources.find(
        (s) => e.sourceRefIds.includes(s.id) && s.providerId === "amap",
      );
      if (!source) throw new TravelError("旧地点来源不可表达", 409);
      return {
        id: e.id,
        provider: "amap",
        poiId: source.externalId,
        name: e.name,
        address: e.address,
        city: e.region.name,
        longitude: e.coordinates.longitude,
        latitude: e.coordinates.latitude,
        coordinateSystem: e.coordinates.coordinateSystem,
        selectedAt: e.selectedAt,
      };
    });
  return trip;
}
