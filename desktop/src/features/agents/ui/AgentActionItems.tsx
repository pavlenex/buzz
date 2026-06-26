import {
  BookmarkPlus,
  Clipboard,
  FileText,
  Pencil,
  Play,
  Power,
  Square,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import type { ManagedAgent } from "@/shared/api/types";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/shared/ui/dropdown-menu";

export type AgentMenuProps = {
  isActionPending: boolean;
  onAddToChannel: (agent: ManagedAgent) => void;
  onDelete: (pubkey: string) => void;
  onOpenLogs: (pubkey: string) => void;
  onSaveAsTemplate: (agent: ManagedAgent) => void;
  onStart: (pubkey: string) => void;
  onStop: (pubkey: string) => void;
  onToggleStartOnAppLaunch: (pubkey: string, startOnAppLaunch: boolean) => void;
};

/**
 * The shared dropdown-menu item list for a managed agent. Rendered inside the
 * standalone-agent menu, the persona-backed-agent menu, and the agent card
 * menu — kept here so all three stay in lockstep.
 */
export function AgentActionItems({
  agent,
  isActionPending,
  onAddToChannel,
  onDelete,
  onEdit,
  onOpenLogs,
  onSaveAsTemplate,
  onStart,
  onStop,
  onToggleStartOnAppLaunch,
}: { agent: ManagedAgent; onEdit?: () => void } & AgentMenuProps) {
  const isActive = isManagedAgentActive(agent);

  return (
    <>
      {agent.backend.type === "provider" ? (
        <>
          <DropdownMenuItem
            disabled={isActionPending}
            onClick={() => onStart(agent.pubkey)}
          >
            <Play className="h-4 w-4" />
            {isActive ? "Redeploy" : "Deploy"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isActionPending}
            onClick={() => onStop(agent.pubkey)}
          >
            <Square className="h-4 w-4" />
            Shutdown
          </DropdownMenuItem>
        </>
      ) : isActive ? (
        <DropdownMenuItem
          disabled={isActionPending}
          onClick={() => onStop(agent.pubkey)}
        >
          <Square className="h-4 w-4" />
          Stop
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={isActionPending}
          onClick={() => onStart(agent.pubkey)}
        >
          <Play className="h-4 w-4" />
          Spawn
        </DropdownMenuItem>
      )}

      {agent.backend.type !== "provider" && onEdit ? (
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          Edit agent
        </DropdownMenuItem>
      ) : null}

      {/* Opt-in promote — hidden for persona-backed agents (already reusable). */}
      {!agent.personaId ? (
        <DropdownMenuItem
          disabled={isActionPending}
          onClick={() => onSaveAsTemplate(agent)}
        >
          <BookmarkPlus className="h-4 w-4" />
          Save as persona template
        </DropdownMenuItem>
      ) : null}

      <DropdownMenuItem
        disabled={isActionPending}
        onClick={() => onAddToChannel(agent)}
      >
        <UserPlus className="h-4 w-4" />
        Add to channel
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={async () => {
          await navigator.clipboard.writeText(agent.pubkey);
          toast.success("Copied pubkey to clipboard");
        }}
      >
        <Clipboard className="h-4 w-4" />
        Copy pubkey
      </DropdownMenuItem>

      {agent.backend.type === "local" ? (
        <DropdownMenuItem onClick={() => onOpenLogs(agent.pubkey)}>
          <FileText className="h-4 w-4" />
          View logs
        </DropdownMenuItem>
      ) : null}

      {agent.backend.type === "local" ? (
        <DropdownMenuItem
          disabled={isActionPending}
          onClick={() =>
            onToggleStartOnAppLaunch(agent.pubkey, !agent.startOnAppLaunch)
          }
        >
          <Power className="h-4 w-4" />
          {agent.startOnAppLaunch ? "Disable auto-start" : "Enable auto-start"}
        </DropdownMenuItem>
      ) : null}

      <DropdownMenuSeparator />

      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        disabled={isActionPending}
        onClick={() => onDelete(agent.pubkey)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </DropdownMenuItem>
    </>
  );
}
