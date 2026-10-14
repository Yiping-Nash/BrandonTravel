import { readFileSync, writeFileSync } from "node:fs";
await import("../apps/api/node_modules/tsx/dist/loader.mjs");
const { parseWeather } =
  await import("../apps/api/src/travel/kernel/open-meteo.ts");
const p = {
  longitude: 113.3,
  latitude: 40.08,
  key: "isolated-point",
  name: "探测坐标附近",
};
const output = [];
for (const [file, kind] of [
  ["forecast", "daily_forecast"],
  ["outlook", "outlook"],
]) {
  const raw = JSON.parse(readFileSync(".runtime/sprint18/" + file + ".json"));
  const f = parseWeather(raw, p, kind);
  output.push({
    kind,
    rawDates: raw.daily.time.length,
    usableDates: f.days.length,
    first: f.days[0].date,
    last: f.days.at(-1).date,
    omittedDates: raw.daily.time.filter(
      (d) => !f.days.some((x) => x.date === d),
    ),
    members: f.memberCount,
    sourcePublishedAt: null,
  });
}
writeFileSync(
  "verification/sprint18-probe-parsed.json",
  JSON.stringify(
    { checks: output, newHttpRequests: 0, actualRecordedResponses: true },
    null,
    2,
  ),
);
console.log(JSON.stringify(output));
