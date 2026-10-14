import type { TravelEntity } from "@open-sunsama/types";
/** Approximate inverse GCJ-02; no precision beyond the upstream POI is claimed. */
export function gcj02ToWgs84(longitude: number, latitude: number) {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 85
  )
    throw Error("INVALID_COORDINATES");
  if (
    longitude < 72.004 ||
    longitude > 137.8347 ||
    latitude < 0.8293 ||
    latitude > 55.8271
  )
    return { longitude, latitude };
  const x = longitude - 105,
    y = latitude - 35,
    pi = Math.PI;
  let lat =
      -100 +
      2 * x +
      3 * y +
      0.2 * y * y +
      0.1 * x * y +
      0.2 * Math.sqrt(Math.abs(x)),
    lon =
      300 +
      x +
      2 * y +
      0.1 * x * x +
      0.1 * x * y +
      0.1 * Math.sqrt(Math.abs(x));
  lat += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  lat += ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3;
  lat +=
    ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  lon += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  lon += ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3;
  lon +=
    ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;
  const rad = (latitude / 180) * pi,
    magic = 1 - 0.00669342162296594323 * Math.sin(rad) ** 2,
    sqrt = Math.sqrt(magic);
  const dLat =
      (lat * 180) /
      (((6378245 * (1 - 0.00669342162296594323)) / (magic * sqrt)) * pi),
    dLon = (lon * 180) / ((6378245 / sqrt) * Math.cos(rad) * pi);
  return { longitude: longitude - dLon, latitude: latitude - dLat };
}
export function weatherLocation(e: TravelEntity) {
  const p = gcj02ToWgs84(e.longitude, e.latitude);
  const longitude = Number(p.longitude.toFixed(5)),
    latitude = Number(p.latitude.toFixed(5));
  return {
    longitude,
    latitude,
    key: "open-meteo:" + longitude.toFixed(5) + "," + latitude.toFixed(5),
    name: [e.city, e.name + "附近"].filter(Boolean).join(" · "),
  };
}
export function weatherFactKey(
  e: TravelEntity,
  kind: "daily_forecast" | "outlook",
) {
  return weatherLocation(e).key + ":" + kind;
}
