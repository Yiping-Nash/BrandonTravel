import { useEffect, useState } from "react";
import type { FactSnapshot } from "@open-sunsama/types";
import { travelApi } from "./api";
export function useFacts(tripId: string, revision: number, enabled = true) {
  const [data, setData] = useState<FactSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let alive = true,
      generation = 0;
    setData(null);
    setError("");
    const load = async () => {
      const n = ++generation;
      try {
        let page = await travelApi<
          FactSnapshot & { nextCursor: number | null }
        >("/trips/" + tripId + "/operational-facts?limit=100");
        const facts = [...page.facts],
          sources = [...page.sources],
          version = page.factsVersion;
        while (page.nextCursor != null) {
          page = await travelApi<FactSnapshot & { nextCursor: number | null }>(
            "/trips/" +
              tripId +
              "/operational-facts?limit=100&cursor=" +
              page.nextCursor,
          );
          if (page.factsVersion !== version) return;
          facts.push(...page.facts);
          sources.push(...page.sources);
        }
        if (alive && n === generation && page.tripRevision === revision) {
          setData((prior) =>
            prior && prior.factsVersion > version
              ? prior
              : {
                  ...page,
                  facts,
                  sources: [...new Map(sources.map((s) => [s.id, s])).values()],
                },
          );
          setError("");
        }
      } catch (e) {
        if (alive && n === generation)
          setError(e instanceof Error ? e.message : "资料读取失败");
      }
    };
    void load();
    const tick = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    window.addEventListener("travel-facts-updated", load);
    return () => {
      alive = false;
      clearInterval(tick);
      window.removeEventListener("travel-facts-updated", load);
    };
  }, [tripId, revision, enabled]);
  return { data, error };
}
