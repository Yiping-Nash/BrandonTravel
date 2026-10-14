import { overlapResults } from "@open-sunsama/utils/travel-intelligence";
import type { TravelTrip, TravelOperation } from "@open-sunsama/types";
export class TravelError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
import {
  activitySchema,
  entitySchema,
  domainOperationSchema as operationSchema,
} from "@open-sunsama/utils/travel-contract";
export {
  activitySchema,
  entitySchema,
  operationSchema,
  mutationSchema,
  createTripSchema,
  proposalSchema,
} from "@open-sunsama/utils/travel-contract";
export function validateTrip(t: TravelTrip) {
  if (
    t.startDate > t.endDate ||
    (Date.parse(t.endDate) - Date.parse(t.startDate)) / 86400000 > 59
  )
    throw new TravelError("行程须为 1–60 天");
  const entityIds = new Set<string>();
  for (const entity of t.entities ?? []) {
    entitySchema.parse(entity);
    if (entityIds.has(entity.id)) throw new TravelError("地点身份重复");
    entityIds.add(entity.id);
  }
  const ids = new Set<string>();
  for (const a of t.activities) {
    activitySchema.parse(a);
    if (ids.has(a.id)) throw new TravelError("活动身份重复");
    ids.add(a.id);
    if (a.entityId && !entityIds.has(a.entityId))
      throw new TravelError("活动引用了不存在的地点");
    if (a.date && (a.date < t.startDate || a.date > t.endDate))
      throw new TravelError(`活动「${a.title}」超出行程日期`);
    if (a.start !== null && (!a.date || a.start + a.duration > 1440))
      throw new TravelError("时间无效或跨午夜");
  }
  return t;
}
function returnPending(
  t: TravelTrip,
  activities: TravelTrip["activities"],
  clearDate: boolean,
) {
  let position =
    Math.max(
      -1,
      ...t.activities
        .filter((a) => a.start === null && !activities.includes(a))
        .map((a) => a.position),
    ) + 1;
  for (const a of [...activities].sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      (a.start ?? 1440) - (b.start ?? 1440) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  )) {
    if (a.date) a.backlogOriginDate = a.date;
    a.start = null;
    if (clearDate) a.date = null;
    a.position = position++;
  }
}
export function applyOperations(
  original: TravelTrip,
  ops: TravelOperation[],
  actor: "user" | "agent",
) {
  const t = structuredClone(original);
  for (const raw of ops) {
    const op = operationSchema.parse(raw);
    if (op.type === "set_trip_range") {
      const affected = t.activities.filter(
        (a) => a.date && (a.date < op.startDate || a.date > op.endDate),
      );
      const fixed = affected.filter((a) => a.locked);
      if (fixed.length)
        throw new TravelError(
          "请先解除固定：" + fixed.map((a) => a.title).join("、"),
        );
      returnPending(t, affected, true);
      t.startDate = op.startDate;
      t.endDate = op.endDate;
      continue;
    }
    if (
      op.type === "return_to_pending" ||
      op.type === "delete_activities" ||
      op.type === "shift_activities"
    ) {
      if (new Set(op.ids).size !== op.ids.length)
        throw new TravelError("活动ID不能重复");
      const activities = op.ids.map((id) => {
        const a = t.activities.find((a) => a.id === id);
        if (!a) throw new TravelError("活动不存在", 404);
        return a;
      });
      const fixed = activities.filter((a) => a.locked);
      if (fixed.length)
        throw new TravelError(
          "请先解除固定：" + fixed.map((a) => a.title).join("、"),
        );
      if (op.type === "return_to_pending") returnPending(t, activities, false);
      else if (op.type === "delete_activities")
        t.activities = t.activities.filter((a) => !op.ids.includes(a.id));
      else
        for (const a of activities) {
          if (op.days === 0 && op.minutes === 0)
            throw new TravelError("请设置非零移动偏移");
          if (!a.date || a.start === null)
            throw new TravelError("只能平移已安排活动");
          const value =
            Date.parse(a.date + "T00:00:00Z") +
            (op.days * 1440 + op.minutes + a.start) * 60000;
          const time = new Date(value);
          a.date = time.toISOString().slice(0, 10);
          a.start = time.getUTCHours() * 60 + time.getUTCMinutes();
          delete a.backlogOriginDate;
        }
      continue;
    }
    if (op.type === "reorder_pending") {
      const pending = t.activities.filter((a) => a.start === null);
      if (
        new Set(op.ids).size !== op.ids.length ||
        op.ids.length !== pending.length ||
        pending.some((a) => !op.ids.includes(a.id))
      )
        throw new TravelError("排序必须覆盖全部待安排活动且不能重复");
      op.ids.forEach((id, index) => {
        t.activities.find((a) => a.id === id)!.position = index;
      });
      continue;
    }
    if (op.type === "bind_entity") {
      const a = t.activities.find((a) => a.id === op.id);
      if (!a) throw new TravelError("活动不存在", 404);
      if (a.locked) throw new TravelError("请先解除固定，再修改地点");

      if (op.entity) {
        t.entities ??= [];
        const existing = t.entities.find((e) => e.poiId === op.entity!.poiId);
        if (existing) a.entityId = existing.id;
        else {
          const { selectionProof: _proof, ...storedEntity } = op.entity;
          t.entities.push(storedEntity);
          a.entityId = op.entity.id;
        }
        a.place = op.entity.name;
      } else a.entityId = null;
      continue;
    }
    if (op.type === "transition_mode") {
      const from = t.activities.find((a) => a.id === op.fromId),
        to = t.activities.find((a) => a.id === op.toId);
      const scheduled = t.activities
        .filter((a) => a.date === from?.date && a.start !== null)
        .sort(
          (a, b) =>
            a.start! - b.start! ||
            a.position - b.position ||
            a.id.localeCompare(b.id),
        );
      if (
        !from ||
        !to ||
        from.start === null ||
        scheduled[scheduled.findIndex((a) => a.id === from.id) + 1]?.id !==
          to.id
      )
        throw new TravelError("连接已变化，请重新读取", 409);
      t.transitionModes ??= {};
      t.transitionModes[`${from.id}:${to.id}`] = op.mode;
      continue;
    }
    if (op.type === "trip") {
      if (actor === "agent") throw new TravelError("AI 不可修改行程范围", 403);
      Object.assign(t, op.patch);
      continue;
    }
    if (op.type === "add") {
      if (actor === "agent" && op.activity.locked)
        throw new TravelError("AI 不可设置固定", 403);
      t.activities.push(op.activity);
      continue;
    }
    const a = t.activities.find((x) => x.id === op.id);
    if (!a) throw new TravelError("活动不存在", 404);
    if (op.type === "delete") {
      if (a.locked) throw new TravelError("请先解除固定");
      t.activities = t.activities.filter((x) => x.id !== op.id);
      continue;
    }
    if (actor === "agent" && ("locked" in op.patch || "entityId" in op.patch))
      throw new TravelError("AI 不可修改固定状态", 403);
    if (
      a.locked &&
      (["start", "date", "duration", "place", "entityId"] as const).some(
        (k) => k in op.patch && op.patch[k] !== a[k],
      )
    )
      throw new TravelError("请先解除固定，再修改时间");
    if ("place" in op.patch && op.patch.place !== a.place) a.entityId = null;
    Object.assign(a, op.patch);
    if (a.start !== null) delete a.backlogOriginDate;
  }
  validateTrip(t);
  t.revision = original.revision + 1;
  return t;
}
export function conflicts(t: TravelTrip) {
  return overlapResults(t)
    .filter((r) => r.state === "CONFLICT")
    .map(
      (r) =>
        `${t.activities.find((a) => a.id === r.activityIds[0])!.title} 与 ${t.activities.find((a) => a.id === r.activityIds[1])!.title} 时间重叠`,
    );
}
