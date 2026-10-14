import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TravelTrip, TravelOperation } from "@open-sunsama/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
export function useTripSelection(viewKey: string) {
  const [enabled, setEnabled] = useState(false),
    [ids, setIds] = useState<string[]>([]),
    [band, setBand] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    } | null>(null);
  const press = useRef<{
    x: number;
    y: number;
    pointerId: number;
    root: HTMLElement;
    column: HTMLElement;
    lastX: number;
    lastY: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const clear = () => {
    setIds([]);
    setBand(null);
    press.current = null;
  };
  useEffect(() => {
    clear();
    setEnabled(false);
  }, [viewKey]);
  const update = (x: number, y: number) => {
    const p = press.current;
    if (!p) return;
    p.lastX = x;
    p.lastY = y;
    let left = 0,
      right = innerWidth,
      top = 0,
      bottom = innerHeight;
    for (let el: HTMLElement | null = p.column; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (
        el.hasAttribute("data-radix-scroll-area-viewport") ||
        el.hasAttribute("data-calendar-horizontal") ||
        /(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)
      ) {
        const r = el.getBoundingClientRect();
        if (
          el.hasAttribute("data-calendar-horizontal") ||
          /(auto|scroll|hidden)/.test(style.overflowX)
        ) {
          left = Math.max(left, r.left);
          right = Math.min(right, r.right);
        }
        if (
          el.hasAttribute("data-radix-scroll-area-viewport") ||
          /(auto|scroll|hidden)/.test(style.overflowY)
        ) {
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
      }
    }
    const axis = p.root
      .querySelector<HTMLElement>("[data-hour-axis]")
      ?.getBoundingClientRect();
    if (axis) left = Math.max(left, axis.right);
    const clampX = (n: number) => Math.max(left, Math.min(right, n)),
      clampY = (n: number) => Math.max(top, Math.min(bottom, n));
    const r = {
      left: Math.min(clampX(p.x), clampX(x)),
      top: Math.min(clampY(p.y), clampY(y)),
      width: Math.abs(clampX(p.x) - clampX(x)),
      height: Math.abs(clampY(p.y) - clampY(y)),
    };
    setBand(r);
    if (r.width < 3 || r.height < 3) return;
    setIds([
      ...new Set(
        [...p.root.querySelectorAll<HTMLElement>("[data-block-id]")]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            const l = Math.max(left, b.left),
              rr = Math.min(right, b.right),
              t = Math.max(top, b.top),
              bb = Math.min(bottom, b.bottom);
            return (
              l < rr &&
              t < bb &&
              l < r.left + r.width &&
              rr > r.left &&
              t < r.top + r.height &&
              bb > r.top
            );
          })
          .map((el) => el.dataset.blockId!),
      ),
    ]);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (press.current) suppressClick.current = true;
        clear();
        setEnabled(false);
      }
    };
    const scroll = () => {
      const p = press.current;
      if (p) update(p.lastX, p.lastY);
    };
    window.addEventListener("keydown", key);
    document.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("scroll", scroll, true);
    };
  }, []);
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement,
      column = target.closest<HTMLElement>("[data-day-column]");
    if (
      !enabled ||
      e.pointerType !== "mouse" ||
      e.button !== 0 ||
      !column ||
      target.closest(
        "[data-block-id],button,input,select,summary,a,[role=button]",
      )
    )
      return;
    e.preventDefault();
    setIds([]);
    press.current = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      pointerId: e.pointerId,
      root: e.currentTarget,
      column,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (press.current) suppressClick.current = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    press.current = null;
    setBand(null);
  };
  return {
    enabled,
    ids,
    setEnabled,
    clear,
    band,
    toggle: (id: string) =>
      setIds((old) =>
        old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
      ),
    gridProps: {
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onPointerDown: start,
      onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (press.current) update(e.clientX, e.clientY);
      },
      onPointerUp: end,
      onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => {
        end(e);
        setIds([]);
      },
      onMouseDownCapture: (e: React.MouseEvent) => {
        if (enabled) e.stopPropagation();
      },
    },
  };
}
export function BatchEditor({
  trip,
  ids,
  busy,
  onSave,
  v2 = false,
  theme = "sand",
}: {
  v2?: boolean;
  theme?: string;
  trip: TravelTrip;
  ids: string[];
  busy: boolean;
  onSave: (op: TravelOperation) => Promise<unknown>;
}) {
  const [dialog, setDialog] = useState<"move" | "delete" | null>(null),
    [days, setDays] = useState(0),
    [minutes, setMinutes] = useState(0),
    [error, setError] = useState("");
  const rows = trip.activities.filter((a) => ids.includes(a.id));
  const submit = (op: TravelOperation) => {
    setError("");
    void onSave(op)
      .then(() => setDialog(null))
      .catch((e) => setError(e.message));
  };
  return (
    <div className="border rounded p-2 my-2">
      <p>
        已选择{ids.length}项 · 固定{rows.filter((a) => a.locked).length}
        项（有固定项时整批拒绝）
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !ids.length}
          onClick={() => {
            setDialog("move");
            setError("");
          }}
        >
          批量移动
        </Button>
        <Button
          disabled={busy || !ids.length}
          onClick={() => submit({ type: "return_to_pending", ids })}
        >
          批量退回待安排
        </Button>
        <Button
          disabled={busy || !ids.length}
          variant="outline"
          onClick={() => {
            setDialog("delete");
            setError("");
          }}
        >
          批量删除
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <Dialog
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value) setDialog(null);
        }}
      >
        <DialogContent
          className={v2 ? "bt-v2 bt-modal" : undefined}
          data-theme={v2 ? theme : undefined}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === "move" ? "整体平移活动" : "确认批量删除"}
            </DialogTitle>
          </DialogHeader>
          <p>{rows.map((a) => a.title + "（" + a.date + "）").join("、")}</p>
          {dialog === "move" ? (
            <>
              <label>
                平移天数
                <Input
                  aria-label="平移天数"
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </label>
              <label>
                平移分钟
                <Input
                  aria-label="平移分钟"
                  type="number"
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <p>
                保留活动间距；负数表示提前。不自动重排，越界或跨午夜整批拒绝。
              </p>
            </>
          ) : (
            <p>删除{ids.length}项活动，无回收站；请核对后确认。</p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={
              busy ||
              !ids.length ||
              (dialog === "move" && days === 0 && minutes === 0)
            }
            onClick={() =>
              submit(
                dialog === "move"
                  ? { type: "shift_activities", ids, days, minutes }
                  : { type: "delete_activities", ids },
              )
            }
          >
            {dialog === "move" ? "确认整体平移" : "确认删除这些活动"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
