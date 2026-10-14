// Offline export only. Never makes model or provider requests.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = ".runtime/research-sprint09";
const read = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const evidence = read(root + "/provider-evidence.json"),
  budget = read(root + "/amap-budget.json");
assert.equal(evidence.modelRequests, 0);
assert.equal(evidence.amapRequests, budget.reserved);
assert.ok(budget.reserved <= 20);
assert.equal(evidence.planBefore.sha256, evidence.planAfter.sha256);
assert.ok(evidence.checks.every((c) => c.passed));
const summary = {};
for (const k of [
  "date",
  "kind",
  "status",
  "modelRequests",
  "amapRequests",
  "counts",
  "usage",
  "planBefore",
  "planAfter",
  "checks",
])
  summary[k] = evidence[k];
summary.maximum = 20;
summary.loginSessionHash = evidence.sessionId;
summary.localResponseEvidence = root + "/provider-evidence.json";
summary.samples = evidence.samples.map((s) => {
  const row = {};
  for (const k of [
    "name",
    "category",
    "endpoint",
    "status",
    "httpStatus",
    "elapsedMs",
    "queriedAt",
    "infocode",
    "error",
  ])
    if (s[k] !== undefined) row[k] = s[k];
  if (s.pois) {
    row.candidateCount = s.pois.length;
    row.withOpeningHours = s.pois.filter(
      (p) =>
        p.business && (p.business.opentime_today || p.business.opentime_week),
    ).length;
    row.withAdcode = s.pois.filter((p) => p.adcode).length;
  }
  if (s.forecasts)
    row.forecastCoverage = s.forecasts.map((f) => ({
      adcode: f.adcode,
      reporttime: f.reporttime,
      dates: f.casts.map((c) => c.date),
    }));
  if (s.route) row.firstPath = s.route.paths?.[0] ?? null;
  return row;
});
const manifest = read(root + "/manifest.json"),
  files = read(root + "/source-evidence.json");
for (const f of files) {
  const data = readFileSync(
    root + "/source/" + f.repo.replace("/", "--") + "/" + f.path,
  );
  f.sha256 = createHash("sha256").update(data).digest("hex");
  f.bytes = data.length;
  f.lines = data
    .toString("utf8")
    .split(/\r?\n/)
    .filter((_, i, a) => i < a.length - 1 || a[i] !== "").length;
}
const inputPaths = [
  "F:/Downloads/timetable intelligence brief.md",
  "F:/Downloads/BrandonTravel_Codex_Starter_Pack_v1/brandontravel_starter_pack/docs/ROADMAP_V2.MD",
];
const inputs = inputPaths.map((p) => ({
  path: p,
  sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
}));
mkdirSync("verification", { recursive: true });
writeFileSync(
  "verification/sprint09-provider.json",
  JSON.stringify(summary, null, 2) + "\n",
);
writeFileSync(
  "verification/sprint09-sources.json",
  JSON.stringify(
    {
      repositoryBaseline: "4bbbcf7",
      inputs,
      repositories: manifest.map(
        ({ repo, sha, commitDate, license, parent, source, truncated }) => ({
          repo,
          sha,
          commitDate,
          license,
          parent,
          source,
          truncated,
        }),
      ),
      inspectedFiles: files,
      upstreamTestsExecuted: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    offline: true,
    amapRequests: summary.amapRequests,
    modelRequests: 0,
    sourceFiles: files.length,
    checks: summary.checks.length,
  }),
);
