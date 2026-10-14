import { useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { format } from "date-fns";
export function useCalendarNavigation(
  days: Date[],
  day: string,
  visible: number,
  blocked: boolean,
) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0),
    [offset, setOffset] = useState(0);
  const pan = useRef<{ x: number; cursor: number } | null>(null),
    blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const gutter = visible === 4 ? 48 : 56;
  const columnWidth = Math.max(1, (width - gutter) / visible),
    contentWidth = Math.max(width, gutter + columnWidth * days.length);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    const scroll = () => setOffset(el.scrollLeft);
    el.addEventListener("scroll", scroll);
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", scroll);
    };
  }, [days.length]);
  const dates = days.map((d) => format(d, "yyyy-MM-dd")).join(",");
  useEffect(() => {
    const el = ref.current,
      index = dates.split(",").indexOf(day);
    if (el && width && index >= 0) el.scrollLeft = index * columnWidth;
  }, [day, dates, width, visible]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = ref.current,
        p = pan.current;
      if (el && p && !blockedRef.current)
        el.scrollLeft += (p.cursor - p.x) * 0.12;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const move = (e: MouseEvent) => {
      if (pan.current) pan.current.cursor = e.clientX;
    };
    const stop = () => {
      pan.current = null;
      if (ref.current) ref.current.dataset.panning = "false";
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    const blur = () => stop();
    document.addEventListener("mousemove", move);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    if (blocked) {
      pan.current = null;
      if (ref.current) ref.current.dataset.panning = "false";
    }
  }, [blocked]);
  return {
    ref,
    scrollToDate: (target: string) => {
      const index = dates.split(",").indexOf(target);
      if (ref.current && index >= 0)
        ref.current.scrollLeft = index * columnWidth;
    },
    contentWidth,
    offset,
    panProps: {
      onMouseDownCapture: (e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.button !== 1 || blocked) return;
        e.preventDefault();
        e.stopPropagation();
        pan.current = pan.current ? null : { x: e.clientX, cursor: e.clientX };
        if (ref.current) ref.current.dataset.panning = String(!!pan.current);
      },
      onPointerDownCapture: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (pan.current && e.button !== 1) {
          e.preventDefault();
          e.stopPropagation();
          pan.current = null;
          if (ref.current) ref.current.dataset.panning = "false";
        }
      },
      onAuxClick: (e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.button === 1) e.preventDefault();
      },
    },
  };
}
