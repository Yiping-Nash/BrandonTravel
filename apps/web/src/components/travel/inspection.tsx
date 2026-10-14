import { useState } from "react";
import { Button } from "@/components/ui";
import { travelApi } from "./api";
type Usage = {
  totals: {
    provider: string;
    status: string;
    count: number;
    input_tokens?: number;
    output_tokens?: number;
  }[];
  recent: {
    provider: string;
    endpoint: string;
    purpose: string;
    status: string;
    elapsed_ms: number;
    input_tokens?: number;
    output_tokens?: number;
    created_at: string;
    error?: string;
  }[];
};
export function Inspection({ tripId }: { tripId: string }) {
  const [inspection, setInspection] = useState<unknown>(),
    [usage, setUsage] = useState<Usage>(),
    [error, setError] = useState("");
  async function load() {
    try {
      setInspection(await travelApi(`/trips/${tripId}/inspection`));
      setUsage(await travelApi("/usage"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }
  return (
    <details
      className="travel-inspection"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>行程检查器与本次登录 API 用量</summary>
      <p>
        计划、地点和路程估计各自保存。操作记录展示修改前后；聊天不是权威状态。
      </p>
      <Button variant="outline" onClick={() => void load()}>
        刷新检查记录
      </Button>
      {error && <p role="alert">{error}</p>}
      {usage && (
        <>
          <div className="travel-usage-stats">
            {usage.totals.map((t) => (
              <span key={`${t.provider}-${t.status}`}>
                {t.provider === "open-meteo"
                  ? "Open-Meteo天气"
                  : t.provider === "open-meteo-mock"
                    ? "Open-Meteo天气（模拟）"
                    : t.provider === "amap"
                      ? "高德"
                      : t.provider === "model"
                        ? "模型"
                        : t.provider === "amap-mock"
                          ? "高德（模拟）"
                          : t.provider === "model-mock"
                            ? "模型（模拟）"
                            : "业务接口"}{" "}
                · {t.status === "cache" ? "缓存命中" : t.status}{" "}
                <strong>{t.count}</strong>
                {t.provider.startsWith("model") && (
                  <small>
                    {" "}
                    · 输入{t.input_tokens ?? 0}/输出{t.output_tokens ?? 0}{" "}
                    tokens
                  </small>
                )}
              </span>
            ))}
          </div>
          <p>
            按本次登录凭据区分；缓存命中不消耗外部请求。最近50条，无Key及请求正文。Open-Meteo计数为HTTP记录，不是供应商计费单位；长区间与集合查询可能按多次折算，免费响应不提供账单。
          </p>
          <ol className="travel-api-log">
            {usage.recent.map((r, i) => (
              <li key={i}>
                <time>{new Date(r.created_at).toLocaleTimeString()}</time>{" "}
                {r.provider} · {r.endpoint} · {r.status} · {r.elapsed_ms ?? 0}ms{" "}
                {r.input_tokens != null
                  ? `输入${r.input_tokens}/输出${r.output_tokens ?? 0} tokens`
                  : ""}{" "}
                {r.purpose === "acceptance" ? "（自动验收）" : ""}
                {r.error && <span>{r.error}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
      <details>
        <summary>查看结构化行程与最近操作前后差异</summary>
        <pre>{JSON.stringify(inspection, null, 2)}</pre>
      </details>
    </details>
  );
}
