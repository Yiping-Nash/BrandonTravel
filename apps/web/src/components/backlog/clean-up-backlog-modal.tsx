import * as React from "react";
import { ChevronRight, Check, Minus, Trash2, CheckCircle2 } from "lucide-react";
import type { Task, TaskPriority } from "@open-sunsama/types";
import { useTasks, useBatchDeleteTasks } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@/components/ui";

const PRIORITY_DOT: Record<TaskPriority, string> = {
  P0: "bg-red-500",
  P1: "bg-orange-500",
  P2: "bg-blue-400",
  P3: "bg-slate-300 dark:bg-slate-600",
};

/** Age buckets, ordered oldest-first so the stalest pile surfaces at the top. */
const BUCKETS: Array<{ key: string; label: string; minDays: number }> = [
  { key: "6mo", label: "6 months +", minDays: 180 },
  { key: "3-6mo", label: "3–6 months", minDays: 90 },
  { key: "1-3mo", label: "1–3 months", minDays: 30 },
  { key: "8-30d", label: "8–30 days", minDays: 8 },
  { key: "0-7d", label: "Last 7 days", minDays: 0 },
];

function ageDays(task: Task): number {
  const created = new Date(task.createdAt as unknown as string).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
}

// Label thresholds mirror the bucket boundaries (days < 30 → days/weeks,
// 30+ → months) so a row's age reads coherently within its section.
function ageLabel(days: number): string {
  if (days <= 0) return "today";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}

type CheckState = "off" | "on" | "mixed";

function CheckBox({ state }: { state: CheckState }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        state === "off"
          ? "border-muted-foreground/40 bg-background"
          : "border-primary bg-primary text-primary-foreground"
      )}
    >
      {state === "on" && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      {state === "mixed" && <Minus className="h-2.5 w-2.5" strokeWidth={3} />}
    </span>
  );
}

interface CleanUpBacklogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Clean up Backlog — groups the undated, pending backlog by age since created
 * and lets the user bulk hard-delete whole strata or hand-picked tasks.
 * Opened from the Backlog rail (desktop) and Backlog sheet (mobile).
 *
 * The body lives in a child component that Radix only mounts while the dialog
 * is open, so the backlog query and all selection state are created fresh on
 * each open and torn down on close (no fetching while closed).
 */
export function CleanUpBacklogModal({
  open,
  onOpenChange,
}: CleanUpBacklogModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <CleanUpBacklogBody onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CleanUpBacklogBody({ onClose }: { onClose: () => void }) {
  // Filter to pending server-side so the `limit` paginates the tasks this
  // modal actually manages — otherwise completed undated tasks could fill the
  // first page and hide/undercount the pending backlog.
  const { data: tasks, isLoading } = useTasks({
    backlog: true,
    completed: false,
    limit: 500,
  });
  const batchDelete = useBatchDeleteTasks();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // All buckets start expanded; users can collapse any of them manually.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Pending (not completed) backlog tasks grouped into age buckets.
  const groups = React.useMemo(() => {
    const pending = (tasks ?? []).filter((t) => !t.completedAt);
    const byBucket = new Map<string, Task[]>();
    for (const task of pending) {
      const days = ageDays(task);
      // The last bucket has minDays 0, so a match is always found.
      const bucketKey = (BUCKETS.find((b) => days >= b.minDays) ?? BUCKETS[4]!)
        .key;
      const list = byBucket.get(bucketKey) ?? [];
      list.push(task);
      byBucket.set(bucketKey, list);
    }
    return BUCKETS.map((b) => ({
      ...b,
      tasks: (byBucket.get(b.key) ?? []).sort((a, c) => ageDays(c) - ageDays(a)),
    })).filter((g) => g.tasks.length > 0);
  }, [tasks]);

  const allTasks = React.useMemo(
    () => groups.flatMap((g) => g.tasks),
    [groups]
  );
  const total = allTasks.length;

  // Keep the selection in sync with the live list: if a selected task
  // disappears (background refetch, delete settle), drop its id so every
  // count and the master checkbox reflect exactly what will be deleted.
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(allTasks.map((t) => t.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (live.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [allTasks]);

  const selecting = selected.size > 0;

  const selectedTasks = React.useMemo(
    () => allTasks.filter((t) => selected.has(t.id)),
    [allTasks, selected]
  );

  const toggleTask = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBucket = (bucketKey: string) => {
    const group = groups.find((g) => g.key === bucketKey);
    if (!group) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = group.tasks.every((t) => next.has(t.id));
      group.tasks.forEach((t) => (allOn ? next.delete(t.id) : next.add(t.id)));
      return next;
    });
  };

  const toggleMaster = () => {
    // Tri-state: everything selected → clear; otherwise (none or mixed) →
    // select all. (Pruning keeps prev.size ≤ total.)
    setSelected((prev) =>
      prev.size >= total ? new Set() : new Set(allTasks.map((t) => t.id))
    );
  };

  const clearAll = () => setSelected(new Set());

  const toggleCollapse = (bucketKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(bucketKey)) next.delete(bucketKey);
      else next.add(bucketKey);
      return next;
    });
  };

  const bucketState = (group: (typeof groups)[number]): CheckState => {
    const count = group.tasks.filter((t) => selected.has(t.id)).length;
    if (count === 0) return "off";
    if (count === group.tasks.length) return "on";
    return "mixed";
  };

  const masterState: CheckState =
    selected.size === 0 ? "off" : selected.size >= total ? "on" : "mixed";

  const handleConfirmDelete = () => {
    const ids = selectedTasks.map((t) => t.id);
    if (ids.length === 0) return;
    batchDelete.mutate(ids);
    setSelected(new Set());
    setConfirmOpen(false);
  };

  return (
    <>
      <DialogHeader className="space-y-0.5 px-5 py-4 text-left">
        <DialogTitle className="text-base">Clean up Backlog</DialogTitle>
        <DialogDescription className="text-xs">
          {total} undated task{total === 1 ? "" : "s"} · oldest first
        </DialogDescription>
      </DialogHeader>

      {/* Control bar */}
      <div className="flex items-center gap-2.5 border-y px-5 py-2.5">
        <button
          type="button"
          onClick={toggleMaster}
          disabled={total === 0}
          className="flex items-center gap-2.5 text-sm font-medium disabled:opacity-40"
        >
          <CheckBox state={masterState} />
          <span>
            {selected.size === 0 ? "Select all" : `${selected.size} selected`}
          </span>
        </button>
        <div className="flex-1" />
        {selecting && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Deselect all
          </button>
        )}
      </div>

      {/* Body — native overflow scroll. Radix ScrollArea's nested h-full
          viewport doesn't resolve its height through this flex/max-h dialog
          chain, so the list wouldn't scroll; a plain overflow-y-auto flex
          child does. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Backlog's clean</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No unscheduled tasks to review.
              </p>
            </div>
          ) : (
            groups.map((group, gi) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <div
                  key={group.key}
                  className={cn(
                    "group/sec",
                    gi > 0 && "border-t border-border/60"
                  )}
                >
                  <div className="flex items-center gap-2.5 px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(group.key)}
                      className="shrink-0 text-muted-foreground"
                      aria-label={isCollapsed ? "Expand" : "Collapse"}
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 transition-transform",
                          !isCollapsed && "rotate-90"
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBucket(group.key)}
                      className={cn(
                        "shrink-0 transition-opacity",
                        selecting
                          ? "opacity-100"
                          : "opacity-0 group-hover/sec:opacity-100"
                      )}
                      aria-label={`Select ${group.label}`}
                    >
                      <CheckBox state={bucketState(group)} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCollapse(group.key)}
                      className="text-sm font-semibold"
                    >
                      {group.label}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {group.tasks.length}
                    </span>
                  </div>

                  {!isCollapsed && (
                    <div className="pb-2">
                      {group.tasks.map((task) => {
                        const isSel = selected.has(task.id);
                        const days = ageDays(task);
                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => toggleTask(task.id)}
                            className={cn(
                              "group/row flex w-full items-center gap-3 rounded-md py-1.5 pl-9 pr-2 text-left transition-colors",
                              isSel ? "bg-primary/[0.07]" : "hover:bg-accent/60"
                            )}
                          >
                            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                              <span
                                className={cn(
                                  "absolute h-1.5 w-1.5 rounded-full",
                                  PRIORITY_DOT[task.priority],
                                  isSel || selecting
                                    ? "opacity-0"
                                    : "opacity-100 group-hover/row:opacity-0"
                                )}
                              />
                              <span
                                className={cn(
                                  "absolute transition-opacity",
                                  isSel || selecting
                                    ? "opacity-100"
                                    : "opacity-0 group-hover/row:opacity-100"
                                )}
                              >
                                <CheckBox state={isSel ? "on" : "off"} />
                              </span>
                            </span>
                            <span className="flex-1 truncate text-sm">
                              {task.title}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {ageLabel(days)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
      </div>

      {/* Footer */}
      <DialogFooter className="flex-row items-center gap-2 border-t px-5 py-3 sm:justify-end">
        <div className="flex-1" />
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={selected.size === 0}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          {selected.size === 0 ? "Delete" : `Delete ${selected.size}`}
        </Button>
      </DialogFooter>

      {/* Confirm — hard delete */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">
              Delete {selectedTasks.length} task
              {selectedTasks.length === 1 ? "" : "s"} permanently?
            </DialogTitle>
            <DialogDescription>This can't be undone.</DialogDescription>
          </DialogHeader>
          <div className="max-h-40 divide-y overflow-auto rounded-md border">
            {selectedTasks.slice(0, 4).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2.5 px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    PRIORITY_DOT[task.priority]
                  )}
                />
                <span className="flex-1 truncate">{task.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {ageLabel(ageDays(task))}
                </span>
              </div>
            ))}
            {selectedTasks.length > 4 && (
              <div className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                + {selectedTasks.length - 4} more
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete {selectedTasks.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
