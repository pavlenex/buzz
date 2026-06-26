import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/cn";

/**
 * A single circular quick action (icon + label) in the profile summary's
 * action row — e.g. Follow / Message / Edit.
 */
export function ProfileQuickAction({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      className="flex flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full transition-colors",
          active
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "bg-muted/60 text-foreground hover:bg-muted/80",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span
        className={cn(
          "text-xs",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * A quick action styled to match `ProfileQuickAction` but rendered as a
 * `forwardRef` button so it can be a Radix `DropdownMenuTrigger asChild`
 * (which clones the child and injects a ref + `aria-*`/event props). Used for
 * the overflow `⋮` that hosts actions like "Save as persona template".
 */
export const ProfileQuickActionTrigger = React.forwardRef<
  HTMLButtonElement,
  {
    ariaLabel: string;
    icon: LucideIcon;
    label: string;
    testId?: string;
  } & React.ComponentPropsWithoutRef<"button">
>(function ProfileQuickActionTrigger(
  { ariaLabel, icon: Icon, label, testId, ...props },
  ref,
) {
  return (
    <button
      aria-label={ariaLabel}
      className="flex flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={testId}
      ref={ref}
      type="button"
      {...props}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/60 text-foreground transition-colors hover:bg-muted/80">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  );
});
