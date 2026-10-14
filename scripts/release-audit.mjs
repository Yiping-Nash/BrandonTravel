import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const args = ["-c", "safe.directory=" + process.cwd().replaceAll("\\", "/")];
const git = (...a) =>
  execFileSync("git", [...args, ...a], { maxBuffer: 128 * 1024 * 1024 });
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["model-key", /\bsk-[A-Za-z0-9._-]{24,}/],
  [
    "github-token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
  ],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    "bearer-jwt",
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/,
  ],
];
const localSecrets = [];
function collect(value, key = "") {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collect(v, k);
  } else if (
    typeof value === "string" &&
    value.length >= 16 &&
    /key|secret|password/i.test(key)
  )
    localSecrets.push(value);
}
for (const file of [
  ".runtime/config.json",
  ".runtime/amap.json",
  ".runtime/model-api.json",
  ".runtime/amap-js.json",
]) {
  try {
    collect(JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
  } catch {}
}
const findings = [];
let trackedFiles = 0,
  historyBlobs = 0,
  skippedLargeBlobs = 0;
function scan(text, location, scope) {
  if (localSecrets.some((value) => text.includes(value)))
    findings.push({ scope, location, rule: "local-config-credential-literal" });
  for (const [rule, pattern] of rules)
    if (pattern.test(text)) findings.push({ scope, location, rule });
}
for (const file of git("ls-files", "-z")
  .toString()
  .split("\0")
  .filter(Boolean)) {
  try {
    const data = readFileSync(file);
    trackedFiles++;
    if (data.length < 5e6) scan(data.toString(), file, "working-tree");
  } catch {}
}
const objects = git("rev-list", "--objects", "--all")
  .toString()
  .split("\n")
  .filter(Boolean);
const ids = objects.map((x) => x.split(" ")[0]);
const paths = new Map(
  objects.map((x) => [x.split(" ")[0], x.slice(x.indexOf(" ") + 1)]),
);
const metadata = execFileSync("git", [...args, "cat-file", "--batch-check"], {
  input: ids.join("\n") + "\n",
  maxBuffer: 128 * 1024 * 1024,
})
  .toString()
  .trim()
  .split("\n");
const selected = metadata
  .filter((x) => {
    const [, type, size] = x.split(" ");
    if (type === "blob" && Number(size) >= 5e6) skippedLargeBlobs++;
    return type === "blob" && Number(size) < 5e6;
  })
  .map((x) => x.split(" ")[0]);
const data = execFileSync("git", [...args, "cat-file", "--batch"], {
  input: selected.join("\n") + "\n",
  maxBuffer: 512 * 1024 * 1024,
});
let offset = 0;
while (offset < data.length) {
  const end = data.indexOf(10, offset);
  const [oid, , size] = data.subarray(offset, end).toString().split(" ");
  offset = end + 1;
  scan(
    data.subarray(offset, offset + Number(size)).toString(),
    paths.get(oid) || oid,
    "history",
  );
  historyBlobs++;
  offset += Number(size) + 1;
}
writeFileSync(
  "verification/release-audit.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      head: git("rev-parse", "HEAD").toString().trim(),
      trackedFiles,
      historyBlobs,
      skippedLargeBlobs,
      findings,
      limitations:
        "Heuristic only. No entropy, PII/image or supplier validation. Never emits matched values. Not publication approval.",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    trackedFiles,
    historyBlobs,
    skippedLargeBlobs,
    findings: findings.length,
  }),
);
