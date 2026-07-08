// Kind constants are generated from crates/buzz-core/src/kind.rs (the
// authoritative Buzz kind registry) into kinds.generated.ts — run
// `node scripts/generate-kinds.mjs` after editing kind.rs. This module
// re-exports the full registry, keeps legacy desktop-local alias names, and
// defines the desktop-specific derived kind sets below.
export * from "./kinds.generated.ts";

// Legacy desktop-local names for constants whose canonical (buzz-core) name
// differs. Aliased to the generated registry so values cannot drift; new code
// should prefer the canonical names.
//
// The KIND_CHANNEL_* aliases are all NIP-78 application-specific data
// (kind 30078); the relay differentiates them by d-tag ("read-state:<slotId>",
// "channel-sections", "channel-mutes", "channel-stars", "channel-sort").
export {
  KIND_WORKFLOW_APPROVAL_REQUESTED as KIND_APPROVAL_REQUEST,
  KIND_READ_STATE as KIND_CHANNEL_MUTES,
  KIND_READ_STATE as KIND_CHANNEL_SECTIONS,
  KIND_READ_STATE as KIND_CHANNEL_SORT,
  KIND_READ_STATE as KIND_CHANNEL_STARS,
  KIND_THREAD_SUMMARY as KIND_CHANNEL_THREAD_SUMMARY,
  KIND_WINDOW_BOUNDS as KIND_CHANNEL_WINDOW_BOUNDS,
  KIND_STREAM_REMINDER as KIND_REMINDER,
  KIND_GIT_REPO_ANNOUNCEMENT as KIND_REPO_ANNOUNCEMENT,
  KIND_GIT_REPO_STATE as KIND_REPO_STATE,
} from "./kinds.generated.ts";

import {
  KIND_DELETION,
  KIND_FORUM_COMMENT,
  KIND_FORUM_POST,
  KIND_HUDDLE_ENDED,
  KIND_HUDDLE_PARTICIPANT_JOINED,
  KIND_HUDDLE_PARTICIPANT_LEFT,
  KIND_HUDDLE_STARTED,
  KIND_JOB_ACCEPTED,
  KIND_JOB_CANCEL,
  KIND_JOB_ERROR,
  KIND_JOB_PROGRESS,
  KIND_JOB_REQUEST,
  KIND_JOB_RESULT,
  KIND_NIP29_DELETE_EVENT,
  KIND_REACTION,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_DIFF,
  KIND_STREAM_MESSAGE_EDIT,
  KIND_STREAM_MESSAGE_V2,
  KIND_SYSTEM_MESSAGE,
} from "./kinds.generated.ts";

// Human-visible "new content" message kinds. Used as the unread trigger set
// (sidebar badges, catch-up queries) and as the Home-feed mention query.
// Reactions, edits, diffs, deletions, and system messages are deliberately
// excluded: they can land after the last human-visible message and would
// otherwise create phantom unreads.
export const CHANNEL_MESSAGE_EVENT_KINDS = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_FORUM_POST,
  KIND_FORUM_COMMENT,
] as const;

// Keep this in sync with the Home-feed mention query in buzz-db.
export const HOME_MENTION_EVENT_KINDS = [...CHANNEL_MESSAGE_EVENT_KINDS];

export const CHANNEL_EVENT_KINDS = [
  KIND_DELETION, // 5 — NIP-09 event deletions
  KIND_REACTION, // 7 — NIP-25 reactions
  KIND_NIP29_DELETE_EVENT, // 9005 — NIP-29 / Buzz-native deletions
  ...CHANNEL_MESSAGE_EVENT_KINDS,
  40001, // legacy: pre-migration stream messages
  KIND_STREAM_MESSAGE_EDIT, // 40003 — message edits
  KIND_STREAM_MESSAGE_DIFF, // 40008 — message diffs
  KIND_SYSTEM_MESSAGE, // 40099 — system messages (join, leave, etc.)
  KIND_HUDDLE_STARTED, // 48100 — visible huddle session card
  KIND_HUDDLE_PARTICIPANT_JOINED, // 48101 — huddle lifecycle overlay
  KIND_HUDDLE_PARTICIPANT_LEFT, // 48102 — huddle lifecycle overlay
  KIND_HUDDLE_ENDED, // 48103 — huddle lifecycle overlay
] as const;

// Auxiliary (non-row) timeline kinds: events that overlay onto or hide an
// existing message rather than rendering their own row — reactions, edits, and
// deletions. History fetches request the visible content kinds only, so the
// `limit` budget buys visible message depth instead of being diluted by these
// (on a reaction-heavy channel a 200-event window was only ~136 messages).
// They are backfilled separately by `#e` reference over the loaded message ids
// — by reference, not by time window, so a late edit/delete for a visible old
// message still applies. NOTE: kind:40008 (diff) renders its OWN row, so it is
// a content kind, not aux.
export const CHANNEL_AUX_EVENT_KINDS = [
  KIND_DELETION, // 5 — NIP-09 event deletions
  KIND_REACTION, // 7 — NIP-25 reactions
  KIND_NIP29_DELETE_EVENT, // 9005 — NIP-29 / Buzz-native deletions
  KIND_STREAM_MESSAGE_EDIT, // 40003 — message edits
] as const;

// Visible content kinds the main timeline renders as their own rows. Mirrors
// `isTimelineContentEvent` in formatTimelineMessages.ts — keep the two in sync.
// This is the kind set the history fetch requests so the `limit` budget maps
// to visible rows; auxiliary overlays (CHANNEL_AUX_EVENT_KINDS) are fetched
// separately by `#e` reference. Forum kinds (45001/45003) are excluded: forum
// channels use a different query path, not this timeline.
export const CHANNEL_TIMELINE_CONTENT_KINDS = [
  KIND_STREAM_MESSAGE, // 9
  KIND_STREAM_MESSAGE_V2, // 40002
  KIND_STREAM_MESSAGE_DIFF, // 40008 — diff messages (own row)
  KIND_SYSTEM_MESSAGE, // 40099 — system rows (join/leave/channel-created)
  KIND_JOB_REQUEST, // 43001
  KIND_JOB_ACCEPTED, // 43002
  KIND_JOB_PROGRESS, // 43003
  KIND_JOB_RESULT, // 43004
  KIND_JOB_CANCEL, // 43005
  KIND_JOB_ERROR, // 43006
  KIND_HUDDLE_STARTED, // 48100 — huddle session card
] as const;

// Timeline kinds that are NOT conversational: relay-signed system rows
// (channel-created, member-joined) and job-lifecycle events. These render in
// the timeline but must not count toward the channel's unread pill — a freshly
// created channel carries one channel_created + N member_joined system rows
// that would otherwise show as phantom unreads ("4 unread, 1 message").
const NON_CONVERSATIONAL_UNREAD_KINDS: ReadonlySet<number> = new Set([
  KIND_SYSTEM_MESSAGE, // 40099
  KIND_JOB_REQUEST, // 43001
  KIND_JOB_ACCEPTED, // 43002
  KIND_JOB_PROGRESS, // 43003
  KIND_JOB_RESULT, // 43004
  KIND_JOB_CANCEL, // 43005
  KIND_JOB_ERROR, // 43006
  KIND_HUDDLE_STARTED, // 48100 — huddle cards are visible but non-conversational
  KIND_HUDDLE_PARTICIPANT_JOINED, // 48101
  KIND_HUDDLE_PARTICIPANT_LEFT, // 48102
  KIND_HUDDLE_ENDED, // 48103
]);

// Whether a timeline message kind should count toward unread tallies. An
// undefined kind (optimistic/pending rows whose kind has not populated) is
// treated as conversational so a legitimately unread message is never dropped.
export function isConversationalUnreadKind(kind: number | undefined): boolean {
  return kind === undefined || !NON_CONVERSATIONAL_UNREAD_KINDS.has(kind);
}
