import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { TravelTrip, TravelProposal } from "@open-sunsama/types";
import { travelApi } from "./api";
const clock = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const dateLabel = (date: string | null) =>
  date
    ? `${date}（周${"日一二三四五六"[new Date(date + "T00:00:00Z").getUTCDay()]}）`
    : "未定日期";
type Page = {
  items: TravelProposal[];
  total: number;
  nextCursor: number | null;
};
export function ProposalList({
  trip,
  proposals,
  pendingTotal,
  historyTotal,
  pendingCursor,
  onPendingMore,
  busy,
  onAction,
}: {
  trip: TravelTrip;
  proposals: TravelProposal[];
  pendingTotal: number;
  historyTotal: number;
  pendingCursor: number | null;
  onPendingMore: () => Promise<void>;
  busy: boolean;
  onAction: (id: string, action: "confirm" | "reject") => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false),
    [history, setHistory] = useState<TravelProposal[]>([]),
    [cursor, setCursor] = useState<number | null>(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  async function load(offset = 0) {
    setLoading(true);
    try {
      const page = await travelApi<Page>(
        `/trips/${trip.id}/proposals?status=history&limit=20&cursor=${offset}`,
      );
      setHistory((old) =>
        offset
          ? [
              ...old,
              ...page.items.filter((p) => !old.some((o) => o.id === p.id)),
            ]
          : page.items,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "历史读取失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (expanded) void load();
  }, [expanded, trip.id, trip.revision, historyTotal]);
  const render = (p: TravelProposal) => (
    <article key={p.id} data-proposal-id={p.id}>
      <strong>{p.reason}</strong>
      <p>
        {p.status === "pending"
          ? "待确认"
          : p.status === "applied"
            ? "已执行"
            : "已拒绝"}{" "}
        · 基于第 {p.revision} 版
        {p.status !== "pending" &&
          ` · ${p.processedAt ? new Date(p.processedAt).toLocaleString("zh-CN") : "处理时间未知（旧记录）"}`}
      </p>
      <div className="travel-diff">
        {p.operations.map((op, i) => {
          if (
            op.type === "set_trip_range" ||
            op.type === "return_to_pending" ||
            op.type === "shift_activities" ||
            op.type === "delete_activities"
          ) {
            const rows =
              op.type === "set_trip_range"
                ? p.before.activities.filter(
                    (a) =>
                      a.date && (a.date < op.startDate || a.date > op.endDate),
                  )
                : p.before.activities.filter((a) => op.ids.includes(a.id));
            return (
              <div key={i}>
                <p>
                  {op.type === "set_trip_range"
                    ? "日期范围 → " + op.startDate + "—" + op.endDate
                    : op.type === "shift_activities"
                      ? "整体平移 " + op.days + "天／" + op.minutes + "分钟"
                      : op.type === "return_to_pending"
                        ? "退回待安排"
                        : "批量删除"}
                </p>
                {rows.map((a) => {
                  const b = p.after.activities.find((b) => b.id === a.id);
                  return (
                    <p key={a.id}>
                      {a.title}：{a.date}{" "}
                      {a.start === null ? "待安排" : clock(a.start)} →{" "}
                      {b
                        ? b.start === null
                          ? "待安排（原" +
                            (b.backlogOriginDate ?? a.date) +
                            "计划）"
                          : b.date + " " + clock(b.start)
                        : "删除"}
                    </p>
                  );
                })}
              </div>
            );
          }
          const before =
            "id" in op ? p.before.activities.find((a) => a.id === op.id) : null;
          const after =
            "id" in op
              ? p.after.activities.find((a) => a.id === op.id)
              : op.type === "add"
                ? op.activity
                : null;
          return (
            <p key={i}>
              {op.type === "reorder_pending"
                ? "待安排排序"
                : op.type === "transition_mode"
                  ? "交通方式"
                  : before?.title || after?.title || "行程"}
              ：
              {before
                ? `${dateLabel(before.date)} ${before.start === null ? "待安排" : clock(before.start)} / ${before.duration}分钟 · ${before.place}`
                : op.type === "reorder_pending"
                  ? p.before.activities
                      .filter((a) => a.start === null)
                      .sort((a, b) => a.position - b.position)
                      .map((a) => a.title)
                      .join("、")
                  : op.type === "transition_mode"
                    ? "原方式"
                    : "新增"}{" "}
              →{" "}
              {after
                ? `${dateLabel(after.date)} ${after.start === null ? "待安排" : clock(after.start)} / ${after.duration}分钟 · ${after.title} · ${after.place}`
                : op.type === "reorder_pending"
                  ? op.ids
                      .map(
                        (id) =>
                          p.after.activities.find((a) => a.id === id)?.title,
                      )
                      .join("、")
                  : op.type === "transition_mode"
                    ? op.mode === "walking"
                      ? "步行"
                      : "驾车"
                    : "删除"}
            </p>
          );
        })}
      </div>
      {p.status === "pending" && (
        <>
          <Button
            disabled={busy || p.revision !== trip.revision}
            onClick={() => void onAction(p.id, "confirm").catch(() => {})}
          >
            确认并保存
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void onAction(p.id, "reject").catch(() => {})}
          >
            拒绝
          </Button>
          {p.revision !== trip.revision && (
            <p>已过期：行程已改变，请让 AI 重新提出。</p>
          )}
        </>
      )}
    </article>
  );
  return (
    <section className="travel-proposals">
      <h2>AI 的修改建议</h2>
      <p>建议不会直接改变行程，确认后才保存。</p>
      <div className="travel-proposals-pending">
        <h3>待处理建议（{pendingTotal}）</h3>
        {!proposals.length && <p>暂无待处理建议。</p>}
        {proposals.map(render)}
        {pendingCursor !== null && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onPendingMore().catch(() => {})}
          >
            加载更多待处理建议
          </Button>
        )}
      </div>
      <details
        className="travel-proposals-history"
        open={expanded}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>历史记录（{historyTotal}）</summary>
        {expanded && (
          <>
            {history.map(render)}
            {loading && <p>读取中…</p>}
            {error && <p role="alert">{error}</p>}
            {cursor !== null && !loading && (
              <Button variant="outline" onClick={() => void load(cursor)}>
                加载更多历史
              </Button>
            )}
          </>
        )}
      </details>
    </section>
  );
}
