import { useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui";
import type { TravelActivity } from "@open-sunsama/types";
type Props = {
  activities: TravelActivity[];
  busy: boolean;
  revision: number;
  onOpen: (a: TravelActivity) => void;
  onReorder: (ids: string[], revision: number) => Promise<void>;
  onExternal: (a: TravelActivity, e: React.MouseEvent) => void;
  onDragging: (value: boolean) => void;
};
function Card({
  a,
  index,
  props,
  move,
}: {
  a: TravelActivity;
  index: number;
  props: Props;
  move: (delta: number) => void;
}) {
  const sortable = useSortable({ id: a.id, disabled: props.busy });
  return (
    <article
      ref={sortable.setNodeRef}
      data-pending-id={a.id}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1,
      }}
    >
      <button className="travel-card-title" onClick={() => props.onOpen(a)}>
        {a.locked ? "🔒 " : ""}
        {a.title}
      </button>
      <p>
        {a.date ?? "日期待定"} · {a.duration}分钟
      </p>
      <div>
        <button
          className="travel-sort"
          aria-label={`排序 ${a.title}`}
          style={{ touchAction: "none" }}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          ⠿ 排序
        </button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.busy || index === 0}
          onClick={() => move(-1)}
        >
          上移
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.busy || index === props.activities.length - 1}
          onClick={() => move(1)}
        >
          下移
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onOpen(a)}>
          安排时间
        </Button>
      </div>
      <button
        className="travel-drag"
        disabled={a.locked || props.busy}
        onMouseDown={(e) => props.onExternal(a, e)}
      >
        拖进时间轴
      </button>
    </article>
  );
}
function PendingGroup(props: Props) {
  const [revision, setRevision] = useState(props.revision);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = props.activities.map((a) => a.id);
  return (
    <div className="travel-pending">
      <p>组内排序 · 时间轴活动可拖回这里</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          setRevision(props.revision);
          props.onDragging(true);
        }}
        onDragCancel={() => props.onDragging(false)}
        onDragEnd={(e) => {
          props.onDragging(false);
          if (!e.over || e.over.id === e.active.id) return;
          void props
            .onReorder(
              arrayMove(
                ids,
                ids.indexOf(String(e.active.id)),
                ids.indexOf(String(e.over.id)),
              ),
              revision,
            )
            .catch(() => {});
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {props.activities.map((a, index) => (
            <Card
              key={a.id}
              a={a}
              index={index}
              props={props}
              move={(delta) => {
                void props
                  .onReorder(
                    arrayMove(ids, index, index + delta),
                    props.revision,
                  )
                  .catch(() => {});
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
      {!ids.length && (
        <div className="travel-empty">拖回活动，稍后重新安排</div>
      )}
    </div>
  );
}

export function PendingList(props: Props) {
  const map = new Map<string, TravelActivity[]>();
  for (const a of props.activities) {
    const key = a.backlogOriginDate
      ? "origin:" + a.backlogOriginDate
      : a.date
        ? "intent:" + a.date
        : "none";
    map.set(key, [...(map.get(key) ?? []), a]);
  }
  const groups = [...map].sort(([a], [b]) =>
    a === "none"
      ? -1
      : b === "none"
        ? 1
        : a
            .slice(a.indexOf(":") + 1)
            .localeCompare(b.slice(b.indexOf(":") + 1)) || a.localeCompare(b),
  );
  if (!groups.length)
    return (
      <div className="travel-pending-groups">
        <h2>待安排</h2>
        <PendingGroup {...props} />
      </div>
    );
  return (
    <div className="travel-pending-groups">
      <h2>待安排</h2>
      {groups.map(([key, activities]) => (
        <details key={key} open className="border rounded my-2">
          <summary>
            {key === "none"
              ? "普通待安排"
              : key.startsWith("origin:")
                ? "原" + key.slice(7) + "计划"
                : key.slice(7) + "待安排"}{" "}
            · {activities.length}项
          </summary>
          <PendingGroup
            {...props}
            activities={activities.sort(
              (a, b) => a.position - b.position || a.id.localeCompare(b.id),
            )}
            onReorder={(ids, revision) =>
              props.onReorder(
                groups.flatMap(([other, rows]) =>
                  other === key ? ids : rows.map((a) => a.id),
                ),
                revision,
              )
            }
          />
        </details>
      ))}
    </div>
  );
}
