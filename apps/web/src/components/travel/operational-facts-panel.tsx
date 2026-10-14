import { FactEvidence } from "./fact-evidence";
import { useState } from "react";
import { useFacts } from "./use-facts";
import { travelApi } from "./api";
import { Button } from "@/components/ui";
const reasons: Record<string, string> = {
  PARSE_PENDING: "营业原文需按日期判读；覆盖结果见计划检查",
  FACT_STALE: "资料已过期，请刷新",
  FACT_MISSING: "供应商未提供这项资料",
  FACT_INPUT_MISMATCH: "计划或地点已变化，需要重新查询",
  RATE_LIMIT: "供应商限流，请稍后重试",
  QUOTA_EXHAUSTED: "供应商额度不足",
  PROVIDER_PERMISSION: "当前Key没有此能力权限",
  PROVIDER_FAILED: "查询失败，请稍后重试",
  PLACE_CHANGED_CONFIRMATION_REQUIRED: "供应商地点信息已变化，请重新确认地点",
};
const labels = {
  place: "地点详情",
  opening_hours: "营业原文",
  route_estimate: "当前路程估计",
  weather: "天气资料",
};
export function OperationalFactsPanel({
  tripId,
  revision,
}: {
  tripId: string;
  revision: number;
}) {
  const { data, error: readError } = useFacts(tripId, revision);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId, setRequestId] = useState<string | null>(null);
  async function stopRefresh() {
    if (!requestId) return;
    try {
      await travelApi(
        `/trips/${tripId}/intelligence/refresh/${requestId}/cancel`,
        "POST",
        {},
      );
      setError("已请求停止，当前查询结束后不再继续。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "停止失败");
    }
  }
  async function refresh() {
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    setRequestId(id);
    try {
      const result = await travelApi<{
        attempted: number;
        blocked: number;
        cancelled: boolean;
      }>(`/trips/${tripId}/intelligence/refresh`, "POST", {
        requestId: id,
        kinds: ["place", "opening_hours", "route_estimate", "weather"],
        force: false,
      });
      window.dispatchEvent(new Event("travel-facts-updated"));
      if (result.cancelled) setError("刷新已停止；已经取得的资料保留。");
      if (result.blocked)
        setError("当前未开启外部刷新；未查询的信息保持未知。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "刷新失败");
    } finally {
      setBusy(false);
      setRequestId(null);
    }
  }
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        现实信息与来源 · 事实版本 {data?.factsVersion ?? "—"}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted-foreground">
          读取不会调用高德。点击刷新会查询已确认地点；资料更新不会改变计划。营业覆盖由计划检查解释，未支持条件保持未知。
        </p>
        <Button size="sm" disabled={busy} onClick={() => void refresh()}>
          {busy ? "正在刷新…" : "更新行程现实信息"}
        </Button>
        {busy && requestId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void stopRefresh()}
          >
            停止刷新
          </Button>
        )}
        {(error || readError) && (
          <p role="alert" className="text-amber-700">
            {error || readError}
          </p>
        )}
        <p>
          未定位活动：
          {data?.gaps.filter((g) => g.reasonCode === "PLACE_UNCONFIRMED")
            .length ?? 0}
          ；未绑定真实地点不会自动查询。
        </p>
        <div className="max-h-80 overflow-y-auto space-y-2">
          {data?.facts.map((f) => (
            <article key={f.id} className="rounded border p-2">
              <p>
                {labels[f.kind]} ·{" "}
                {f.freshness === "fresh"
                  ? "新鲜"
                  : f.freshness === "stale"
                    ? "已过期"
                    : "无法判断"}{" "}
                ·{" "}
                {data.sources.find((s) => s.id === f.sourceRefId)
                  ?.displayName ?? "历史路线来源"}
              </p>
              <p className="text-xs text-muted-foreground">
                查询：{new Date(f.retrievedAt).toLocaleString()} · 来源：
                {data.sources.find((s) => s.id === f.sourceRefId)?.providerId ??
                  "旧高德记录"}
              </p>
              {f.unknownReason && (
                <p className="text-amber-700">
                  {reasons[f.unknownReason] ??
                    "这项资料暂时无法可靠判断，请重新查询"}
                </p>
              )}
              <FactEvidence
                fact={f}
                source={data.sources.find((s) => s.id === f.sourceRefId)}
              />
              {f.value?.kind === "opening_hours" && (
                <p>
                  今日原文：{f.value.today ?? "未知"}；每周：
                  {f.value.weekly ?? "未知"}
                </p>
              )}
              {f.value?.kind === "route_estimate" && (
                <p>
                  {Math.round(f.value.distanceMeters)}米 ·{" "}
                  {Math.ceil(f.value.durationSeconds / 60)}分钟（当前估计）
                </p>
              )}
              {f.value?.kind === "weather" && (
                <p>
                  {f.value.regionName} ·{" "}
                  {f.value.dataKind === "observation" ? "实况" : "日级预报"} ·{" "}
                  {f.value.days.map((d) => d.date).join("、") || "仅查询时刻"}
                </p>
              )}
            </article>
          ))}
        </div>
        {!data?.facts.length && (
          <p className="text-muted-foreground">
            尚无现实资料；这不表示计划已通过检查。
          </p>
        )}
      </div>
    </details>
  );
}
