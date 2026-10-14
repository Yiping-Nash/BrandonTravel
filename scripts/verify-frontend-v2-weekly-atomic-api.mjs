import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8"));
const base = "http://127.0.0.1:4331/api";
const login = await (
  await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })
).json();
const token = login.data.token;
async function req(path, method = "GET", body, expected = 200) {
  const r = await fetch(base + "/travel" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(r.status, expected);
  return (await r.json()).data;
}
const t = await req(
  "/trips",
  "POST",
  {
    title: "周时间表原子扩展·隔离验收",
    startDate: "2026-10-13",
    endDate: "2026-10-15",
  },
  201,
);
const a = {
  id: randomUUID(),
  title: "扩展后新增",
  notes: "",
  place: "",
  date: "2026-10-16",
  start: 600,
  duration: 60,
  locked: false,
  position: 0,
};
const operations = [
  { type: "set_trip_range", startDate: t.startDate, endDate: a.date },
  { type: "add", activity: a },
];
const requestId = randomUUID();
const updated = await req("/trips/" + t.id + "/operations", "POST", {
  expectedRevision: t.revision,
  requestId,
  operations,
});
assert.equal(updated.endDate, a.date);
assert.equal(updated.revision, t.revision + 1);
assert.equal(updated.activities[0].id, a.id);
const replay = await req("/trips/" + t.id + "/operations", "POST", {
  expectedRevision: t.revision,
  requestId,
  operations,
});
assert.equal(replay.revision, updated.revision);
await req(
  "/trips/" + t.id + "/operations",
  "POST",
  {
    expectedRevision: t.revision,
    requestId: randomUUID(),
    operations: [
      { type: "set_trip_range", startDate: t.startDate, endDate: "2026-10-18" },
      { type: "add", activity: { ...a, id: randomUUID(), date: "2026-10-18" } },
    ],
  },
  409,
);
const before = await req("/trips/" + t.id);
assert.equal(before.endDate, a.date);
assert.equal(before.activities.length, 1);
await req(
  "/trips/" + t.id + "/operations",
  "POST",
  {
    expectedRevision: before.revision,
    requestId: randomUUID(),
    operations: [
      { type: "set_trip_range", startDate: t.startDate, endDate: "2026-10-18" },
      {
        type: "add",
        activity: {
          ...a,
          id: randomUUID(),
          date: "2026-10-18",
          start: 1430,
          duration: 60,
        },
      },
    ],
  },
  422,
);
const after = await req("/trips/" + t.id);
assert.deepEqual(after, before);
writeFileSync(
  "verification/frontend-v2-weekly-atomic-api.json",
  JSON.stringify(
    {
      tripId: t.id,
      checks: [
        "扩展与新增一次事务且revision只增加一次",
        "重复请求幂等",
        "并发冲突不部分扩展",
        "非法跨午夜不部分扩展",
      ],
      providerRequests: 0,
      modelRequests: 0,
    },
    null,
    2,
  ),
);
console.log("4项真实REST与数据库原子验收通过");
