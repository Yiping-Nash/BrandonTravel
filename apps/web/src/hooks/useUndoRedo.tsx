import * as React from "react";
import { toast } from "@/hooks/use-toast";

/**
 * A single reversible action. `undo` reverts it, `redo` re-applies it. Both
 * should be self-contained (call the API directly, not the recording mutation
 * hooks) so running them never records new history entries.
 */
export interface UndoEntry {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

interface UndoRedoContextValue {
  record: (entry: UndoEntry) => void;
  undo: () => void;
  redo: () => void;
}

// No-op default so hooks that call useUndoRedo() outside the provider (e.g.
// on a marketing page) don't throw and simply skip history.
const NOOP: UndoRedoContextValue = {
  record: () => {},
  undo: () => {},
  redo: () => {},
};

const UndoRedoContext = React.createContext<UndoRedoContextValue>(NOOP);

const MAX_HISTORY = 100;

export function UndoRedoProvider({ children }: { children: React.ReactNode }) {
  const undoStack = React.useRef<UndoEntry[]>([]);
  const redoStack = React.useRef<UndoEntry[]>([]);
  const busy = React.useRef(false);

  const record = React.useCallback((entry: UndoEntry) => {
    // Don't capture history for the mutations triggered by undo/redo itself.
    if (busy.current) return;
    undoStack.current.push(entry);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    // A fresh action invalidates the redo branch.
    redoStack.current = [];
  }, []);

  const run = React.useCallback(
    async (kind: "undo" | "redo") => {
      if (busy.current) return;
      const from = kind === "undo" ? undoStack : redoStack;
      const to = kind === "undo" ? redoStack : undoStack;
      const entry = from.current.pop();
      if (!entry) {
        toast({
          title: kind === "undo" ? "Nothing to undo" : "Nothing to redo",
        });
        return;
      }
      busy.current = true;
      try {
        await (kind === "undo" ? entry.undo() : entry.redo());
        to.current.push(entry);
        toast({
          title: kind === "undo" ? "Undone" : "Redone",
          description: entry.label,
        });
      } catch (err) {
        // Put it back so the user can retry, and surface the failure.
        from.current.push(entry);
        toast({
          variant: "destructive",
          title: kind === "undo" ? "Couldn't undo" : "Couldn't redo",
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        busy.current = false;
      }
    },
    []
  );

  const undo = React.useCallback(() => {
    void run("undo");
  }, [run]);
  const redo = React.useCallback(() => {
    void run("redo");
  }, [run]);

  const value = React.useMemo(
    () => ({ record, undo, redo }),
    [record, undo, redo]
  );

  return (
    <UndoRedoContext.Provider value={value}>
      {children}
    </UndoRedoContext.Provider>
  );
}

export function useUndoRedo() {
  return React.useContext(UndoRedoContext);
}
