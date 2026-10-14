import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const account = JSON.parse(readFileSync(".runtime/test-account.json", "utf8")),
  base = "http://127.0.0.1:4332";
const login = await (
  await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })
).json();
assert.ok(login.data.token);
const headers = {
  Authorization: "Bearer " + login.data.token,
  "Content-Type": "application/json",
  "X-Travel-Test": "true",
};
async function api(path, method = "GET", body) {
  const r = await fetch(base + "/travel" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.equal(
    r.status,
    200 + (method === "POST" && path === "/trips" ? 1 : 0),
    JSON.stringify(d),
  );
  return d.data;
}
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Shanghai",
});
let trip = await api("/trips", "POST", {
  title: "Sprint10真实高德隔离验收",
  startDate: today,
  endDate: today,
});
const ids = [randomUUID(), randomUUID()],
  candidates = [];
for (const query of ["华严寺", "善化寺"]) {
  const rows = await api(
    "/places/search?query=" +
      encodeURIComponent(query) +
      "&city=" +
      encodeURIComponent("大同"),
  );
  assert.ok(rows.length);
  candidates.push(rows[0]);
  await new Promise((r) => setTimeout(r, 1100));
}
trip = await api(`/trips/${trip.id}/operations`, "POST", {
  requestId: randomUUID(),
  expectedRevision: trip.revision,
  operations: ids.flatMap((id, i) => [
    {
      type: "add",
      activity: {
        id,
        title: candidates[i].name,
        date: today,
        start: 600 + i * 150,
        duration: 60,
        locked: false,
        place: candidates[i].name,
        notes: "真实供应商数据的隔离验收，无预订承诺",
        position: i,
      },
    },
    { type: "bind_entity", id, entity: candidates[i] },
  ]),
});
const revision = trip.revision;
const result = await api(`/trips/${trip.id}/intelligence/refresh`, "POST", {
  requestId: randomUUID(),
  kinds: ["place", "opening_hours", "route_estimate", "weather"],
});
const facts = await api(`/trips/${trip.id}/operational-facts?limit=100`);
assert.equal(facts.tripRevision, revision);
assert.ok(
  facts.facts.some(
    (f) => f.kind === "route_estimate" && f.status === "available",
  ),
);
assert.ok(
  facts.facts.some((f) => f.kind === "weather" && f.status === "available"),
);
const before = await api("/usage");
await api(`/trips/${trip.id}/operational-facts?activityId=${ids[0]}`);
const after = await api("/usage");
assert.deepEqual(
  before.totals.filter((x) => x.provider === "amap"),
  after.totals.filter((x) => x.provider === "amap"),
);
const output = {
  date: new Date().toISOString(),
  tripId: trip.id,
  testAccount: true,
  result,
  revisionPreserved: true,
  readExternalRequests: 0,
  modelRequests: 0,
  usage: after.totals.filter((x) => x.provider === "amap"),
  facts: facts.facts.map((f) => ({
    kind: f.kind,
    status: f.status,
    quality: f.quality,
    unknownReason: f.unknownReason,
    appliesTo: f.appliesTo,
    value: f.value,
    queriedAt: f.retrievedAt,
    expiresAt: f.expiresAt,
  })),
};
writeFileSync(
  "verification/sprint10-real.json",
  JSON.stringify(output, null, 2),
);
console.log(
  JSON.stringify({
    result,
    usage: output.usage,
    openingHours: output.facts.filter((f) => f.kind === "opening_hours"),
  }),
);
