import { useState } from "react";
import type { TravelTrip, TravelOperation } from "@open-sunsama/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
export function TripRangeEditor({
  trip,
  busy,
  onSave,
  v2 = false,
  theme = "sand",
}: {
  v2?: boolean;
  theme?: string;
  trip: TravelTrip;
  busy: boolean;
  onSave: (op: TravelOperation) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [start, setStart] = useState(trip.startDate),
    [end, setEnd] = useState(trip.endDate),
    [error, setError] = useState("");
  const affected = trip.activities.filter(
      (a) => a.date && (a.date < start || a.date > end),
    ),
    fixed = affected.filter((a) => a.locked),
    dates = [...new Set(affected.map((a) => a.date!))];
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setStart(trip.startDate);
          setEnd(trip.endDate);
          setError("");
          setOpen(true);
        }}
      >
        编辑日期
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={v2 ? "bt-v2 bt-modal" : undefined} data-theme={v2 ? theme : undefined}>
          <DialogHeader>
            <DialogTitle>修改行程日期</DialogTitle>
          </DialogHeader>
          <label>
            开始日期
            <Input
              aria-label="行程开始日期"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            结束日期
            <Input
              aria-label="行程结束日期"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <p>
            将有{affected.length}
            个活动退回待安排，内容和地点保留；不会整体平移，也不会在扩大范围时自动恢复。
          </p>
          {dates.map((d) => (
            <p key={d}>
              原{d}计划：
              {affected
                .filter((a) => a.date === d)
                .map((a) => a.title)
                .join("、")}
            </p>
          ))}
          {fixed.length > 0 && (
            <p role="alert">
              请先解除固定：{fixed.map((a) => a.title).join("、")}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy || fixed.length > 0 || !start || !end}
            onClick={() =>
              void onSave({
                type: "set_trip_range",
                startDate: start,
                endDate: end,
              })
                .then(() => setOpen(false))
                .catch((e) => setError(e.message))
            }
          >
            确认修改日期
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
