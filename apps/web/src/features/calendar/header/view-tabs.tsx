import { motion, AnimatePresence } from "motion/react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { cn } from "@/lib/utils";
import { useCalendar } from "../contexts/calendar-context";
import {
  CalendarRange,
  List,
  Columns,
  Grid3X3,
  Grid2X2,
} from "lucide-react";
import { TCalendarView } from "../types";
import { memo } from "react";

const tabs = [
  {
    name: "Agenda",
    value: "agenda",
    icon: () => <CalendarRange className="h-4 w-4" />,
  },
  {
    name: "Day",
    value: "day",
    icon: () => <List className="h-4 w-4" />,
  },
  {
    name: "Week",
    value: "week",
    icon: () => <Columns className="h-4 w-4" />,
  },
  {
    name: "Month",
    value: "month",
    icon: () => <Grid3X3 className="h-4 w-4" />,
  },
  {
    name: "Year",
    value: "year",
    icon: () => <Grid2X2 className="h-4 w-4" />,
  },
];

function Views() {
  const { view, setView } = useCalendar();

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as TCalendarView)}
      className="gap-4 sm:w-auto w-full"
    >
      <TabsList className="h-auto gap-2 rounded-xl p-1 w-full">
        {tabs.map(({ icon: Icon, name, value }) => {
          const isActive = view === value;

          return (
            <motion.div
              key={value}
              layout
              className={cn(
                "flex h-8 items-center justify-center overflow-hidden rounded-md",
                isActive ? "flex-1" : "flex-none"
              )}
              onClick={() => setView(value as TCalendarView)}
              initial={false}
              animate={{
                width: isActive ? 120 : 32,
              }}
              transition={{
                type: "tween",
                stiffness: 400,
                damping: 25,
              }}
            >
              <TabsTrigger value={value} asChild>
                <motion.div
                  className="flex h-8 w-full items-center justify-center cursor-pointer"
                  animate={{ filter: "blur(0px)" }}
                  exit={{ filter: "blur(2px)" }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <Icon />
                  <AnimatePresence initial={false}>
                    {isActive && (
                      <motion.span
                        className="font-medium"
                        initial={{ opacity: 0, scaleX: 0.8 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        style={{ originX: 0 }}
                      >
                        {name}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </TabsTrigger>
            </motion.div>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

export default memo(Views);