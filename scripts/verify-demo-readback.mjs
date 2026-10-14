import { readFileSync, writeFileSync } from "node:fs";
const account = JSON.parse(readFileSync(".runtime/demo-account.json", "utf8"));
const response = await fetch("http://127.0.0.1:4331/api/travel/trips", {
  headers: { Authorization: "Bearer " + account.token },
});
if (!response.ok) throw Error("Readback failed");
const data = (await response.json()).data;
if (data.length !== 1 || data[0].activities.length !== 12)
  throw Error("Demo restore mismatch");
writeFileSync(
  "verification/demo-readback.json",
  JSON.stringify(
    {
      date: "2026-10-06",
      tripId: data[0].id,
      activityCount: 12,
      timezone: data[0].timezone,
      revision: data[0].revision,
      readback: true,
    },
    null,
    2,
  ),
);
console.log("大同12活动已在应用与数据库重启后读回");
