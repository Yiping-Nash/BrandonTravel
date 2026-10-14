import { cn } from "@/lib/utils";
import { getIdeaIcon } from "./idea-icons";

interface BoardIconProps {
  icon: string;
  color: string;
  /** Square size in px (icon scales to ~64%). */
  size?: number;
  className?: string;
}

/** A board glyph: a lucide icon tinted onto a soft colored square. */
export function BoardIcon({ icon, color, size = 22, className }: BoardIconProps) {
  const Icon = getIdeaIcon(icon);
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-md shrink-0",
        className
      )}
      style={{
        width: size,
        height: size,
        // 8-digit hex = color + alpha; ~15% tint background, full-color glyph.
        backgroundColor: `${color}26`,
        color,
      }}
    >
      <Icon style={{ width: size * 0.64, height: size * 0.64 }} />
    </span>
  );
}
