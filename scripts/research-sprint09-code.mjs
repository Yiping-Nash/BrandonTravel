import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
const root = path.resolve(".runtime/research-sprint09");
const m = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const selections = {
  "hykilpikonna/TrekForge": [
    "LICENSE",
    "NOTICE.md",
    "client/src/utils/openingHours.ts",
    "client/tests/unit/utils/openingHours.test.ts",
    "client/src/utils/daySchedule.ts",
    "client/src/utils/daySchedule.test.ts",
    "client/src/components/Planner/DayPlanSidebarRouteConnector.tsx",
    "client/src/components/Map/RouteCalculator.ts",
    "server/src/services/weatherService.ts",
    "server/tests/unit/services/weatherService.test.ts",
    "server/src/services/placeService.ts",
  ],
  "singfeehily/trip_planner": [
    "LICENSE",
    "server/src/services/weatherService.ts",
    "server/tests/unit/services/weatherService.test.ts",
    "server/src/services/placeService.ts",
    "client/src/components/Weather/WeatherWidget.tsx",
    "server/src/mcp/tools/mapsWeather.ts",
    "client/src/components/Planner/DayPlanSidebar.tsx",
    "client/src/components/Planner/DayPlanSidebar.test.tsx",
    "client/src/pages/TripPlannerPage.tsx",
    "client/src/components/Map/MapView.test.tsx",
  ],
  "Ripwords/ai-trip": [
    "LICENSE",
    "server/utils/schedule.ts",
    "server/utils/schedule.test.ts",
    "server/lib/itinerary-review.ts",
    "server/lib/itinerary-review.test.ts",
    "server/lib/google-maps.ts",
    "app/composables/useGenerateFullItinerary.ts",
    "server/lib/enrich.ts",
    "server/lib/enrich.test.ts",
    "server/api/trips/[id]/days/[dayId]/ai.post.ts",
  ],
  "Lagom-TA/JourneyPilot": [
    "LICENSE",
    "src/travel_agent/infrastructure/weather_provider.py",
    "src/travel_agent/entities/weather_planning.py",
    "src/travel_agent/services/weather_impact_engine.py",
    "src/travel_agent/services/authored_place_resolution.py",
    "src/travel_agent/tools/mcp_manager.py",
    "tests/test_provider_channels.py",
    "tests/test_temporal_tool_policy.py",
    "tests/agent_behavior/test_research_packet_identity_facts_routing.py",
  ],
  "zackchewa/awesome-china-mcp": ["LICENSE", "README.md"],
};
const evidence = [];
for (const repo of m) {
  for (const file of selections[repo.repo]) {
    if (!repo.files.some((f) => f.path === file)) {
      console.log("MISSING " + repo.repo + " " + file);
      continue;
    }
    const dest = path.join(root, "source", repo.repo.replace("/", "--"), file);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (!existsSync(dest)) {
      const r = await fetch(
        `https://api.github.com/repos/${repo.repo}/contents/${file}?ref=${repo.sha}`,
        {
          headers: {
            "User-Agent": "BrandonTravel-Sprint09-research",
            Accept: "application/vnd.github+json",
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!r.ok) throw Error("source HTTP " + r.status);
      const content = await r.json();
      writeFileSync(dest, Buffer.from(content.content, "base64"));
    }
    evidence.push({
      repo: repo.repo,
      commit: repo.sha,
      path: file,
      license: repo.license,
      url: `https://github.com/${repo.repo}/blob/${repo.sha}/${file}`,
    });
  }
  console.log("fetched " + repo.repo);
}
writeFileSync(
  path.join(root, "source-evidence.json"),
  JSON.stringify(evidence, null, 2),
);
