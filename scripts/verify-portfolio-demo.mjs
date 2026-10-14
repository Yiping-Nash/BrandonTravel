import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const { token } = JSON.parse(
  readFileSync(".runtime/portfolio-account.json", "utf8"),
);
const fixture = JSON.parse(
  readFileSync("fixtures/portfolio-trip.json", "utf8"),
);
async function api(method, path, body) {
  const r = await fetch("http://127.0.0.1:4331/api/travel" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Error("Acceptance API status " + r.status);
  return j.data;
}
let t = await api("POST", "/trips", {
  title: "隔离发布验收副本（虚构）",
  startDate: fixture.startDate,
  endDate: fixture.endDate,
});
const ops = fixture.activities.map((a) => ({
  type: "add",
  activity: { ...a, id: randomUUID() },
}));
await api("POST", "/trips/" + t.id + "/operations", {
  expectedRevision: 0,
  requestId: randomUUID(),
  operations: ops,
});
t = await api("GET", "/trips/" + t.id);
assert.equal(t.activities.length, 22);
const initial = structuredClone(t);
await api("POST", "/trips/" + t.id + "/operations", {
  expectedRevision: t.revision,
  requestId: randomUUID(),
  operations: [
    { type: "set_trip_range", startDate: t.startDate, endDate: "2026-10-17" },
  ],
});
t = await api("GET", "/trips/" + t.id);
assert.equal(t.revision, 2);
assert.equal(t.activities.length, 22);
for (const old of initial.activities.filter((a) => a.date > "2026-10-17")) {
  const current = t.activities.find((a) => a.id === old.id);
  assert.equal(current.date, null);
  assert.equal(current.start, null);
  assert.equal(current.backlogOriginDate, old.date);
  assert.equal(current.title, old.title);
  assert.equal(current.duration, old.duration);
}
const before = structuredClone(t),
  target = t.activities.find((a) => a.start !== null);
const proposal = await api("POST", "/trips/" + t.id + "/proposals", {
  expectedRevision: t.revision,
  requestId: randomUUID(),
  reason: "确定性接口验收，非模型生成",
  operations: [
    { type: "edit", id: target.id, patch: { start: target.start + 15 } },
  ],
});
assert.equal(proposal.status, "pending");
assert.deepEqual(await api("GET", "/trips/" + t.id), before);
const confirmed = await api(
  "POST",
  "/proposals/" + proposal.id + "/confirm",
  {},
);
assert.equal(confirmed.status, "applied");
t = await api("GET", "/trips/" + t.id);
assert.equal(t.revision, 3);
for (const old of before.activities) {
  const current = t.activities.find((a) => a.id === old.id);
  assert.deepEqual(
    current,
    old.id === target.id ? { ...old, start: old.start + 15 } : old,
  );
}
writeFileSync(
  "verification/portfolio-demo.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      synthetic: true,
      activityCount: 22,
      passed: [
        "canonical API import/readback",
        "range preserves identity and origin grouping",
        "proposal leaves canonical unchanged",
        "confirmation changes only authorised activity",
      ],
      testType: "deterministic REST, no LLM/MCP claim",
      modelRequests: 0,
      providerRequests: 0,
    },
    null,
    2,
  ),
);
console.log("4 deterministic REST acceptance checks passed.");
