import {
  Archive,
  ArchiveRestore,
  Copy,
  DoorClosed,
  DoorOpen,
  Eye,
  FileText,
  Fingerprint,
  Lock,
  MessageSquare,
  Pencil,
  Radio,
  Type,
  Users,
  Zap,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  useArchiveChannelMutation,
  useChannelDetailsQuery,
  useChannelMembersQuery,
  useDeleteChannelMutation,
  useJoinChannelMutation,
  useLeaveChannelMutation,
  useSetChannelPurposeMutation,
  useSetChannelTopicMutation,
  useUnarchiveChannelMutation,
  useUpdateChannelMutation,
} from "@/features/channels/hooks";
import { compareMembersByRole } from "@/features/channels/lib/memberUtils";
import {
  formatTtlDuration,
  parseTtlDuration,
} from "@/features/channels/lib/ephemeralChannel";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "@/features/settings/ui/SettingsOptionGroup";
import { CreateWorkflowDialog } from "@/features/workflows/ui/CreateWorkflowDialog";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { ChannelCanvas } from "./ChannelCanvas";
import {
  CanvasSummaryRow,
  ChannelHero,
  ChannelQuickAction,
  CopyFieldRow,
  FieldGroup,
  InfoFieldRow,
  NarrativeField,
} from "./ChannelManagementSheetRows";

type ChannelManagementSheetProps = {
  channel: Channel | null;
  currentPubkey?: string;
  onDeleted?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const DEFAULT_EPHEMERAL_TTL_SECONDS = 24 * 60 * 60;

export function ChannelManagementSheet({
  channel,
  currentPubkey,
  onDeleted,
  onOpenChange,
  open,
}: ChannelManagementSheetProps) {
  const channelId = channel?.id ?? null;
  const detailsQuery = useChannelDetailsQuery(channelId, open);
  const membersQuery = useChannelMembersQuery(channelId, open);
  const updateChannelDetailsMutation = useUpdateChannelMutation(channelId);
  const updateChannelLifecycleMutation = useUpdateChannelMutation(channelId);
  const setTopicMutation = useSetChannelTopicMutation(channelId);
  const setPurposeMutation = useSetChannelPurposeMutation(channelId);
  const archiveChannelMutation = useArchiveChannelMutation(channelId);
  const unarchiveChannelMutation = useUnarchiveChannelMutation(channelId);
  const deleteChannelMutation = useDeleteChannelMutation(channelId);
  const joinChannelMutation = useJoinChannelMutation(channelId);
  const leaveChannelMutation = useLeaveChannelMutation(channelId);

  const detail = detailsQuery.data ?? channel;
  const members = React.useMemo(() => {
    const currentMembers = membersQuery.data ?? [];
    return [...currentMembers].sort((left, right) =>
      compareMembersByRole(left, right, currentPubkey),
    );
  }, [currentPubkey, membersQuery.data]);
  const selfMember =
    members.find((member) => member.pubkey === currentPubkey) ?? null;
  const hasResolvedMembership = membersQuery.data !== undefined;
  const isOwner = selfMember?.role === "owner";
  const canManageChannel =
    selfMember?.role === "owner" || selfMember?.role === "admin";
  const canEditNarrative = selfMember !== null && detail?.channelType !== "dm";
  const isArchived =
    detail?.archivedAt !== null && detail?.archivedAt !== undefined;
  const canJoin =
    hasResolvedMembership &&
    detail?.channelType !== "dm" &&
    detail?.visibility === "open" &&
    !isArchived &&
    selfMember === null;
  const canLeave =
    hasResolvedMembership &&
    detail?.channelType !== "dm" &&
    !isArchived &&
    selfMember !== null;
  const memberCount =
    members.length || detail?.memberCount || channel?.memberCount || 0;
  const [nameDraft, setNameDraft] = React.useState("");
  const [descriptionDraft, setDescriptionDraft] = React.useState("");
  const [topicDraft, setTopicDraft] = React.useState("");
  const [purposeDraft, setPurposeDraft] = React.useState("");
  const [isPrivateDraft, setIsPrivateDraft] = React.useState(false);
  const [isEphemeralDraft, setIsEphemeralDraft] = React.useState(false);
  const [ttlDraft, setTtlDraft] = React.useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [isCreateWorkflowOpen, setIsCreateWorkflowOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);

  // Sync drafts from server only when the sheet opens or the channel changes —
  // not on every background refetch, which would clobber in-flight edits.
  const syncedForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      // Reset on close so the next open re-syncs from server.
      syncedForRef.current = null;
      setIsDeleteDialogOpen(false);
      setIsCreateWorkflowOpen(false);
      setIsEditDialogOpen(false);
      return;
    }
    if (!detail) {
      return;
    }

    const key = detail.id;
    if (syncedForRef.current === key) {
      return;
    }
    syncedForRef.current = key;

    setNameDraft(detail.name);
    setDescriptionDraft(detail.description);
    setTopicDraft(detail.topic ?? "");
    setPurposeDraft(detail.purpose ?? "");
    setIsPrivateDraft(detail.visibility === "private");
    setIsEphemeralDraft(detail.ttlSeconds !== null);
    setTtlDraft(
      detail.ttlSeconds !== null ? formatTtlDuration(detail.ttlSeconds) : "",
    );
  }, [detail, open]);

  if (!channel) {
    return null;
  }

  function handleDeleteDialogOpenChange(next: boolean) {
    deleteChannelMutation.reset();
    setIsDeleteDialogOpen(next);
  }

  async function handleDeleteChannel() {
    try {
      await deleteChannelMutation.mutateAsync();
      handleDeleteDialogOpenChange(false);
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // The mutation error is rendered inline in the confirmation dialog.
    }
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next) {
      handleDeleteDialogOpenChange(false);
    }

    onOpenChange(next);
  }

  // Parsed seconds for the ephemeral TTL field. `null` when the field is empty
  // or malformed; the form blocks saving on a non-empty malformed value.
  const parsedTtlSeconds = parseTtlDuration(ttlDraft);
  const ttlInvalid =
    isEphemeralDraft && ttlDraft.trim() !== "" && parsedTtlSeconds === null;

  const currentVisibility = detail?.visibility ?? channel.visibility;
  const currentTtlSeconds = detail?.ttlSeconds ?? null;
  const nextVisibility: "open" | "private" = isPrivateDraft
    ? "private"
    : "open";
  const nextTtlSeconds: number | null = isEphemeralDraft
    ? (parsedTtlSeconds ?? DEFAULT_EPHEMERAL_TTL_SECONDS)
    : null;
  const lifecycleDirty =
    nextVisibility !== currentVisibility ||
    nextTtlSeconds !== currentTtlSeconds;

  function handleSaveLifecycle() {
    void updateChannelLifecycleMutation.mutateAsync({
      visibility:
        nextVisibility !== currentVisibility ? nextVisibility : undefined,
      ttlSeconds:
        nextTtlSeconds !== currentTtlSeconds ? nextTtlSeconds : undefined,
    });
  }

  const resolvedChannel = detail ?? channel;
  const canEditChannel = canManageChannel || canEditNarrative;

  return (
    <Dialog onOpenChange={handleSheetOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[min(860px,calc(100vh-2rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        data-testid="channel-management-modal"
      >
        <DialogHeader className="border-b border-border/80 px-7 py-6 pr-14 sm:px-8">
          <DialogTitle>Channel</DialogTitle>
          <DialogDescription className="sr-only">
            Channel settings
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-6 overflow-y-auto bg-background px-7 py-6 sm:px-8">
          <ChannelHero channel={resolvedChannel} />

          <div className="flex flex-wrap items-start justify-center gap-4">
            <ChannelQuickAction
              icon={Copy}
              label="Copy ID"
              onClick={() => {
                void navigator.clipboard
                  .writeText(resolvedChannel.id)
                  .then(() => toast.success("Copied channel ID"));
              }}
              testId="channel-management-copy-id-action"
            />
            {canJoin ? (
              <ChannelQuickAction
                active
                disabled={joinChannelMutation.isPending}
                icon={DoorOpen}
                label={joinChannelMutation.isPending ? "Joining..." : "Join"}
                onClick={() => {
                  void joinChannelMutation.mutateAsync();
                }}
                testId="channel-management-join"
              />
            ) : null}
            {canLeave ? (
              <ChannelQuickAction
                disabled={leaveChannelMutation.isPending}
                icon={DoorClosed}
                label={leaveChannelMutation.isPending ? "Leaving..." : "Leave"}
                onClick={() => {
                  void leaveChannelMutation.mutateAsync().then(() => {
                    onOpenChange(false);
                  });
                }}
                testId="channel-management-leave"
              />
            ) : null}
            {canEditChannel ? (
              <ChannelQuickAction
                icon={Pencil}
                label="Edit"
                onClick={() => setIsEditDialogOpen(true)}
                testId="channel-management-edit"
              />
            ) : null}
          </div>

          {detailsQuery.error instanceof Error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {detailsQuery.error.message}
            </p>
          ) : null}

          {membersQuery.error instanceof Error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {membersQuery.error.message}
            </p>
          ) : null}

          {joinChannelMutation.error instanceof Error ? (
            <p className="text-center text-sm text-destructive">
              {joinChannelMutation.error.message}
            </p>
          ) : null}

          {leaveChannelMutation.error instanceof Error ? (
            <p className="text-center text-sm text-destructive">
              {leaveChannelMutation.error.message}
            </p>
          ) : null}

          {resolvedChannel.description.trim() ||
          resolvedChannel.topic?.trim() ||
          resolvedChannel.purpose?.trim() ? (
            <FieldGroup>
              {resolvedChannel.description.trim() ? (
                <NarrativeField
                  icon={FileText}
                  label="Description"
                  testId="channel-management-description-summary"
                  value={resolvedChannel.description.trim()}
                />
              ) : null}
              {resolvedChannel.topic?.trim() ? (
                <NarrativeField
                  icon={MessageSquare}
                  label="Topic"
                  testId="channel-management-topic-summary"
                  value={resolvedChannel.topic.trim()}
                />
              ) : null}
              {resolvedChannel.purpose?.trim() ? (
                <NarrativeField
                  icon={Zap}
                  label="Purpose"
                  testId="channel-management-purpose-summary"
                  value={resolvedChannel.purpose.trim()}
                />
              ) : null}
            </FieldGroup>
          ) : null}

          <div data-testid="channel-canvas-section">
            <CanvasSummaryRow
              onClick={() => {
                setIsEditDialogOpen(true);
              }}
            >
              <span className="block text-sm font-medium text-foreground">
                Canvas
              </span>
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                Open editor
              </span>
            </CanvasSummaryRow>
          </div>

          <FieldGroup>
            <CopyFieldRow
              icon={Fingerprint}
              label="Channel ID"
              testId="channel-management-channel-id"
              value={resolvedChannel.id}
            />
            <InfoFieldRow
              icon={Type}
              label="Name"
              testId="channel-management-name-row"
              value={resolvedChannel.name}
            />
            <InfoFieldRow
              icon={Radio}
              label="Type"
              testId="channel-management-type"
              value={resolvedChannel.channelType}
            />
            <InfoFieldRow
              icon={resolvedChannel.visibility === "private" ? Lock : Eye}
              label="Visibility"
              testId="channel-management-visibility"
              value={resolvedChannel.visibility}
            />
            <InfoFieldRow
              icon={Users}
              label="Members"
              testId="channel-management-member-count"
              value={`${memberCount}`}
            />
            {isArchived ? (
              <InfoFieldRow
                icon={Archive}
                label="Status"
                testId="channel-management-archived"
                value="Archived"
              />
            ) : null}
            {resolvedChannel.ttlSeconds !== null ? (
              <InfoFieldRow
                icon={Archive}
                label="Ephemeral"
                testId="channel-management-ephemeral-row"
                value={formatTtlDuration(resolvedChannel.ttlSeconds)}
              />
            ) : null}
          </FieldGroup>

          {canEditNarrative ? (
            <Button
              className="w-full justify-start"
              data-testid="channel-management-create-workflow"
              onClick={() => setIsCreateWorkflowOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Zap className="h-4 w-4" />
              Create workflow
            </Button>
          ) : null}
        </div>

        {resolvedChannel.channelType !== "dm" ? (
          <div
            className="border-t border-border/80 bg-background px-7 py-4 sm:px-8"
            data-testid="channel-management-footer"
          >
            <div className="w-full space-y-3">
              <div className="flex items-center gap-2">
                {isArchived ? (
                  <Button
                    data-testid="channel-management-unarchive"
                    disabled={
                      !canManageChannel || unarchiveChannelMutation.isPending
                    }
                    onClick={() => {
                      void unarchiveChannelMutation.mutateAsync();
                    }}
                    size="sm"
                    type="button"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    {unarchiveChannelMutation.isPending
                      ? "Restoring..."
                      : "Unarchive"}
                  </Button>
                ) : (
                  <Button
                    data-testid="channel-management-archive"
                    disabled={
                      !canManageChannel || archiveChannelMutation.isPending
                    }
                    onClick={() => {
                      void archiveChannelMutation.mutateAsync();
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Archive className="h-4 w-4" />
                    {archiveChannelMutation.isPending
                      ? "Archiving..."
                      : "Archive"}
                  </Button>
                )}
                <div className="flex-1" />
                {isOwner ? (
                  <AlertDialog
                    onOpenChange={handleDeleteDialogOpenChange}
                    open={isDeleteDialogOpen}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        data-testid="channel-management-delete"
                        disabled={deleteChannelMutation.isPending}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent data-testid="channel-delete-confirmation-dialog">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete channel?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Delete {resolvedChannel.name} from the workspace list.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      {deleteChannelMutation.error instanceof Error ? (
                        <p className="text-sm text-destructive">
                          {deleteChannelMutation.error.message}
                        </p>
                      ) : null}
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button
                            data-testid="channel-delete-cancel"
                            disabled={deleteChannelMutation.isPending}
                            type="button"
                            variant="outline"
                          >
                            Cancel
                          </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button
                            data-testid="channel-delete-confirm"
                            disabled={deleteChannelMutation.isPending}
                            onClick={(event) => {
                              event.preventDefault();
                              void handleDeleteChannel();
                            }}
                            type="button"
                            variant="destructive"
                          >
                            {deleteChannelMutation.isPending
                              ? "Deleting..."
                              : "Delete channel"}
                          </Button>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>
              {archiveChannelMutation.error instanceof Error ? (
                <p className="text-sm text-destructive">
                  {archiveChannelMutation.error.message}
                </p>
              ) : null}
              {unarchiveChannelMutation.error instanceof Error ? (
                <p className="text-sm text-destructive">
                  {unarchiveChannelMutation.error.message}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>

      <Dialog onOpenChange={setIsEditDialogOpen} open={isEditDialogOpen}>
        <DialogContent
          className="flex max-h-[min(760px,calc(100vh-2rem))] max-w-2xl flex-col gap-0 overflow-hidden p-0"
          data-testid="channel-management-edit-dialog"
        >
          <DialogHeader className="border-b border-border/80 px-6 py-5 pr-14">
            <DialogTitle>Edit channel</DialogTitle>
            <DialogDescription className="sr-only">
              Edit channel details
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void updateChannelDetailsMutation.mutateAsync({
                  description: descriptionDraft.trim() || undefined,
                  name: nameDraft.trim() || undefined,
                });
              }}
            >
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="channel-name">
                  Name
                </label>
                <Input
                  data-testid="channel-management-name"
                  disabled={
                    !canManageChannel || updateChannelDetailsMutation.isPending
                  }
                  id="channel-name"
                  onChange={(event) => setNameDraft(event.target.value)}
                  value={nameDraft}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="channel-description"
                >
                  Description
                </label>
                <Textarea
                  className="min-h-24"
                  data-testid="channel-management-description"
                  disabled={
                    !canManageChannel || updateChannelDetailsMutation.isPending
                  }
                  id="channel-description"
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  value={descriptionDraft}
                />
              </div>
              <Button
                data-testid="channel-management-save-details"
                disabled={
                  !canManageChannel || updateChannelDetailsMutation.isPending
                }
                size="sm"
                type="submit"
              >
                {updateChannelDetailsMutation.isPending
                  ? "Saving..."
                  : "Save details"}
              </Button>
              {updateChannelDetailsMutation.error instanceof Error ? (
                <p className="text-sm text-destructive">
                  {updateChannelDetailsMutation.error.message}
                </p>
              ) : null}
            </form>

            <div data-testid="channel-canvas-editor-section">
              <ChannelCanvas
                canEdit={canEditNarrative}
                channelId={channelId}
                isArchived={isArchived}
              />
            </div>

            {resolvedChannel.channelType !== "dm" ? (
              <div
                className="space-y-3"
                data-testid="channel-management-lifecycle"
              >
                <SettingsOptionGroup>
                  <SettingsOptionRow>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Private</p>
                      <p className="text-xs text-muted-foreground">
                        Only members can find and join this channel.
                      </p>
                    </div>
                    <Switch
                      checked={isPrivateDraft}
                      data-testid="channel-management-private-toggle"
                      disabled={
                        !canManageChannel ||
                        updateChannelLifecycleMutation.isPending
                      }
                      onCheckedChange={setIsPrivateDraft}
                    />
                  </SettingsOptionRow>

                  <SettingsOptionRow className="border-t border-border/60">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Ephemeral</p>
                      <p className="text-xs text-muted-foreground">
                        Automatically delete this channel after a set time.
                      </p>
                    </div>
                    <Switch
                      checked={isEphemeralDraft}
                      data-testid="channel-management-ephemeral-toggle"
                      disabled={
                        !canManageChannel ||
                        updateChannelLifecycleMutation.isPending
                      }
                      onCheckedChange={setIsEphemeralDraft}
                    />
                  </SettingsOptionRow>
                </SettingsOptionGroup>

                {isEphemeralDraft ? (
                  <div className="space-y-1.5 rounded-2xl bg-muted/20 p-4">
                    <label
                      className="text-sm font-medium"
                      htmlFor="channel-ttl"
                    >
                      Timeout
                    </label>
                    <Input
                      aria-invalid={ttlInvalid}
                      data-testid="channel-management-ttl"
                      disabled={
                        !canManageChannel ||
                        updateChannelLifecycleMutation.isPending
                      }
                      id="channel-ttl"
                      onChange={(event) => setTtlDraft(event.target.value)}
                      placeholder="e.g. 1d, 12h, 30m"
                      value={ttlDraft}
                    />
                    <p
                      className={cn(
                        "text-xs",
                        ttlInvalid
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {ttlInvalid
                        ? "Enter a duration like 1d, 12h, or 30m."
                        : "Defaults to 1d when left empty. Resets the deletion countdown from now whenever changed."}
                    </p>
                  </div>
                ) : null}

                <Button
                  data-testid="channel-management-save-lifecycle"
                  disabled={
                    !canManageChannel ||
                    updateChannelLifecycleMutation.isPending ||
                    ttlInvalid ||
                    !lifecycleDirty
                  }
                  onClick={handleSaveLifecycle}
                  size="sm"
                  type="button"
                >
                  {updateChannelLifecycleMutation.isPending
                    ? "Saving..."
                    : "Save visibility"}
                </Button>
              </div>
            ) : null}

            <div className="space-y-3">
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void setTopicMutation.mutateAsync({
                    topic: topicDraft.trim(),
                  });
                }}
              >
                <div className="space-y-1.5">
                  <label
                    className="text-sm font-medium"
                    htmlFor="channel-topic"
                  >
                    Topic
                  </label>
                  <Input
                    data-testid="channel-management-topic"
                    disabled={!canEditNarrative || setTopicMutation.isPending}
                    id="channel-topic"
                    onChange={(event) => setTopicDraft(event.target.value)}
                    value={topicDraft}
                  />
                </div>
                <Button
                  data-testid="channel-management-save-topic"
                  disabled={!canEditNarrative || setTopicMutation.isPending}
                  size="sm"
                  type="submit"
                  variant="outline"
                >
                  {setTopicMutation.isPending ? "Saving..." : "Save topic"}
                </Button>
                {setTopicMutation.error instanceof Error ? (
                  <p className="text-sm text-destructive">
                    {setTopicMutation.error.message}
                  </p>
                ) : null}
              </form>

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void setPurposeMutation.mutateAsync({
                    purpose: purposeDraft.trim(),
                  });
                }}
              >
                <div className="space-y-1.5">
                  <label
                    className="text-sm font-medium"
                    htmlFor="channel-purpose"
                  >
                    Purpose
                  </label>
                  <Input
                    data-testid="channel-management-purpose"
                    disabled={!canEditNarrative || setPurposeMutation.isPending}
                    id="channel-purpose"
                    onChange={(event) => setPurposeDraft(event.target.value)}
                    value={purposeDraft}
                  />
                </div>
                <Button
                  data-testid="channel-management-save-purpose"
                  disabled={!canEditNarrative || setPurposeMutation.isPending}
                  size="sm"
                  type="submit"
                  variant="outline"
                >
                  {setPurposeMutation.isPending ? "Saving..." : "Save purpose"}
                </Button>
                {setPurposeMutation.error instanceof Error ? (
                  <p className="text-sm text-destructive">
                    {setPurposeMutation.error.message}
                  </p>
                ) : null}
              </form>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CreateWorkflowDialog
        channels={[channel]}
        onOpenChange={setIsCreateWorkflowOpen}
        open={isCreateWorkflowOpen}
      />
    </Dialog>
  );
}
