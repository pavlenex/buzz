// GENERATED FILE — DO NOT EDIT.
//
// Generated from crates/buzz-core/src/kind.rs (the authoritative Buzz kind
// registry) by desktop/scripts/generate-kinds.mjs. To change a kind number or
// add a kind, edit kind.rs and re-run:
//
//   node scripts/generate-kinds.mjs
//
// CI runs `node scripts/generate-kinds.mjs --check` (via `pnpm check`) and
// fails on any drift between this file and kind.rs, including manual edits
// to this file.

/** NIP-01: User profile metadata. */
export const KIND_PROFILE = 0;
/** NIP-01: Short text note. */
export const KIND_TEXT_NOTE = 1;
/** NIP-02: Contact list / follow list. */
export const KIND_CONTACT_LIST = 3;
/** NIP-51: Mute list (replaceable, 10000–19999 range) — pubkeys/events/threads/words a user has muted. */
export const KIND_MUTE_LIST = 10000;
/** NIP-51: Pin list (replaceable) — events the user has pinned to their profile. */
export const KIND_PIN_LIST = 10001;
/** NIP-65: Relay list metadata (replaceable) — read/write relay preferences for the outbox model. */
export const KIND_NIP65_RELAY_LIST_METADATA = 10002;
/** NIP-51: Bookmark list (replaceable) — events/articles/hashtags/URLs the user has bookmarked. */
export const KIND_BOOKMARK_LIST = 10003;
/** NIP-51: Emoji list (replaceable) — user preferred emojis and pointers to emoji sets. */
export const KIND_EMOJI_LIST = 10030;
/** NIP-51: Follow set (parameterized replaceable, 30000–39999 range) — named curated lists of pubkeys. */
export const KIND_FOLLOW_SET = 30000;
/** NIP-51: Bookmark set (parameterized replaceable) — named curated bookmark collections. */
export const KIND_BOOKMARK_SET = 30003;
/** NIP-51 / NIP-30: Emoji set (parameterized replaceable). */
export const KIND_EMOJI_SET = 30030;
/** NIP-01: Channel metadata (replaceable). Not used by Buzz today. */
export const KIND_CHANNEL_METADATA = 41;
/** NIP-09: Event deletion request. */
export const KIND_DELETION = 5;
/** NIP-25: Content is emoji char or `+`/`-`. */
export const KIND_REACTION = 7;
/** NIP-17: Outer envelope for private DMs — hides sender, content, timestamp. */
export const KIND_GIFT_WRAP = 1059;
/** NIP-94: File metadata attachment. */
export const KIND_FILE_METADATA = 1063;
/** NIP-23: Long-form content (articles, blog posts, RFCs). */
export const KIND_LONG_FORM = 30023;
/** NIP-38: User status (general, music, or custom d-tag). */
export const KIND_USER_STATUS = 30315;
/** NIP-78 / NIP-RS: Per-client read state blob for cross-device read position sync. */
export const KIND_READ_STATE = 30078;
/** NIP-42 auth event — never stored (carries bearer tokens). */
export const KIND_AUTH = 22242;
/** BUD-01: Blossom upload auth (used in upload.rs, not stored). */
export const KIND_BLOSSOM_AUTH = 24242;
/** NIP-98: HTTP auth event (used in nip98.rs, not stored). */
export const KIND_HTTP_AUTH = 27235;
/** Agent metadata + owner reference (replaceable, agent-authored). */
export const KIND_AGENT_PROFILE = 10100;
/** NIP-AE: Agent Engram (parameterized replaceable, agent-authored). */
export const KIND_AGENT_ENGRAM = 30174;
/** NIP-ER: Event Reminder (parameterized replaceable, author-only). */
export const KIND_EVENT_REMINDER = 30300;
/** NIP-AP: Agent Persona (parameterized replaceable, owner-authored). */
export const KIND_PERSONA = 30175;
/** NIP-AP: Agent Team (parameterized replaceable, owner-authored). */
export const KIND_TEAM = 30176;
/** NIP-AP: Managed Agent (parameterized replaceable, owner-authored). */
export const KIND_MANAGED_AGENT = 30177;
/** NIP-29: Add a user to a group. */
export const KIND_NIP29_PUT_USER = 9000;
/** NIP-29: Remove a user from a group. */
export const KIND_NIP29_REMOVE_USER = 9001;
/** NIP-29: Edit group metadata. */
export const KIND_NIP29_EDIT_METADATA = 9002;
/** NIP-29: Delete an event from a group. */
export const KIND_NIP29_DELETE_EVENT = 9005;
/** NIP-29: Create a new group. */
export const KIND_NIP29_CREATE_GROUP = 9007;
/** NIP-29: Delete a group. */
export const KIND_NIP29_DELETE_GROUP = 9008;
/** NIP-29: Create an invite to a group. */
export const KIND_NIP29_CREATE_INVITE = 9009;
/** NIP-29: Request to join a group. */
export const KIND_NIP29_JOIN_REQUEST = 9021;
/** NIP-29: Request to leave a group. */
export const KIND_NIP29_LEAVE_REQUEST = 9022;
/** NIP-43: Relay membership list snapshot (relay-signed, replaceable by convention). */
export const KIND_NIP43_MEMBERSHIP_LIST = 13534;
/** NIP-43: Member added announcement (relay-signed). */
export const KIND_NIP43_MEMBER_ADDED = 8000;
/** NIP-43: Member removed announcement (relay-signed). */
export const KIND_NIP43_MEMBER_REMOVED = 8001;
/** NIP-43: User leave request (user-signed, ephemeral). */
export const KIND_NIP43_LEAVE_REQUEST = 28936;
/** NIP-IA: Request that the relay archive a target identity. */
export const KIND_IA_ARCHIVE_REQUEST = 9035;
/** NIP-IA: Request that the relay unarchive a target identity. */
export const KIND_IA_UNARCHIVE_REQUEST = 9036;
/** NIP-IA: Archived-identity delta (relay-signed). */
export const KIND_IA_ARCHIVED = 8002;
/** NIP-IA: Unarchived-identity delta (relay-signed). */
export const KIND_IA_UNARCHIVED = 8003;
/** NIP-IA: Archived identities list snapshot (relay-signed, replaceable). */
export const KIND_IA_ARCHIVED_LIST = 13535;
/** NIP-29: Addressable group metadata state. */
export const KIND_NIP29_GROUP_METADATA = 39000;
/** NIP-29: Addressable group admins list. */
export const KIND_NIP29_GROUP_ADMINS = 39001;
/** NIP-29: Addressable group members list. */
export const KIND_NIP29_GROUP_MEMBERS = 39002;
/** NIP-29: Addressable group roles definition. */
export const KIND_NIP29_GROUP_ROLES = 39003;
/** Thread summary overlay: `e`/`d` tag = root event id, content = */
export const KIND_THREAD_SUMMARY = 39005;
/** Window bounds overlay: `d` tag = `<channel_id>:<request-cursor-or-head>`, */
export const KIND_WINDOW_BOUNDS = 39006;
/** Workflow definition (parameterized replaceable, d=workflow_uuid). */
export const KIND_WORKFLOW_DEF = 30620;
/** Mesh-LLM relay status (relay-signed, parameterized replaceable, d=buzz-relay-mesh). */
export const KIND_MESH_LLM_RELAY_STATUS = 30621;
/** NIP-DV: per-viewer DM visibility snapshot (relay-signed, parameterized */
export const KIND_DM_VISIBILITY = 30622;
/** Ephemeral: user presence update (online/away/offline). */
export const KIND_PRESENCE_UPDATE = 20001;
/** NIP-AB: Device pairing event. Ephemeral — relay may discard after delivery. */
export const KIND_PAIRING = 24134;
/** Ephemeral: typing indicator for a channel. */
export const KIND_TYPING_INDICATOR = 20002;
/** Ephemeral: owner-scoped encrypted agent observer telemetry and control frame. */
export const KIND_AGENT_OBSERVER_FRAME = 24200;
/** Ephemeral: huddle emoji reaction burst. Channel-scoped to the ephemeral */
export const KIND_HUDDLE_REACTION = 24810;
/** Ephemeral: mesh status report (desktop → relay). A relay member reports its */
export const KIND_MESH_STATUS_REPORT = 24620;
/** Ephemeral: mesh connect request (desktop → relay). A relay member asks the */
export const KIND_MESH_CONNECT_REQUEST = 24621;
/** Ephemeral: mesh call-me-now signal (relay → desktop, relay-signed). The live */
export const KIND_MESH_CALL_ME_NOW = 24622;
/** NIP-29 group chat message kind. V1 used kind:10001 (replaceable range — wrong), then 40001. */
export const KIND_STREAM_MESSAGE = 9;
/** V1 used kind:10002 (replaceable range — wrong). */
export const KIND_STREAM_MESSAGE_V2 = 40002;
/** V1 used kind:10004 (replaceable range + NIP-51 collision — wrong). */
export const KIND_STREAM_MESSAGE_EDIT = 40003;
/** A stream message that has been pinned in a channel. */
export const KIND_STREAM_MESSAGE_PINNED = 40004;
/** A stream message that has been bookmarked by a user. */
export const KIND_STREAM_MESSAGE_BOOKMARKED = 40005;
/** A stream message scheduled for future delivery. */
export const KIND_STREAM_MESSAGE_SCHEDULED = 40006;
/** A reminder attached to a stream message or time. */
export const KIND_STREAM_REMINDER = 40007;
/** A diff/patch message showing file changes (unified diff format). */
export const KIND_STREAM_MESSAGE_DIFF = 40008;
/** Canvas (shared document) for a channel. */
export const KIND_CANVAS = 40100;
/** System message for channel state changes (join, leave, rename, etc.). */
export const KIND_SYSTEM_MESSAGE = 40099;
/** Channel metadata with computed fields (relay-signed sidecar). */
export const KIND_CHANNEL_SUMMARY = 40901;
/** Bulk presence state (relay-signed sidecar). */
export const KIND_PRESENCE_SNAPSHOT = 40902;
/** Open/create DM (p-tags = participants). */
export const KIND_DM_OPEN = 41010;
/** Add member to group DM. */
export const KIND_DM_ADD_MEMBER = 41011;
/** Hide DM from sidebar. */
export const KIND_DM_HIDE = 41012;
/** A new direct-message conversation was created. */
export const KIND_DM_CREATED = 41001;
/** An agent job was requested. */
export const KIND_JOB_REQUEST = 43001;
/** An agent accepted a job request. */
export const KIND_JOB_ACCEPTED = 43002;
/** Progress update for an in-flight agent job. */
export const KIND_JOB_PROGRESS = 43003;
/** Final result of a completed agent job. */
export const KIND_JOB_RESULT = 43004;
/** A job cancellation was requested. */
export const KIND_JOB_CANCEL = 43005;
/** An agent job failed with an error. */
export const KIND_JOB_ERROR = 43006;
/** Relay-signed notification: the target pubkey was added to a channel. */
export const KIND_MEMBER_ADDED_NOTIFICATION = 44100;
/** Relay-signed notification: the target pubkey was removed from a channel. */
export const KIND_MEMBER_REMOVED_NOTIFICATION = 44101;
/** NIP-AM: Agent Turn Metric — durable per-turn token-usage record (agent-authored). */
export const KIND_AGENT_TURN_METRIC = 44200;
/** A forum post (thread root). */
export const KIND_FORUM_POST = 45001;
/** A vote on a forum post. */
export const KIND_FORUM_VOTE = 45002;
/** A comment reply on a forum post. */
export const KIND_FORUM_COMMENT = 45003;
/** Trigger workflow execution. */
export const KIND_WORKFLOW_TRIGGER = 46020;
/** Grant pending approval. */
export const KIND_APPROVAL_GRANT = 46030;
/** Deny pending approval. */
export const KIND_APPROVAL_DENY = 46031;
/** A workflow was triggered by a matching event. */
export const KIND_WORKFLOW_TRIGGERED = 46001;
/** A workflow step began execution. */
export const KIND_WORKFLOW_STEP_STARTED = 46002;
/** A workflow step completed successfully. */
export const KIND_WORKFLOW_STEP_COMPLETED = 46003;
/** A workflow step failed. */
export const KIND_WORKFLOW_STEP_FAILED = 46004;
/** The entire workflow completed successfully. */
export const KIND_WORKFLOW_COMPLETED = 46005;
/** The entire workflow failed. */
export const KIND_WORKFLOW_FAILED = 46006;
/** The workflow was cancelled before completion. */
export const KIND_WORKFLOW_CANCELLED = 46007;
/** A workflow step is waiting for human approval. */
export const KIND_WORKFLOW_APPROVAL_REQUESTED = 46010;
/** A pending workflow approval was granted. */
export const KIND_WORKFLOW_APPROVAL_GRANTED = 46011;
/** A pending workflow approval was denied. */
export const KIND_WORKFLOW_APPROVAL_DENIED = 46012;
/** An audit log entry was recorded. */
export const KIND_AUDIT_ENTRY = 48001;
/** A huddle (audio/video session) was started. */
export const KIND_HUDDLE_STARTED = 48100;
/** A participant joined a huddle. */
export const KIND_HUDDLE_PARTICIPANT_JOINED = 48101;
/** A participant left a huddle. */
export const KIND_HUDDLE_PARTICIPANT_LEFT = 48102;
/** A huddle ended. */
export const KIND_HUDDLE_ENDED = 48103;
/** Huddle channel guidelines/rules document. */
export const KIND_HUDDLE_GUIDELINES = 48106;
/** Internal kind for media upload audit entries. Not a relay event kind. */
export const KIND_MEDIA_UPLOAD = 49001;
/** NIP-34: Repository announcement (parameterized replaceable, d-tag = repo-id). */
export const KIND_GIT_REPO_ANNOUNCEMENT = 30617;
/** NIP-34: Repository state — current branch/tag refs (parameterized replaceable, d-tag = repo-id). */
export const KIND_GIT_REPO_STATE = 30618;
/** NIP-34: Patch (git format-patch output). */
export const KIND_GIT_PATCH = 1617;
/** NIP-34: Pull request. */
export const KIND_GIT_PULL_REQUEST = 1618;
/** NIP-34: Pull request update (tip commit change). */
export const KIND_GIT_PR_UPDATE = 1619;
/** NIP-34: Issue. */
export const KIND_GIT_ISSUE = 1621;
/** NIP-34: Status — Open. */
export const KIND_GIT_STATUS_OPEN = 1630;
/** NIP-34: Status — Applied / Merged. */
export const KIND_GIT_STATUS_MERGED = 1631;
/** NIP-34: Status — Closed. */
export const KIND_GIT_STATUS_CLOSED = 1632;
/** NIP-34: Status — Draft. */
export const KIND_GIT_STATUS_DRAFT = 1633;
