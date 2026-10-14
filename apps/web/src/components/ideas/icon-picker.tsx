import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui";
import { COLOR_OPTIONS } from "@/components/calendar/time-block-form-sections";
import { IDEA_ICON_NAMES, getIdeaIcon } from "./idea-icons";

interface IconPickerProps {
  icon: string;
  color: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
}

/**
 * Board icon + color picker. Searchable grid over the curated lucide set
 * plus the shared COLOR_OPTIONS swatches (same component vocabulary as the
 * time-block color picker). Render inside a Popover.
 */
export function IconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: IconPickerProps) {
  const [query, setQuery] = React.useState("");

  const names = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return IDEA_ICON_NAMES;
    return IDEA_ICON_NAMES.filter((n) => n.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="w-[300px] p-1">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${IDEA_ICON_NAMES.length} icons…`}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="grid max-h-[180px] grid-cols-8 gap-1 overflow-y-auto scrollbar-thin">
        {names.map((name) => {
          const Icon = getIdeaIcon(name);
          const selected = name === icon;
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onIconChange(name)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors",
                selected
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        {names.length === 0 && (
          <p className="col-span-8 py-4 text-center text-xs text-muted-foreground">
            No icons match “{query}”
          </p>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2.5">
        {COLOR_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            onClick={() => onColorChange(option.value)}
            className={cn(
              "h-5 w-5 rounded-full transition-all",
              color === option.value
                ? "ring-2 ring-primary/60 ring-offset-1 ring-offset-background"
                : "hover:scale-110"
            )}
            style={{ backgroundColor: option.value }}
          />
        ))}
      </div>
    </div>
  );
}
