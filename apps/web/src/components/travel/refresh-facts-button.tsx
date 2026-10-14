import { useState, useEffect, useRef } from "react";
import type { FactKind } from "@open-sunsama/types";
import { Button } from "@/components/ui";
import { travelApi } from "./api";
export function RefreshFactsButton({
  tripId,
  date,
  kinds,
  label,
  compact = false,
  ariaLabel,
}: {
  tripId: string;
  date: string;
  kinds: FactKind[];
  label: string;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const scope = tripId + ":" + date + ":" + kinds.join(",");
  const current = useRef(scope);
  current.current = scope;
  useEffect(() => {
    setBusy(false);
    setMessage("");
  }, [scope]);
  async function refresh() {
    const captured = scope;
    setBusy(true);
    setMessage("");
    try {
      const r = await travelApi<{
        attempted: number;
        succeeded: number;
        failed: number;
        blocked: number;
        cooldown: number;
        cache: number;
        discarded: number;
      }>("/trips/" + tripId + "/intelligence/refresh", "POST", {
        requestId: crypto.randomUUID(),
        kinds,
        dates: [date],
        force: false,
      });
      if (current.current === captured)
        setMessage(
          r.blocked
            ? "外部查询未启用，未取得新资料"
            : r.failed
              ? "部分查询失败，请查看下方原因或资料来源"
              : r.cooldown
                ? "部分查询正在冷却，稍后再试"
                : r.discarded
                  ? "计划已变化，旧查询结果未写入"
                  : r.attempted === 0 && !r.cache
                    ? "未取得新资料，请查看地点或日期限制"
                    : "资料已更新，正在重新检查",
        );
    } catch (e) {
      if (current.current === captured)
        setMessage(e instanceof Error ? e.message : "查询失败");
    } finally {
      window.dispatchEvent(new Event("travel-facts-updated"));
      if (current.current === captured) setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      <Button
        type="button"
        aria-label={ariaLabel}
        className={compact ? "h-7 px-1 text-xs max-w-full" : undefined}
        size="sm"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {busy ? "正在获取…" : label}
      </Button>
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
