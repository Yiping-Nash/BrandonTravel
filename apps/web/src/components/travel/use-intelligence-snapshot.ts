import { useEffect, useState } from "react";
import type { IntelligenceSnapshot, TravelTrip } from "@open-sunsama/types";
import { travelApi } from "./api";
export function useIntelligenceSnapshot(trip: TravelTrip | null) {
  const [data, setData] = useState<IntelligenceSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    setError("");
    if (!trip) return;
    let generation = 0;
    const controller = new AbortController();
    const load = async () => {
      const n = ++generation;
      try {
        const s = await travelApi<IntelligenceSnapshot>(
          `/trips/${trip.id}/intelligence-snapshot`,
          "GET",
          undefined,
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          n === generation &&
          s.evaluation.tripRevision === trip.revision &&
          Date.parse(s.expiresAt) > Date.now()
        ) {
          setData((old) =>
            old && old.evaluation.factsVersion > s.evaluation.factsVersion
              ? old
              : s,
          );
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted && n === generation) {
          setData(null);
          setError(e instanceof Error ? e.message : "读取失败");
        }
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    const update = () => void load();
    window.addEventListener("travel-facts-updated", update);
    window.addEventListener("focus", update);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("travel-facts-updated", update);
      window.removeEventListener("focus", update);
    };
  }, [trip?.id, trip?.revision]);
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(
      () => {
        setData(null);
        window.dispatchEvent(new Event("travel-facts-updated"));
      },
      Math.max(0, Date.parse(data.expiresAt) - Date.now()),
    );
    return () => clearTimeout(t);
  }, [data]);
  return { data, error };
}
