import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
const base = "http://127.0.0.1:4331/api/travel";
const credential = process.argv[2];
if (!credential)
  throw Error(
    "Usage: node scripts/portfolio-demo.mjs .runtime/<isolated-account>.json; reset creates a NEW copy, never deletes or overwrites.",
  );
let account;
if (credential === "--new-account") {
  const email = "portfolio-" + Date.now() + "@example.com",
    password = "Bt" + randomBytes(24).toString("hex") + "9";
  const r = await fetch("http://127.0.0.1:4331/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "公开演示（虚构用户）" }),
  });
  const json = await r.json();
  if (!r.ok) throw Error("Demo registration failed: " + r.status);
  account = { email, password, token: json.data.token };
  writeFileSync(
    ".runtime/portfolio-account.json",
    JSON.stringify(account, null, 2),
  );
} else
  account = JSON.parse(readFileSync(credential, "utf8").replace(/^\uFEFF/, ""));
if (!account.token)
  throw Error(
    "Expected token in local ignored credential file. Never commit this file.",
  );
async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + account.token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) throw Error("Demo API failed: " + r.status);
  return json.data;
}
const fixture = JSON.parse(
  readFileSync(
    process.argv[3] ?? new URL("../fixtures/portfolio-trip.json", import.meta.url),
    "utf8",
  ),
);
const trip = await api("POST", "/trips", {
  title: fixture.title,
  startDate: fixture.startDate,
  endDate: fixture.endDate,
});
await api("POST", "/trips/" + trip.id + "/operations", {
  expectedRevision: trip.revision,
  requestId: randomUUID(),
  operations: fixture.activities.map((a) => ({
    type: "add",
    activity: { ...a, id: randomUUID() },
  })),
});
const saved = await api("GET", "/trips/" + trip.id);
if (
  saved.activities.length !== fixture.activities.length ||
  saved.revision !== 1
)
  throw Error("Persistence readback mismatch");
writeFileSync(
  ".runtime/portfolio-demo.json",
  JSON.stringify(
    {
      tripId: saved.id,
      revision: saved.revision,
      activities: saved.activities.length,
    },
    null,
    2,
  ),
);
console.log(
  "Created NEW synthetic copy: http://localhost:4331/trips/" +
    saved.id +
    "; revision " +
    saved.revision +
    ". No LLM/provider calls.",
);
