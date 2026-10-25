"use client";

import { cva } from "class-variance-authority";
import { isToday, startOfDay, isSunday, isSameMonth } from "date-fns";
import { motion } from "framer-motion";
import { useMemo, useCallback } from "react";

import { cn } from "@/lib/utils";
import { transition } from "@/features/calendar/animations";
import { EventListDialog } from "@/features/calendar/dialogs/events-list-dialog";
import { DroppableArea } from "@/features/calendar/dnd/droppable-area";
import { getMonthCellEvents } from "@/features/calendar/helpers";
import { useMediaQuery } from "@/features/calendar/hooks";
import type { ICalendarCell, IEvent } from "@/features/calendar/interfaces";
import { EventBullet } from "@/features/calendar/views/month-view/event-bullet";
import { MonthEventBadge } from "@/features/calendar/views/month-view/month-event-badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { AddEditEventDialog } from "@/features/calendar/dialogs/add-edit-event-dialog";

interface IProps {
  cell: ICalendarCell;
  events: IEvent[];
  eventPositions: Record<string, number>;
}

export const dayCellVariants = cva("text-white", {
  variants: {
    color: {
      blue: "bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-400 ",
      green:
        "bg-green-600 dark:bg-green-500 hover:bg-green-700 dark:hover:bg-green-400",
      red: "bg-red-600 dark:bg-red-500 hover:bg-red-700 dark:hover:bg-red-400",
      yellow:
        "bg-yellow-600 dark:bg-yellow-500 hover:bg-yellow-700 dark:hover:bg-yellow-400",
      purple:
        "bg-purple-600 dark:bg-purple-500 hover:bg-purple-700 dark:hover:bg-purple-400",
      orange:
        "bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 dark:hover:bg-orange-400",
      gray: "bg-gray-600 dark:bg-gray-500 hover:bg-gray-700 dark:hover:bg-gray-400",
    },
  },
  defaultVariants: {
    color: "blue",
  },
});

const MAX_VISIBLE_EVENTS = 3;

export function DayCell({ cell, events, eventPositions }: IProps) {
  const { day, currentMonth, date } = cell;
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Memoize cellEvents and currentCellMonth for performance
  const { cellEvents, currentCellMonth } = useMemo(() => {
    const cellEvents = getMonthCellEvents(date, events, eventPositions);
    const currentCellMonth = startOfDay(
      new Date(date.getFullYear(), date.getMonth(), 1),
    );
    return { cellEvents, currentCellMonth };
  }, [date, events, eventPositions]);

  // Memoize event rendering for each position with animation
  const renderEventAtPosition = useCallback(
    (position: number) => {
      const event = cellEvents.find((e) => e.position === position);
      if (!event) {
        return (
          <motion.div
            key={`empty-${position}`}
            className="lg:flex-1"
            initial={false}
            animate={false}
          />
        );
      }
      const showBullet = isSameMonth(
        new Date(event.startDate),
        currentCellMonth,
      );

      return (
        <motion.div
          key={`event-${event.id}-${position}`}
          className="lg:flex-1"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: position * 0.1, ...transition }}
        >
          {showBullet && (
            <EventBullet className="lg:hidden" color={event.color} />
          )}
          <MonthEventBadge
            className="hidden lg:flex"
            event={event}
            cellDate={startOfDay(date)}
          />
        </motion.div>
      );
    },
    [cellEvents, currentCellMonth, date],
  );

  const showMoreCount = cellEvents.length - MAX_VISIBLE_EVENTS;

  const showMobileMore = isMobile && currentMonth && showMoreCount > 0;
  const showDesktopMore = !isMobile && currentMonth && showMoreCount > 0;

  const cellContent = useMemo(
    () => (
      <motion.div
        className={cn(
          "flex h-full lg:min-h-40 flex-col gap-1 border-l border-t",
          isSunday(date) && "border-l-0",
        )}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition}
      >
        <DroppableArea date={date} className="w-full h-full py-2">
          <motion.span
            className={cn(
              "h-6 px-1 text-xs font-semibold lg:px-2",
              !currentMonth && "opacity-20",
              isToday(date) &&
                "flex w-6 translate-x-1 items-center justify-center rounded-full bg-primary px-0 font-bold text-primary-foreground",
            )}
          >
            {day}
          </motion.span>

          <motion.div
            className={cn(
              "flex h-fit gap-1 px-2 mt-1 lg:h-[94px] lg:flex-col lg:gap-2 lg:px-0",
              !currentMonth && "opacity-50",
            )}
          >
            {cellEvents.length === 0 && !isMobile ? (
              <div className="w-full h-full flex justify-center items-center group">
                <AddEditEventDialog startDate={date}>
                  <Button
                    variant="ghost"
                    className="border opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="max-sm:hidden">Add Event</span>
                  </Button>
                </AddEditEventDialog>
              </div>
            ) : (
              [0, 1, 2].map(renderEventAtPosition)
            )}
          </motion.div>

          {showMobileMore && (
            <div className="flex justify-end items-end mx-2">
              <span className="text-[0.6rem] font-semibold text-accent-foreground">
                +{showMoreCount}
              </span>
            </div>
          )}

          {showDesktopMore && (
            <motion.div
              className={cn(
                "h-4.5 px-1.5 my-2 text-end text-xs font-semibold text-muted-foreground",
                !currentMonth && "opacity-50",
              )}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, ...transition }}
            >
              <EventListDialog date={date} events={cellEvents} />
            </motion.div>
          )}
        </DroppableArea>
      </motion.div>
    ),
    [
      date,
      day,
      currentMonth,
      cellEvents,
      showMobileMore,
      showDesktopMore,
      showMoreCount,
      renderEventAtPosition,
      isMobile,
    ],
  );

  if (isMobile && currentMonth) {
    return (
      <EventListDialog date={date} events={cellEvents}>
        {cellContent}
      </EventListDialog>
    );
  }

  return cellContent;
}
