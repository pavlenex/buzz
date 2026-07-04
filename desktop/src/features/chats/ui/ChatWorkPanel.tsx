import { GitBranch } from "lucide-react";

import {
  parseGithubPullRequestRef,
  useGithubPullRequestQuery,
} from "@/shared/lib/githubPullRequest";
import { parseSupportedLinkPreview } from "@/shared/lib/linkPreview";
import { AgentPullRequestCard } from "@/shared/ui/link-preview-attachment";

/**
 * Right-hand work module for a chat whose agent produced a pull request:
 * the PR's source branch and the live PR card (status, diff stats, link).
 * The conversation column and composer shrink to make room.
 */
export function ChatWorkPanel({ prHref }: { prHref: string }) {
  const preview = parseSupportedLinkPreview(prHref);
  const ref = parseGithubPullRequestRef(prHref);
  const query = useGithubPullRequestQuery(ref);
  const branch = query.data?.headRef?.trim();

  if (!preview) {
    return null;
  }

  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/40 px-4 py-4"
      data-testid="chat-work-panel"
    >
      <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Work
      </div>
      {branch ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono">{branch}</span>
        </div>
      ) : null}
      <AgentPullRequestCard preview={preview} />
    </aside>
  );
}
