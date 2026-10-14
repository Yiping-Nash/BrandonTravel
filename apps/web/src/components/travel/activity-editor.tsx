import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { PlacePicker } from "./place-picker";
import { travelApi as api } from "./api";
import { clock, type TravelWorkspace } from "./use-travel-workspace";
import { useEffect, useState } from "react";
import type { TravelOperation, TravelEnvironment } from "@open-sunsama/types";
const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export function ActivityEditor({
  state,
  v2 = false,
  theme = "sand",
}: {
  state: TravelWorkspace;
  v2?: boolean;
  theme?: string;
}) {
  const {
    edit,
    setEdit,
    busy,
    trip,
    error,
    selectedEntity,
    setSelectedEntity,
    editEnvironment,
    setEditEnvironment,
    draftRevision,
    act,
    mutate,
    returnPending,
  } = state;
  const [original, setOriginal] = useState("");
  useEffect(() => {
    setOriginal(JSON.stringify([edit, editEnvironment, selectedEntity]));
  }, [edit?.id]);
  const dirty =
    !!edit &&
    JSON.stringify([edit, editEnvironment, selectedEntity]) !== original;
  const closeEdit = () => {
    if (!dirty || !v2 || window.confirm("放弃未保存的活动修改？"))
      setEdit(null);
  };
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty && v2) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, v2]);
  return (
    <Dialog
      open={!!edit}
      onOpenChange={(v) => {
        if (!v && !busy) closeEdit();
      }}
    >
      <DialogContent
        className={"travel-activity-dialog " + (v2 ? "bt-v2 bt-modal" : "")}
        data-theme={theme}
      >
        <DialogHeader>
          <DialogTitle>活动详情</DialogTitle>
        </DialogHeader>
        {edit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!trip) return;
              const exists = trip.activities.some((a) => a.id === edit.id);
              const op: TravelOperation = exists
                ? {
                    type: "edit",
                    id: edit.id,
                    patch: {
                      title: edit.title,
                      notes: edit.notes,
                      place: edit.place,
                      date: edit.date,
                      start: edit.start,
                      duration: edit.duration,
                    },
                  }
                : { type: "add", activity: edit };
              const outside =
                v2 &&
                !exists &&
                edit.date &&
                (edit.date < trip.startDate || edit.date > trip.endDate);
              if (
                outside &&
                !window.confirm(
                  `该日期不在行程范围内。扩展行程至${edit.date}并保存此活动？`,
                )
              )
                return;
              const ops: TravelOperation[] = outside
                ? [
                    {
                      type: "set_trip_range",
                      startDate:
                        edit.date! < trip.startDate
                          ? edit.date!
                          : trip.startDate,
                      endDate:
                        edit.date! > trip.endDate ? edit.date! : trip.endDate,
                    },
                    op,
                  ]
                : [op];
              if (selectedEntity !== undefined)
                ops.push({
                  type: "bind_entity",
                  id: edit.id,
                  entity: selectedEntity,
                });
              void act(() =>
                api(`/trips/${trip.id}/kernel/operations`, "POST", {
                  requestId: crypto.randomUUID(),
                  expectedRevision: draftRevision,
                  operations: ops,
                  environments: [
                    { activityId: edit.id, environment: editEnvironment },
                  ],
                }),
              )
                .then(() => setEdit(null))
                .catch(() => {});
            }}
            className="travel-form"
          >
            <div className="travel-form-fields">
              <label>
                标题
                <Input
                  required
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
              {trip && (
                <PlacePicker
                  key={edit.id}
                  trip={trip}
                  activity={edit}
                  disabled={edit.locked}
                  entity={
                    selectedEntity === undefined
                      ? trip.entities?.find((e) => e.id === edit.entityId)
                      : selectedEntity
                  }
                  pending={
                    selectedEntity !== undefined && selectedEntity !== null
                  }
                  onChange={(place) => {
                    setSelectedEntity(null);
                    setEdit({ ...edit, place, entityId: null });
                  }}
                  onSelect={(entity) => {
                    setSelectedEntity(entity);
                    setEdit({
                      ...edit,
                      entityId: entity?.id ?? null,
                      place: entity?.name ?? edit.place,
                    });
                  }}
                />
              )}
              <label>
                日期
                <Input
                  type="date"
                  disabled={edit.locked}
                  value={edit.date || ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      date: e.target.value || null,
                      start: e.target.value ? edit.start : null,
                    })
                  }
                />
              </label>
              <label>
                开始时间（留空待安排）
                <Input
                  type="time"
                  disabled={edit.locked}
                  value={edit.start === null ? "" : clock(edit.start)}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      start: e.target.value ? min(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                停留时长（分钟）
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  required
                  disabled={edit.locked}
                  value={edit.duration}
                  onChange={(e) =>
                    setEdit({ ...edit, duration: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                室内／户外
                <select
                  aria-label="活动环境"
                  disabled={edit.locked || busy}
                  value={editEnvironment}
                  onChange={(e) =>
                    setEditEnvironment(e.target.value as TravelEnvironment)
                  }
                >
                  <option value="unspecified">未指定（不根据标题猜测）</option>
                  <option value="indoor">室内</option>
                  <option value="outdoor">户外</option>
                </select>
              </label>
              <label>
                备注
                <textarea
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                />
              </label>
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="travel-form-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={closeEdit}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                保存
              </Button>
              {trip?.activities.some((a) => a.id === edit.id) && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        [
                          {
                            type: "edit",
                            id: edit.id,
                            patch: { locked: !edit.locked },
                          },
                        ],
                        draftRevision,
                      )
                        .then(() => {
                          setEdit(null);
                        })
                        .catch(() => {})
                    }
                  >
                    {edit.locked ? "解除固定" : "固定活动"}
                  </Button>
                  {edit.start !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || edit.locked}
                      onClick={() =>
                        void returnPending(edit, draftRevision)
                          .then(() => setEdit(null))
                          .catch(() => {})
                      }
                    >
                      返回待安排
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy || edit.locked}
                    onClick={() => {
                      if (confirm(`删除「${edit.title}」？`))
                        void mutate(
                          [{ type: "delete", id: edit.id }],
                          draftRevision,
                        )
                          .then(() => setEdit(null))
                          .catch(() => {});
                    }}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
