import { useState } from "react";
import type { TravelEntity, OperationalFact } from "@open-sunsama/types";
import { travelApi } from "./api";
import { FactEvidence, PlaceLink } from "./fact-evidence";
import { useFacts } from "./use-facts";
import { Button } from "@/components/ui";
export function PlaceDetails({
  tripId,
  revision,
  entity,
  pending,
}: {
  tripId: string;
  revision: number;
  entity: TravelEntity;
  pending: boolean;
}) {
  const { data, error: readError } = useFacts(tripId, revision, !pending),
    [preview, setPreview] = useState<OperationalFact[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const facts = pending
    ? preview
    : data?.facts.filter(
        (f) =>
          f.subjectKey === entity.id &&
          (f.kind === "place" || f.kind === "opening_hours"),
      );
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      if (pending) {
        const r = await travelApi<{ facts: OperationalFact[] }>(
          "/trips/" + tripId + "/place-preview",
          "POST",
          entity,
        );
        setPreview(r.facts);
      } else {
        await travelApi("/trips/" + tripId + "/intelligence/refresh", "POST", {
          requestId: crypto.randomUUID(),
          kinds: ["place", "opening_hours"],
          entityIds: [entity.id],
          force: false,
        });
        window.dispatchEvent(new Event("travel-facts-updated"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded border p-2 text-sm" data-place-details>
      <summary>地点资料与来源</summary>
      <div className="max-h-56 overflow-y-auto space-y-2 pt-2">
        <p>
          {pending ? "候选地点" : "确认地点"}：{entity.name} · {entity.city} ·{" "}
          {entity.address}
        </p>
        <PlaceLink poiId={entity.poiId} />
        <p className="text-xs text-muted-foreground">
          高德页面是当前信息；下方为本应用查询时的资料，不能证明历史日期营业。
        </p>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? "查询中…" : pending ? "查询候选详情" : "更新地点与营业资料"}
        </Button>
        {(error || readError) && <p role="alert">{error || readError}</p>}
        {!facts?.length && <p>尚无详情资料，点击查询；未提供字段不会补造。</p>}
        {facts?.map((f) => (
          <FactEvidence
            key={f.id}
            fact={f}
            source={{
              id: entity.id,
              providerId: "amap",
              externalId: entity.poiId,
              kind: "place",
              displayName: entity.name,
            }}
          />
        ))}
      </div>
    </details>
  );
}
