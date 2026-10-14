import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
const dir = path.resolve(".runtime/research-sprint09");
mkdirSync(dir, { recursive: true });
const pins = {
  "hykilpikonna/TrekForge": "3524f2ca340d6ca880d713e3f66a3fedfc4bd88c",
  "singfeehily/trip_planner": "b25eb18ea42a34fda687780ef0d4e46c9aa31440",
  "Ripwords/ai-trip": "edfd0ad55a86b3d7d1a7c3f9884bf966e6737ec3",
  "Lagom-TA/JourneyPilot": "5e08d829a04048c6f6dba86b191813e22825c106",
  "zackchewa/awesome-china-mcp": "b8ac12f0d8c7cc4197cc0b9302665380c46a19c0",
};
const repos = [
  "hykilpikonna/TrekForge",
  "singfeehily/trip_planner",
  "Ripwords/ai-trip",
  "Lagom-TA/JourneyPilot",
  "zackchewa/awesome-china-mcp",
];
async function json(url) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "BrandonTravel-Sprint09-research",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("GitHub HTTP " + r.status);
  return r.json();
}
const manifest = [];
for (const repo of repos) {
  const cache = path.join(dir, repo.replace("/", "--") + ".json");
  let item;
  if (existsSync(cache)) item = JSON.parse(readFileSync(cache, "utf8"));
  else {
    const info = await json("https://api.github.com/repos/" + repo),
      commit = await json(
        "https://api.github.com/repos/" + repo + "/commits/" + pins[repo],
      );
    const tree = await json(
      "https://api.github.com/repos/" +
        repo +
        "/git/trees/" +
        commit.sha +
        "?recursive=1",
    );
    item = {
      repo,
      sha: commit.sha,
      commitDate: commit.commit.committer.date,
      branch: info.default_branch,
      license: info.license?.spdx_id ?? "unknown",
      fork: info.fork,
      parent: info.parent?.full_name ?? null,
      source: info.source?.full_name ?? null,
      truncated: tree.truncated,
      files: tree.tree
        .filter((f) => f.type === "blob")
        .map((f) => ({ path: f.path, size: f.size, sha: f.sha })),
    };
    writeFileSync(cache, JSON.stringify(item, null, 2));
  }
  manifest.push(item);
  console.log(
    JSON.stringify({
      repo,
      sha: item.sha,
      license: item.license,
      parent: item.parent,
      files: item.files.length,
      candidates: item.files
        .filter((f) =>
          /opening|schedule|itinerary|weather|routing|route.*service|place.*service|place.*model|constraint|feasib|validat.*trip|LICENSE|NOTICE|test.*scheduler|schedule.*test/i.test(
            f.path,
          ),
        )
        .map((f) => f.path)
        .slice(0, 65),
    }),
  );
}
writeFileSync(
  path.join(dir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
