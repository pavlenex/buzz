import {
  BookOpenText,
  ChevronRight,
  Copy,
  FileText,
  Hash,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";

import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

function getChannelIcon(channelType: Channel["channelType"]): LucideIcon {
  if (channelType === "forum") {
    return FileText;
  }
  if (channelType === "dm") {
    return MessageSquare;
  }
  return Hash;
}

export function ChannelHero({ channel }: { channel: Channel }) {
  const Icon = getChannelIcon(channel.channelType);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/60">
        <Icon className="h-8 w-8 text-foreground" />
      </div>
      <h3 className="max-w-full truncate text-xl font-semibold tracking-tight">
        {channel.name}
      </h3>
    </div>
  );
}

export function ChannelQuickAction({
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
      className="flex w-20 flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
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
        <Icon className="h-5 w-5" />
      </span>
      <span className="max-w-full truncate text-sm text-muted-foreground">
        {label}
      </span>
    </button>
  );
}

export function FieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-muted/20">{children}</div>
  );
}

function FieldIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}

export function InfoFieldRow({
  icon,
  label,
  value,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      className="flex w-full items-center gap-3 px-4 py-3"
      data-testid={testId}
    >
      <FieldIcon icon={icon} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          {value}
        </span>
      </span>
    </div>
  );
}

export function CopyFieldRow({
  icon,
  label,
  value,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  testId?: string;
}) {
  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    toast.success(`Copied ${label.toLowerCase()}`);
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
      onClick={() => {
        void handleCopy();
      }}
      title={`Copy ${label}`}
      type="button"
    >
      <FieldIcon icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate font-mono text-sm text-muted-foreground">
          {value}
        </span>
      </span>
      <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function NarrativeField({
  icon,
  label,
  value,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      className="flex w-full items-start gap-3 px-4 py-3"
      data-testid={testId}
    >
      <FieldIcon icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="mt-1 block whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {value}
        </span>
      </span>
    </div>
  );
}

export function CanvasSummaryRow({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-2xl bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <FieldIcon icon={BookOpenText} />
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
