import * as React from "react";
import { CheckCircle2, CircleSlash, FolderOpen, Plug } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ExtensionEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

type McpServersSectionProps = {
  configFilePath: string | null;
  extensions: ExtensionEntry[];
  runtimeId: string | null;
  variant?: "compact" | "profile";
  buzzAgentSlot?: React.ReactNode;
};

export function McpServersSection({
  buzzAgentSlot,
  configFilePath,
  extensions,
  runtimeId,
  variant = "compact",
}: McpServersSectionProps) {
  const isBuzzAgent = runtimeId === "buzz-agent";
  const shouldRender =
    isBuzzAgent || extensions.length > 0 || configFilePath !== null;

  const revealConfigFile = React.useCallback(() => {
    if (!configFilePath) {
      return;
    }
    void revealItemInDir(configFilePath);
  }, [configFilePath]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={cn(
        "border-t border-border/50",
        variant === "compact" ? "mt-3 pt-2" : "divide-y divide-border/50",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-start gap-3",
          variant === "compact" ? "py-2" : "px-4 py-3",
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60">
          <Plug className="h-4 w-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                MCP Servers
              </div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">
                {extensions.length > 0
                  ? `${extensions.length} configured`
                  : isBuzzAgent
                    ? "No custom servers configured"
                    : "No servers found"}
              </div>
            </div>
            {configFilePath ? (
              <button
                aria-label="Reveal MCP config file"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onClick={revealConfigFile}
                title="Reveal MCP config file"
                type="button"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {configFilePath ? (
            <div className="mt-1 truncate text-2xs text-muted-foreground/70">
              Edit in {configFilePath}
            </div>
          ) : null}
        </div>
      </div>

      {isBuzzAgent && buzzAgentSlot ? buzzAgentSlot : null}

      {extensions.length > 0 ? (
        <div
          className={cn(
            "divide-y divide-border/50",
            variant === "compact" ? "mt-1" : "",
          )}
        >
          {extensions.map((extension) => (
            <McpServerRow
              extension={extension}
              key={`${extension.kind}:${extension.name}`}
              variant={variant}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function McpServerRow({
  extension,
  variant,
}: {
  extension: ExtensionEntry;
  variant: "compact" | "profile";
}) {
  const StatusIcon = extension.enabled ? CheckCircle2 : CircleSlash;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        variant === "compact" ? "py-2" : "px-4 py-3",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50">
        <StatusIcon
          className={cn(
            "h-4 w-4",
            extension.enabled ? "text-emerald-600" : "text-muted-foreground",
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {extension.name}
        </span>
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground/70">
          {extension.kind}
          {extension.enabled ? " enabled" : " disabled"}
        </span>
      </span>
    </div>
  );
}
