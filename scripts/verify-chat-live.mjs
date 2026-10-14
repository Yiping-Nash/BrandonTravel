import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const a = JSON.parse(readFileSync(".runtime/next-account.json", "utf8"));
const headers = {
    Authorization: "Bearer " + a.token,
    "Content-Type": "application/json",
    "X-Travel-Test": "true",
  },
  base = "http://127.0.0.1:4331/api/travel";
let calls = 0,
  runs = [];
async function api(path, method = "GET", body, extra = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { ...headers, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.ok(r.ok, `${r.status}: ${d.error?.message}`);
  return d.data;
}
let trip = await api("/trips/" + a.tripId);
const temple = trip.activities.find((x) => x.title === "善化寺");
if (temple.start === null) {
  trip = await api(`/trips/${trip.id}/operations`, "POST", {
    expectedRevision: trip.revision,
    requestId: randomUUID(),
    operations: [{ type: "edit", id: temple.id, patch: { start: 720 } }],
  });
}
await api(`/trips/${trip.id}/transitions/refresh`, "POST", { force: false });
async function ask(message) {
  assert.ok(calls < 10);
  const run = await api(
    `/trips/${trip.id}/chat`,
    "POST",
    { requestId: randomUUID(), message },
    { "X-Travel-Model-Limit": String(Math.min(6, 10 - calls)) },
  );
  let completed;
  const stopAt = Date.now() + 95000;
  while (Date.now() < stopAt) {
    const all = await api(`/trips/${trip.id}/chat`);
    completed = all.find((x) => x.id === run.id);
    if (completed.status !== "running") break;
    await new Promise((r) => setTimeout(r, 600));
  }
  assert.ok(completed);
  calls += completed.requests;
  assert.ok(calls <= 10);
  runs.push(completed);
  console.log("聊天完成:", completed.status, "模型请求", completed.requests);
  return completed;
}
const before = await api("/trips/" + trip.id);
const run = await ask(
  "把华严寺改到第一天下午两点（14:00），保留60分钟时长。请提出提案，等我在网页确认。",
);
assert.equal(run.status, "done", JSON.stringify(run.events));
assert.ok(run.events.some((e) => e.name === "get_trip" && e.status === "done"));
const event = run.events.find(
  (e) => e.name === "propose_trip_change" && e.status === "done",
);
assert.ok(event?.proposalId, JSON.stringify(run.events));
const unchanged = await api("/trips/" + trip.id);
assert.equal(unchanged.revision, before.revision);
const proposal = await api("/proposals/" + event.proposalId);
assert.equal(proposal.status, "pending");
assert.equal(
  proposal.after.activities.find((x) => x.title === "华严寺").start,
  840,
);
writeFileSync(
  ".runtime/live-chat-case.json",
  JSON.stringify({ ...a, proposalId: event.proposalId }),
);
writeFileSync(
  "verification/chat-live.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      mcpTransport:
        "SDK InMemoryTransport linked client/server; actual initialize/listTools/callTool",
      calls,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        requests: r.requests,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        tools: r.events
          .filter((e) => e.kind === "tool")
          .map((e) => ({
            name: e.name,
            status: e.status,
            proposalId: e.proposalId,
          })),
      })),
      proposalPending: true,
      stateUnchangedBeforeConfirm: true,
    },
    null,
    2,
  ),
);
console.log("真实聊天MCP读取与提案完成，行程未直接修改");
