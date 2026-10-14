import { createContext, useContext, useMemo } from "react";
import {
  calculateTimeFromY as fromY,
  calculateYFromTime as toY,
  HOUR_HEIGHT,
} from "@/hooks/calendar-dnd-utils";
/** Presentation geometry only; default preserves upstream behavior. */
export const CalendarDensity = createContext(HOUR_HEIGHT);
export function useCalendarGeometry() {
  const height = useContext(CalendarDensity);
  return useMemo(
    () => ({
      HOUR_HEIGHT: height,
      calculateTimeFromY: (y: number, date: Date) =>
        fromY((y * HOUR_HEIGHT) / height, date),
      calculateYFromTime: (date: Date) => (toY(date) * height) / HOUR_HEIGHT,
    }),
    [height],
  );
}
