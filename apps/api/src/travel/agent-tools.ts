import { z, agentOperationSchema } from "@open-sunsama/utils/travel-contract";
import type {
  TravelEntity,
  TravelOperation,
  TravelTrip,
  TravelChatRun,
  TravelJsonValue,
} from "@open-sunsama/types";
import { randomUUID } from "node:crypto";
export const modelOperationSchema = z.discriminatedUnion("type", [
  agentOperationSchema.options[0],
  z
    .object({
      type: z.literal("bind_entity"),
      id: z.uuid(),
      candidateId: z.uuid(),
    })
    .strict(),
  agentOperationSchema.options[2],
  agentOperationSchema.options[3].extend({
    activity: agentOperationSchema.options[3].shape.activity
      .omit({ id: true, locked: true, position: true, entityId: true })
      .extend({
        notes: z.string().max(10000).optional(),
        place: z.string().max(255).optional(),
      })
      .strip(),
  }),
  agentOperationSchema.options[4],
  agentOperationSchema.options[5],
  agentOperationSchema.options[6],
  agentOperationSchema.options[7],
]);
export const modelProposalSchema = z
  .object({
    reason: z.string().min(1).max(2000),
    operations: z.array(modelOperationSchema).min(1).max(50),
  })
  .strip();
export type ChatState = TravelChatRun & {
  candidateEntities?: TravelEntity[];
  selectedCandidateId?: string;
};
export function publicRun(run: ChatState): TravelChatRun {
  const { candidateEntities: _private, ...publicState } = run;
  return publicState;
}
export function normalizeOperations(
  input: unknown,
  trip: TravelTrip,
  addedIds: Map<number, string>,
  candidates: TravelEntity[],
  selectedCandidateId?: string,
): TravelOperation[] {
  const parsed = modelProposalSchema.parse(input);
  return parsed.operations.map((op, index): TravelOperation => {
    if (op.type === "add") {
      if (!addedIds.has(index)) addedIds.set(index, randomUUID());
      return {
        type: "add",
        activity: {
          ...op.activity,
          id: addedIds.get(index)!,
          locked: false,
          position:
            Math.max(0, ...trip.activities.map((a) => a.position)) + 1 + index,
          notes: op.activity.notes ?? "",
          place: op.activity.place ?? "地点待确认",
        },
      };
    }
    if (op.type === "bind_entity") {
      if (op.candidateId !== selectedCandidateId)
        throw Error("必须先由用户选定具体高德候选，不能自行绑定");
      const entity = candidates.find((e) => e.id === op.candidateId);
      if (!entity) throw Error("候选已失效，请重新搜索并让用户选择");
      return { type: "bind_entity", id: op.id, entity };
    }
    return op;
  });
}
export function safeArguments(input: unknown): Record<string, TravelJsonValue> {
  const redact = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(redact)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([k]) =>
                  !/key|token|authorization|selectionProof|notes|candidateEntities/i.test(
                    k,
                  ),
              )
              .map(([k, v]) => [k, redact(v)]),
          )
        : value;
  return redact(input) as Record<string, TravelJsonValue>;
}
export function straightDistance(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad,
    dlon = (b.longitude - a.longitude) * rad;
  return Math.round(
    6371000 *
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin(dlat / 2) ** 2 +
            Math.cos(a.latitude * rad) *
              Math.cos(b.latitude * rad) *
              Math.sin(dlon / 2) ** 2,
        ),
      ),
  );
}
export function recommendationText(run: ChatState) {
  const candidates = run.candidates?.slice(0, 3) ?? [];
  if (!candidates.length)
    return "未找到可用的真实高德候选，请补充城市、餐饮偏好或想去的地点类型。行程未修改。";
  return (
    "以下为高德地点候选，供你选择；尚未添加到行程：\n" +
    candidates
      .map(
        (c, i) =>
          `${i + 1}. ${c.name} · ${c.city} · ${c.address}${c.straightDistanceMeters === undefined ? "" : `；距当天参考地点直线约${c.straightDistanceMeters}米（不是道路耗时）`}`,
      )
      .join("\n") +
    "\n候选城市如上；有已定位的当天活动时提供位置比较；口碑、价格、营业时间及开放情况未知（未核实）。请先选候选，再提供安排时段。"
  );
}
