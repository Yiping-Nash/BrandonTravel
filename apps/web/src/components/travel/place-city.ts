import type { TravelActivity, TravelTrip } from "@open-sunsama/types";
export function inferPlaceCity(trip: TravelTrip, activity: TravelActivity) {
  const current = trip.entities?.find((e) => e.id === activity.entityId)?.city;
  if (current) return { cities: [current], source: "当前已关联地点" };
  const ordered = [
    ...trip.activities.filter(
      (a) =>
        a.id !== activity.id && a.date === activity.date && a.start !== null,
    ),
    activity,
  ].sort(
    (a, b) =>
      (a.start ?? Infinity) - (b.start ?? Infinity) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  );
  const i = ordered.findIndex((a) => a.id === activity.id);
  const neighbors =
    activity.date && activity.start !== null
      ? [ordered[i - 1], ordered[i + 1]].filter(Boolean)
      : [];
  const cities = [
    ...new Set(
      neighbors.flatMap((a) => {
        const city = trip.entities?.find((e) => e.id === a?.entityId)?.city;
        return city ? [city] : [];
      }),
    ),
  ];
  if (cities.length) return { cities, source: "同日前后活动的已确认地点" };
  const all = [
    ...new Set(
      (trip.entities ?? [])
        .filter((e) => trip.activities.some((a) => a.entityId === e.id))
        .map((e) => e.city)
        .filter(Boolean),
    ),
  ];
  return {
    cities: all.length === 1 ? all : [],
    source: all.length === 1 ? "全行程已确认地点" : "暂无明确城市依据",
  };
}
