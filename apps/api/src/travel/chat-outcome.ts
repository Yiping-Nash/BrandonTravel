import { z } from "zod";
import type { TravelProposal, TravelTrip } from "@open-sunsama/types";
export const finishSchema = z
  .object({
    kind: z.enum(["answer", "clarification", "proposal", "incomplete"]),
    text: z.string().max(4000),
    proposalIds: z.array(z.uuid()).max(10),
    candidateIds: z.array(z.uuid()).max(3).optional(),
  })
  .strict();
export function toolData(result: {
  structuredContent?: Record<string, unknown>;
  content?: unknown[];
}) {
  if (result.structuredContent && "data" in result.structuredContent)
    return result.structuredContent.data;
  const block = result.content?.find(
    (b) => (b as { type?: string }).type === "text",
  ) as { text: string } | undefined;
  return block ? JSON.parse(block.text) : undefined;
}
export function weekdayConflict(
  message: string,
  trip: TravelTrip,
): string | null {
  const names = "日一二三四五六";
  const wanted = [
    ...message.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])/g),
  ].map((m) => (m[1] === "天" ? "日" : m[1]));
  const dates: string[] = [];
  for (
    let date = new Date(trip.startDate + "T00:00:00Z");
    date.toISOString().slice(0, 10) <= trip.endDate;
    date = new Date(date.getTime() + 86400000)
  )
    dates.push(date.toISOString().slice(0, 10));
  if (
    !wanted.some(
      (day) =>
        !dates.some(
          (d) => names[new Date(d + "T00:00:00Z").getUTCDay()] === day,
        ),
    )
  )
    return null;
  return `你提到的星期不在当前行程范围内。当前行程：${dates.map((d) => d + "（周" + names[new Date(d + "T00:00:00Z").getUTCDay()] + "）").join("、")}。请确认具体日期后再修改；本轮未生成修改建议，行程未修改。`;
}
export function verifiedProposalText(
  proposals: TravelProposal[],
  revision: number,
): string {
  return proposals
    .map((p) => {
      const changes = p.operations
        .map((op) => {
          if (op.type === "edit") {
            const before = p.before.activities.find((a) => a.id === op.id)!;
            const after = p.after.activities.find((a) => a.id === op.id)!;
            const time = (n: number | null) =>
              n === null
                ? "待安排"
                : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
            return `${after.title}：${before.date ?? "未定日期"} ${time(before.start)} → ${after.date ?? "未定日期"} ${time(after.start)}，停留${after.duration}分钟`;
          }
          if (op.type === "set_trip_range")
            return `行程日期：${op.startDate}至${op.endDate}；越界活动保留在原日期待安排分组`;
          if (op.type === "return_to_pending")
            return `退回待安排（不删除）：${op.ids.map((id) => p.before.activities.find((a) => a.id === id)?.title ?? id).join("、")}`;
          return op.type === "transition_mode"
            ? `交通方式：${op.mode === "driving" ? "驾车" : "步行"}`
            : op.type === "bind_entity"
              ? `地点：${op.entity?.name ?? "解除关联"}`
              : op.type === "reorder_pending"
                ? "调整待安排顺序"
                : op.type === "add"
                  ? `新增：${op.activity.title} · ${op.activity.date ?? "日期待定"}（${op.activity.date ? "周" + "日一二三四五六"[new Date(op.activity.date + "T00:00:00Z").getUTCDay()] : "待定"}）${op.activity.start === null ? "待安排" : `${String(Math.floor(op.activity.start / 60)).padStart(2, "0")}:${String(op.activity.start % 60).padStart(2, "0")}`} · ${op.activity.duration}分钟 · ${op.activity.place}`
                  : "删除活动";
        })
        .join("\n");
      const changed = new Set(
        p.operations.flatMap((op) =>
          "id" in op ? [op.id] : op.type === "add" ? [op.activity.id] : [],
        ),
      );
      const critical =
        p.evaluation?.results.filter(
          (r) =>
            r.activityIds.some((id) => changed.has(id)) &&
            ["OVERLAP", "OPENING_COVERAGE", "TRANSITION_GAP"].includes(r.rule),
        ) ?? [];
      const verified =
        critical.length > 0 &&
        critical.some((r) => r.rule === "OPENING_COVERAGE") &&
        critical.every((r) => r.state === "VALID");
      return `已验证修改建议 ${p.id}\n${changes}\n${verified ? "已检查的营业、路程和重叠条件下，候选安排可行；未检查/UNKNOWN资料不代表已验证。\n" : ""}${p.evaluation?.results.some((r) => r.state === "CONFLICT") ? "注意：候选计划存在冲突，确认前请查看计划检查。\n" : ""}${p.status === "applied" ? "已由用户确认保存。" : p.status === "rejected" ? "已拒绝，未执行。" : p.revision !== revision ? "行程已变化，提案过期，需要重新读取和提出。" : "待网页确认，行程尚未修改。"}`;
    })
    .join("\n\n");
}
export function claimsMutation(text: string) {
  const pattern =
    /(?:已经|已|成功)(?:成功)?(?:(?:为|帮|替|将|把|按|根据|在|对)[^，。;\n]{0,12}?)?(?:提交|生成|创建|修改|调整|保存|执行|生效)|(?:提交|生成|创建).{0,8}?(?:提案|建议)|(?:proposal|change).{0,25}?(?:submitted|created|applied)|(?:submitted|created|applied).{0,25}?(?:proposal|change)/gi;
  return [...text.matchAll(pattern)].some((m) => {
    const prefix = text.slice(Math.max(0, m.index! - 12), m.index);
    return (
      !/(?:未|没有|不|无需|尚未|不会|不能|不必|不要)[^，。;\n]{0,5}$/.test(
        prefix,
      ) && !/未|没有|不(?:会|曾|能|可|再|予)|尚未/.test(m[0])
    );
  });
}
