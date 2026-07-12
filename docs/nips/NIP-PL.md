---
title: "NIP-PL — Push Leases (full normative draft)"
tags: [nostr, nip, push-notifications, buzz, draft]
status: draft
created: 2026-07-02
---

NIP-PL
======

Push Leases
-----------

`draft` `optional` `relay`

**Depends on**: NIP-01, NIP-11, NIP-40 (expiration), NIP-42 (authentication), NIP-44 (encryption). Interacts with NIP-46 (remote signers) and NIP-59 (gift wrap, never decrypted by executors).

## Abstract

This NIP defines the **push lease**: a stored, installation-scoped, expiring authorization asking a **push executor** (usually the user's relay) to keep a constrained Nostr filter active after the client's socket closes, and to *wake* a specific application installation through a platform push transport (APNs, FCM, optionally UnifiedPush) when the filter matches.

The push payload is a **wake hint** — privacy-safe generic fallback text plus an optional encrypted grant — never event ids or event content. On wake, the client reconnects and fetches authoritative events over normal `REQ`. Push delivery is lossy and best-effort — duplicates and omissions are both possible; the relay remains the single source of truth. Platform transports are execution profiles for the lease, not the protocol's content plane.

A lease is a `kind:30350` addressable event: `d` is a random per-origin installation id, `expiration` is public and mandatory, and everything else — transport endpoint, subscriptions, priority classes — is NIP-44-encrypted to the executor's advertised key.

## Motivation

Nostr is pull-based. Mobile operating systems terminate background sockets within seconds, so reliable notification requires a server-side component that watches on the client's behalf and wakes it through the platform's push channel.

Prior art models the *transport artifact* as the protocol object: notepush registers raw APNs device tokens against a bespoke HTTP API; the NIP-9a draft (kind:30390) registers an arbitrary HTTP callback URL that receives full event JSON. Both put platform plumbing at the center and push semantics at the edge. This NIP inverts that: the protocol object is the *authorization* — a signed, expiring, revocable filter, the thing Nostr already has language for. Which vendor executes the wake is a profile detail.

The design goals, in order: (1) the push path must not become a shadow feed — no event content transits Apple or Google; (2) notification must be structurally non-amplifying — a lease that can only match a narrow, authenticated slice of the stream cannot be weaponized into a firehose; (3) installations are sovereign — independently created, replaced, and revoked, with no cross-device coupling; (4) multi-tenant executors preserve community isolation on the push path exactly as relays do on the read path.

## Non-Goals

This NIP does not define durable message delivery, delivery receipts, or acknowledgement semantics. Duplicate wakes are valid and harmless; clients deduplicate fetched events by id.

This NIP does not define notification *content*. Rich previews are an opportunistic client-side enrichment (see Wake Grants); the protocol's correctness floor is a generic wake.

This NIP does not define read state (see NIP-RS), reminders (see NIP-ER), or notification preferences as service-side flags — preferences are expressed as subscriptions and classes inside the lease.

Executors never decrypt the NIP-44 or NIP-59 payloads of the events they match. (The executor necessarily decrypts *lease* content, which is encrypted to it.)

## Terminology

This document uses MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, and RECOMMENDED as defined in RFC 2119.

- **installation**: one install of one application on one device. Each `(installation, origin)` pair is identified by a lease `d` value.
- **push lease (lease)**: the `kind:30350` addressable event authorizing wakes for one installation.
- **executor**: the logical component that stores leases, matches events, and sends platform pushes. It is trusted by and operates for the origin, holds the descriptor's private decryption keys, and shares the origin's read-authorization state. It is usually the user's relay; it MAY be deployed as a separate process holding the app's transport credentials, but that separation is deployment topology, not a protocol boundary — **this NIP defines no protocol by which an untrusted third party can act as an executor.**
- **origin**: the canonical origin identifier the descriptor advertises for a relay/community; the tenant key (see Acceptance and Origin Binding).
- **wake hint**: the push payload — the versioned wake object defined in Wake Delivery: generic fallback text and an optional encrypted wake grant.
- **wake grant**: an optional relay-minted, least-authority credential allowing a notification handler to fetch the matched events for one wake without a full authenticated session.
- **subscription**: one `{filter, class, ignore?, suppress?}` entry inside a lease.
- **priority class**: one of `silent`, `default`, `time_sensitive`, `urgent`.
- **transport profile**: the APNs/FCM/UnifiedPush-specific execution rules for a lease.

## The Lease Event

`kind:30350` is an addressable event keyed by `(pubkey, 30350, d)` per NIP-01.

```jsonc
{
  "kind": 30350,
  "pubkey": "<installation owner>",
  "created_at": 1769990000,
  "tags": [
    ["d", "<random-installation-id>"],
    ["expiration", "<unix-seconds>"],
    ["exec", "<executor-key-id>"],
    ["alt", "Push lease"]
  ],
  "content": "<nip44-ciphertext to the executor's advertised pubkey>"
}
```

- `d` MUST be generated from at least 128 bits of randomness by the installation, and MUST be distinct per origin — cross-origin unlinkability is a guarantee of this NIP, not a nicety. It MUST NOT contain or be derived from a hardware identifier, advertising identifier, APNs token, FCM registration token, UnifiedPush endpoint, or other transport identifier. Reinstalling the application MUST create a new `d`; transport-token rotation within the same installation MUST retain `d` and replace the existing lease.
- `expiration` (NIP-40) is REQUIRED and MUST satisfy `now − allowed_skew < expiration ≤ now + max_lease_ttl` at acceptance (`invalid: lease ttl too long` / `invalid: lease already expired`; `max_lease_ttl` descriptor-advertised, default 30 days; RECOMMENDED `allowed_skew` 15 minutes). The executor MUST stop matching once it passes. Inactive (tombstone) replacements carry a public `expiration` under the same bound; it dates the tombstone, not any matching. Expiry is the self-healing backstop for every abuse and leak below.
- `exec` names the descriptor encryption key the content was produced for (see Executor Discovery).
- Public tags are exactly one `d`, one `expiration`, one `exec`, and at most one `alt`, each with exactly one value; duplicated tags, extra tags, or extra tag values MUST be rejected. The executor MUST reject a lease carrying filter, kind, author, endpoint, or platform data in public tags.

### Content

`.content` MUST be NIP-44 ciphertext to the executor's advertised encryption pubkey. Plaintext:

```jsonc
{
  "v": 1,
  "origin": "<origin id, byte-for-byte from the descriptor>", // tenant binding, verified — never routed on
  "app_profile": "com.example.app/ios",      // selects transport credentials
  "transport": "apns",                       // "apns" | "fcm" | "unifiedpush"
  "endpoint": "<opaque transport endpoint>", // APNs token / FCM token / UP URL
  "generation": 3,                           // strictly increasing per lease address
  "active": true,                            // false = revocation tombstone
  "wake_key": "<installation pubkey>",       // OPTIONAL; enables held wake grants
  "subscriptions": [
    { "filter": { "kinds": [9], "#p": ["<self>"] }, "class": "time_sensitive" },
    { "filter": { "kinds": [9], "#h": ["<channel-uuid>"] }, "class": "default",
      "ignore": [ { "kinds": [9], "authors": ["<noisy-bot>"], "#h": ["<channel-uuid>"] } ],
      "suppress": { "p_tags_max": 20 } }
  ]
}
```

The plaintext MUST be a single JSON object. Parsers MUST reject duplicate object keys anywhere in the plaintext, and executors MUST reject a plaintext containing members not defined for its `v` (`invalid: unknown field`) — schema evolution happens by version bump, not by silent extension. Size bounds are advertised in the descriptor and enforced before parsing: `.content` ciphertext ≤ `max_content_len` bytes, decrypted plaintext ≤ `max_plaintext_len` bytes, `d` ≤ 64 bytes, `endpoint` ≤ `max_endpoint_len` bytes, every string value ≤ `max_string_len` bytes.

**Schema (v=1).** For an active lease, required members are exactly `v`, `origin`, `app_profile`, `transport`, `endpoint`, `generation`, `active`, `subscriptions`; `wake_key` is the only optional member. Types: `v` is a non-negative integer ≤ 2^53−1 and `generation` is a positive integer ≤ 2^53−1; `active` is a JSON boolean; `origin`, `app_profile`, `transport`, `endpoint`, `wake_key` are strings; `subscriptions` is a non-empty array of subscription objects, each with required `filter` (object) and `class` (string from the class registry) and optional `ignore` (array of filter objects) and `suppress` (object with the single member `p_tags_max`, a positive integer). All timestamps anywhere in this NIP are integer Unix seconds; all descriptor limits are positive integers.

Validation is fail-closed: if any rule in this document fails, the executor MUST reject the entire lease with `invalid: <reason>` without disturbing a previously accepted lease at the same address.

### Acceptance and Origin Binding

`origin` is the tenant key, so no client-supplied value may ever *select* a tenant — it may only *confirm* one. The descriptor (see Executor Discovery) advertises a single canonical `origin` string for the relay/community it describes. The receiving server resolves the tenant from the authenticated connection the event arrived on (which relay/community endpoint, which community context), never from the lease. The lease's encrypted `origin` MUST then compare byte-for-byte equal to that server-resolved tenant's canonical origin; mismatch is rejected (`invalid: origin mismatch`). No normalization algorithm is defined or needed: clients copy the descriptor value verbatim. Executors MUST NOT route, partition, or match based on a client-supplied origin that has not passed this check.

A `kind:30350` event MUST be accepted only when all of the following hold, evaluated in order; the first failure determines the `OK` message:

1. The connection is NIP-42 authenticated and the authenticated pubkey equals the event `pubkey` (`auth-required:` / `restricted: pubkey does not match authenticated user`).
2. The event signature and id verify per NIP-01 (`invalid: bad signature`).
3. Public tags are exactly `{d, expiration, exec, alt?}` and pass the tag rules above (`invalid: <tag reason>`).
4. `exec` names a key the descriptor currently accepts, and `.content` decrypts under NIP-44 with that key (`invalid: unknown executor key` / `invalid: undecryptable content`).
5. The plaintext passes the size, duplicate-key, unknown-field, and schema checks above (`invalid: <schema reason>`).
6. `origin` passes the byte-equality binding check (`invalid: origin mismatch`).
7. If `active` is `true`: `app_profile` is advertised in the descriptor and `transport` equals the advertised transport of that selected `app_profile` entry (`invalid: transport mismatch`), every subscription passes the filter grammar, every `class` is advertised as supported for the lease's transport (`invalid: class not supported`), and quotas hold — including endpoint uniqueness (see Lifecycle), which is evaluated and enforced inside the same atomic acceptance transaction as step 8's commit, so two racing leases cannot both claim an endpoint. If `active` is `false`: the minimal inactive schema applies instead (see Lifecycle) and endpoint/app-profile availability MUST NOT be re-checked — revocation must never be blocked by a withdrawn profile.
8. If a lease was previously accepted at this `(pubkey, 30350, d)` address, the incoming event MUST win on **both** orderings: (a) it wins exact NIP-01 addressable-event ordering against the currently stored winner (greater `created_at`; tie broken by lexically lowest event id), and (b) its `generation` is strictly greater than the internal generation watermark for the address. Failing either check rejects the event (`invalid: stale replacement` / `invalid: stale generation`) and MUST leave the stored event, effective push state, and watermark all unchanged — so a malicious high-generation, old-`created_at` event cannot poison the watermark.

On acceptance the executor returns `OK true` and commits the stored event, the effective push state, and the generation watermark in one atomic transaction; after a crash or restart, effective state MUST be reconstructible from (or restored consistently with) that transactionally persisted state — a rebuilt view MUST never disagree with what `REQ` serves.

`REQ` and `COUNT` for `kind:30350` MUST be answered only on a NIP-42-authenticated connection and MUST return only events whose author equals the authenticated pubkey; to all other queriers the kind behaves as if no such events exist (no existence, count, tag, or content leakage). NIP-42 authentication is a precondition of this ACL, not a substitute for it.

### Filter Constraints

Each subscription `filter` is a NIP-01 filter object under these restrictions — a *restriction* of NIP-01, so the executor's existing matcher runs unchanged and all grammar work is sunk at write time:

1. **Narrowing selector.** Each filter MUST contain at least one of: `#p` (self only), `#h` (1–`max_h` channels), or `authors` (1–`max_authors` pubkeys). Bare kinds-only, since-only, or empty filters MUST be rejected (`invalid: lease filter not narrowed`).
2. **Exact values only.** Every `authors` and `#p` value MUST be exactly 64 lowercase hex characters (a full pubkey), and every `#e` value exactly 64 lowercase hex characters (a full event id); anything shorter, longer, or mixed-case is rejected (`invalid: non-exact match value`). This forecloses NIP-01 prefix matching from inside a lease. Each `#h` value MUST be a non-empty string of at most `max_string_len` bytes and MUST additionally satisfy the channel-identifier grammar the descriptor names in `h_grammar` (e.g. `"uuid-v4-lowercase"` for Buzz); an executor MUST reject values failing its advertised grammar.
3. **Self-scoped `#p`.** Every `#p` value MUST equal the lease author (`invalid: p-tag must be self`). A lease MUST NOT register a wake on another user's mentions — that is a surveillance primitive, and it would signal the existence of events the author may not read.
4. **Bounded, allow-listed kinds.** Each filter MUST include `kinds` (1–`max_kinds` entries), each drawn from the executor's advertised `push_kinds` (`invalid: kind not push-eligible`). Ephemeral kinds (20000–29999), presence, typing, and relay-signed snapshot kinds MUST NOT be push-eligible.
5. **No time-travel, no ids, no limit, no search.** `since`, `until`, `ids`, `limit`, and `search` MUST be rejected, not silently ignored. The lease's liveness window is its `expiration`; `ids` waking is nonsensical for future events.
6. **Tag hygiene.** Only `#p`, `#h`, `#e` selectors are permitted; `#p` and `#e` each have 1–`max_tag_values` values, while `#h` has 1–`max_h` values; empty tag arrays, unknown filter members, and multi-letter tags MUST be rejected. `#e` ("this thread") is permitted but is not a narrowing selector on its own.

### Suppression

A subscription MAY carry `ignore` (≤ `max_ignore` NIP-01 filters) and `suppress` (`p_tags_max` ≥ 1). Suppression evaluates after a positive match: if the matched event matches any `ignore` filter or carries more than `p_tags_max` `p` tags (the hellthread gate), the wake is dropped. `ignore` filters obey the grammar above *except* the narrowing-selector rule — they only subtract from an already-narrowed stream and cannot amplify. Suppression is safe to skip: a minimal executor MAY ignore it and remain correct, since extra wakes are harmless. Consequently a client MUST NOT infer from any observed behavior that suppression was enforced; it is best-effort noise reduction, not policy.

### Priority Classes

Each subscription carries exactly one `class`:

| Class | Meaning | APNs `interruption-level` | Android importance |
|---|---|---|---|
| `silent` | Sync-only wake, no alert | not user-visible; see APNs profile | `IMPORTANCE_MIN` |
| `default` | Standard notification | `active` | `IMPORTANCE_DEFAULT` |
| `time_sensitive` | Breaks through Focus/DND within OS policy | `time-sensitive` | `IMPORTANCE_HIGH` |
| `urgent` | Reserved: approval gates | `critical` if entitled, else `time-sensitive` | `IMPORTANCE_HIGH` + full-screen intent where policy allows |

Classes are strictly ordered: `silent` < `default` < `time_sensitive` < `urgent`. When one deduplicated wake covers matches from multiple subscriptions or leases targeting the same endpoint (see Coalescing), the wake's effective class is the highest eligible class among those matches. The descriptor's `class_support` is authoritative: a lease naming a class unsupported for its transport MUST be rejected at acceptance (`invalid: class not supported`), never silently downgraded.

The executor MUST restrict `urgent` to the descriptor-advertised allow-list of approval-request kinds whose eligibility is decidable from the public event envelope (`invalid: class not permitted for kind`). Urgent DMs are explicitly out of scope for v1: gift-wrapped DM content is opaque to the executor, so no privacy-safe urgency marker exists yet; a future revision may add one.

`silent` is exempt from the user-visible fallback requirement (there is nothing to display) and follows per-transport rules in Transport Profiles: it is a best-effort sync wake, never a guaranteed delivery channel.

Clients MUST NOT register any lease or subscription as a side effect of joining a channel or surface — absent explicit user opt-in the notifiable set is empty.

### Quotas

A lease address `(pubkey, 30350, d)` holds exactly one effective lease, and `d` MUST be distinct per `(installation, origin)` — a fresh random value per origin, so leases at different origins are unlinkable. Additionally, at most one active lease per `(author, origin, app_profile, transport, endpoint)` may exist: an executor MUST reject an active lease whose endpoint tuple duplicates another of the same author's active leases at a different address (`invalid: endpoint already leased`) — this keeps endpoint identity unambiguous for deduplication and class resolution. Quotas: per pubkey per origin, ≤ `max_leases_per_pubkey` active lease addresses; per lease, ≤ `max_subscriptions_per_lease` subscriptions. Because a lease is addressable, the normal client flow replaces rather than accumulates; quota rejection (`invalid: lease quota exceeded`) MUST NOT disturb existing valid leases.

## Executor Discovery

Until this draft has an upstream NIP number, executors MUST NOT advertise it in NIP-11 `supported_nips`; they advertise `"nip-pl"` in NIP-11 `supported_extensions` (NIP-ER precedent) together with a descriptor:

```jsonc
{
  "push": {
    "origin": "wss://relay.example",         // canonical origin id; copied verbatim into lease content
    "endpoint": "https://relay.example/push", // wake-grant redemption base URL (see Wake Grants)
    "keys": [ { "id": "2026-06", "pubkey": "<hex>", "current": true },
              { "id": "2026-01", "pubkey": "<hex>", "retiring": true } ],
    "app_profiles": [ { "id": "com.example.app/ios", "transport": "apns" },
                      { "id": "com.example.app/android", "transport": "fcm" } ],
    "push_kinds": [9, 1059, 40007, 46010, 7],
    "urgent_kinds": [46010],
    "h_grammar": "uuid-v4-lowercase",
    "class_support": { "apns": ["silent","default","time_sensitive","urgent"],
                       "fcm": ["silent","default","time_sensitive","urgent"] },
    "limitation": {
      "max_lease_ttl": 2592000,
      "max_leases_per_pubkey": 16,
      "max_subscriptions_per_lease": 16, "max_kinds": 16,
      "max_authors": 20, "max_h": 50, "max_tag_values": 20, "max_ignore": 8,
      "max_content_len": 65536, "max_plaintext_len": 32768,
      "max_endpoint_len": 4096, "max_string_len": 512,
      "max_grant_events": 20, "max_grant_response_len": 262144
    }
  }
}
```

A descriptor is valid only if: exactly one key is marked `current` and key ids are unique; app-profile ids are unique; `endpoint` is an `https://` URL; `urgent_kinds ⊆ push_kinds`; and every `class_support` value comes from the class registry in this NIP. Clients MUST treat a descriptor failing these checks as absence of push support.

The executor URL and credentials come from the descriptor, never from the lease. A lease cannot point the executor at an arbitrary HTTP endpoint; this removes the callback-amplification class of attack entirely. Executors MUST NOT dereference a client-supplied `endpoint` URL except as the selected transport profile explicitly defines (UnifiedPush is the only profile whose endpoint is a URL, and it is validated per that profile before use).

Leases MUST be author-only reads, as specified in Acceptance and Origin Binding, following the NIP-ER access pattern.

## Matching Semantics and Tenant Isolation

An executor MUST evaluate a lease only against events accepted by the relay origin named by that lease. A match does not grant access to an event: before enqueueing a wake, the relay MUST verify that the lease author is authorized to read the event at that origin at match time. Authorization established when the lease was created is insufficient, because membership and other read permissions may subsequently change. **A lease is a wake request, never a read grant.**

Filter matching MUST use only the accepted event envelope and relay-local authorization state. An executor MUST NOT decrypt NIP-44 content, NIP-59 seals or gift wraps, or any other encrypted event content to decide whether to wake an installation. For NIP-59 gift wraps, only outer-envelope fields, including the outer `p` tag, are eligible for matching.

The verified canonical origin is part of every lease and match key. An executor serving more than one origin MUST partition, at minimum, lease state, filter indexes, cursors, durable outbox jobs, endpoint lookup, foreground-suppression state, wake-grant state, quotas, and rate limits by origin. It MUST NOT match a lease against a global event, pubkey, or tag stream, and MUST NOT use authorization state from one origin to approve a wake or wake-grant redemption at another origin.

A wake job MUST preserve the origin and lease address selected at match time. Workers MUST re-check the lease's active state, expiration, endpoint generation, and current read authorization before delivery. A failed authorization check MUST suppress that wake without revealing whether the event existed. Implementations SHOULD make the accepted event and outbox insertion one durable transaction, or provide equivalent crash-safe processing, but delivery through a platform transport remains best-effort.

Separate origins may independently wake the same installation for the same event. Such duplicate wakes are valid; clients deduplicate authoritative events by event id after fetching them from their respective origins.

## Wake Delivery

**Wake object.** The wake payload is one versioned JSON object:

```jsonc
{ "v": 1,
  "fallback": "New activity",            // REQUIRED for user-visible classes; ABSENT for silent
  "grant": "<nip44-ciphertext, optional>" // encrypted wake grant, see Wake Grants
}
```

No other members are permitted. `fallback` is **version-independent**: it is reserved with these semantics across all wake object versions, so a client receiving a wake object whose `v` it does not support MUST ignore every other member but MAY still display `fallback` (when present and a string) as generic notification text — this matters on FCM, where a data message has no transport-native display and `fallback` is the only displayable text. An unknown-version wake without a usable `fallback` produces no display (equivalent to `silent`); on APNs the OS-rendered `aps.alert` remains the transport-native floor regardless. The payload deliberately contains **no lease reference, event ids, event content, pubkeys, channel identifiers, or counts** — nothing derived from the matched event or event set beyond its existence, and no stable correlator for the platform push service: the transport endpoint already identifies the installation, and on wake the client simply syncs its configured origins. `fallback` MUST be static or near-static text (e.g. "New activity"). Per-transport embedding is defined in Transport Profiles.

**Coalescing and rate.** For a matched event, the executor MUST create at most one durable wake job per `(origin, app_profile, transport, H(endpoint), event id)`, where `H` is SHA-256 (so raw endpoint tokens need not key internal tables or logs) — endpoint identity, not lease identity, keys the dedup, so multiple leases naming the same endpoint cannot multiply jobs (acceptance already rejects such duplicates; the dedup key makes the property hold even across races and legacy state). Each job records the lease address(es) and accepted generation(s) it was created under, and workers revalidate them before send; endpoint rotation MUST cancel or supersede pending jobs for the old endpoint without writing raw tokens to logs. The job's class is the highest eligible class across all active leases targeting that endpoint whose subscriptions matched, per Priority Classes. This bounds executor-side fan-out — it is not an end-to-end delivery guarantee: transport retries, platform behavior, and client races mean the installation may still observe duplicate or missing wakes, which is safe because reconnect-and-fetch is truth. Executors SHOULD additionally apply a per-installation wake rate cap (token-bucket style), coalescing excess matches into a single generic wake — dropping wakes is always safe.

**Foreground suppression.** An executor MAY accept a short-TTL, installation-scoped signal ("this installation has a live socket / handled this itself") to suppress wakes to that installation only. Suppression state MUST be per-installation: a live desktop socket MUST NOT suppress a phone's push. Account-wide online state MUST NOT be used.

### Wake Grants

Rich previews need the matched events, but the notification handler runs without a warm socket and often without signer access. The executor MAY therefore mint a **wake grant**: a relay-minted, least-authority credential included in the wake payload. Because the platform push service sees the payload, a grant is designed so possession alone is worth as little as possible. Grants are a SHOULD for executors and an enrichment for clients; the MUST floor is the generic wake. An executor that implements none of this section is conformant.

**Scope.** A grant authorizes exactly one thing: fetching events from the **exact, immutable set of event ids** selected at mint time under one lease and one origin — never a client-supplied filter, never a range or query that could grow. That set is an **upper bound**: redemption re-validates authorization per event, so responses may omit events whose visibility was lost after minting (and such omission is monotonic — an omitted event does not return). Retries are byte-identical only while authorization and event visibility are unchanged; they can never return more or different events.

**Keys — grants require `wake_key`, always.** An executor MUST NOT mint any grant for a lease without a `wake_key`; without it the wake is generic, full stop. There is no plaintext-token or "public content" exception: even for publicly readable events, a bearer token in the payload would let the platform push service redeem it and correlate a wake to exact event ids — the leak this design exists to remove — and "public" is a policy-mutable classification. `wake_key` is a secp256k1 public key (64 lowercase hex, x-only, as NIP-44 uses). It lives in platform-protected storage reachable by the notification handler (e.g. App Group/Keychain); it is not the user's Nostr key and needs no signer on the wake path.

**Grant token.** The token is 32 random bytes encoded as base64url without padding (43 characters). The executor MUST store only `SHA-256(token)` together with the grant record `{lease address, origin, event-id set, class, issued_at, expires_at, redemption_count}`. Tokens MUST NOT appear in logs or URLs. `expires_at − issued_at` MUST NOT exceed 10 minutes.

**Payload form.** The `grant` member of the wake object is NIP-44 ciphertext to the lease's `wake_key`, encrypted from exactly one sender key: **the descriptor key named by the accepted lease's public `exec` tag**. The encrypted `key_id` MUST be that exact identifier. If the executor no longer holds that key's private half (e.g. after rotation, before the client has replaced its lease), it MUST mint no grant and send the generic wake — it MUST NOT substitute a newer descriptor key. The plaintext is `{"token": "<token>", "url": "<redemption endpoint>", "origin": "<canonical origin>", "key_id": "<exec key id>"}`, where `url` is the redemption endpoint the descriptor advertised for that key at lease acceptance, which the executor MUST keep serving redemptions at through the same retention window as retiring keys. The platform push service holding the payload cannot decrypt or use it.

**Key discovery (client).** NIP-44 ciphertext does not name its sender, and the wake deliberately carries no origin or key hint. The client MUST therefore retain, per configured origin, the descriptor tuple `(origin, key_id, pubkey, redemption endpoint)` of the `exec` key accepted each time its lease was created or replaced (current and any retiring predecessors within the window), for at least the lease TTL plus the maximum grant TTL; executors MUST keep retiring public keys visible in the descriptor for that same window. On wake, the client attempts NIP-44 decryption of `grant` against exactly the pubkeys of that locally bounded candidate set. A decryption is valid only if the plaintext parses to the exact schema above with **no duplicate JSON keys** (a duplicated key MUST invalidate that candidate, whatever the parser would otherwise do) and its `origin`, `key_id`, and `url` match the candidate tuple's origin, key id, and retained redemption endpoint byte-for-byte — the retained endpoint, not the descriptor's current one, so endpoint rotation during the window cannot break or ambiguate validation. If zero or more than one candidate yields a valid plaintext, the client MUST ignore the grant and fall back to the generic wake — the grant is an enrichment; ambiguity never blocks display.

**Redemption.** HTTPS `POST` to the grant plaintext's validated `url` with header `Authorization: Bearer <token>` and `Content-Type: application/json`; the body is the empty JSON object `{}`. The executor rechecks, in order: the token hash is known, unexpired, and under its redemption cap; the lease is still active, unexpired, and at the same accepted generation; the lease author is still authorized to read each event in the set at that origin at redemption time. Success: `200` with `{"events": [<event JSON, ...>]}`, at most `max_grant_events` events and `max_grant_response_len` UTF-8 JSON body bytes (both descriptor-advertised; HTTP framing excluded). Every failure — unknown, expired, over-cap, or revoked — MUST return the identical status, headers, and body: `404 {"error": "invalid_grant"}`. Executors SHOULD avoid deliberately distinguishable processing across failure paths and SHOULD apply comparable rate limiting; wall-clock timing indistinguishability is not a conformance requirement.

**Idempotent bounded redemption, not single-use.** Notification-handler retries and races would burn a single-use token before content arrives. Instead: redemption of the same grant is idempotent up to the visibility revalidation above, until expiry, under a small request cap (RECOMMENDED ≤ 10). Replay by an interceptor without the `wake_key` yields nothing; replay with it reveals nothing broader than the first redemption, for at most the tiny expiry window.

**Invalidations.** Replacement, deactivation, expiry, or endpoint-generation disablement occurring before redemption MUST invalidate the affected grants. A notification already displayed by an operating system cannot be recalled and MUST NOT be treated as proof that its event remains readable.

**Authority.** Only the origin's executor — the component holding tenant read-authorization state — may mint or redeem grants. Grant data fetched through redemption is a non-authoritative preview; normal authenticated `REQ` remains the source of truth.

## Transport Profiles

Common invariant, all transports: **for user-visible classes, the displayed notification MUST NOT depend on fetch success.** Enrichment is opportunistic; generic fallback is the floor. `silent` is exempt (nothing is displayed) and is best-effort by construction.

### APNs

The wake object is carried as the custom payload member `"npl"` beside `aps`. User-visible classes send an alert push: `aps.alert.body` = `fallback`, `aps.mutable-content: 1`, `aps.interruption-level` per the class table, `apns-priority: 10`, `apns-expiration` ≤ the matched event's usefulness window (RECOMMENDED ≤ 1 hour), and no `apns-collapse-id` derived from event data (a static per-class collapse id MAY be used). The Notification Service Extension receives the notification for modification with a limited, unguaranteed time budget; on timeout iOS displays the original (generic) content — hence `fallback` is REQUIRED, and rich preview is opportunistic. `silent` maps to background-only delivery (`aps.content-available: 1`, no alert, `apns-priority: 5`), which iOS throttles at its discretion: executors and clients MUST treat iOS `silent` as best-effort sync that may be arbitrarily delayed or dropped, and MUST NOT route anything a user must see through it. `urgent` maps to `interruption-level: critical` only with Apple's Critical Alerts entitlement, else `time-sensitive`. Total payload MUST fit APNs' 4 KB limit.

### FCM

The wake primitive is a **data message** (no `notification` member — notification-type messages go to the system tray in background and run no app code until tap) whose `data` map carries the wake object's members as strings: `data.v`, `data.fallback` (user-visible classes only), `data.grant` (when present). User-visible classes send with `priority: high` and a `ttl` matching the APNs expiration guidance; on receipt the app MUST post a privacy-safe generic notification immediately, then enrich within the `onMessageReceived` window or a brief expedited-work exemption (post-then-enrich, the mirror of the NSE rewrite window). `silent` wakes use `priority: normal` and post nothing — deferring them under Doze is the correct behavior, and it avoids the deprioritization penalty for high-priority messages that produce no visible notification (which the visible-notification rule satisfies structurally for every other class). Classes map to Android channel importance; the client MUST create the corresponding notification channels before activating a lease that names those classes, since channel importance is fixed at creation.

### UnifiedPush (optional)

Executors MAY support `transport: "unifiedpush"` for devices without Google services: the UP endpoint URL is the opaque `endpoint`, and the wake object is POSTed verbatim as the message body with `Content-Type: application/json`. Distributor delivery semantics vary; UP is a MAY-level profile and clients SHOULD treat its latency and reliability as distributor-dependent.

## Lease and Key Lifecycle

A lease is identified by `(author, kind, d)`. A replacement supersedes the prior lease at the same address only by passing the full acceptance sequence, including winning both NIP-01 addressable ordering and the strictly-increasing generation watermark (check 8). Any rejected replacement — stale by either ordering, or invalid for any other reason — MUST leave the stored event, effective push state, and watermark unchanged.

An active lease becomes ineffective when its `expiration` passes. Executors MUST NOT match, enqueue, or deliver wakes for an expired lease. Clients SHOULD refresh active leases before expiry; failure to refresh MUST NOT extend the prior lease. Expiry is a safety backstop, not evidence that a platform endpoint has been deleted.

**Revocation.** Revocation is exclusively a higher-generation replacement with the minimal inactive plaintext — exactly `{"v", "origin", "generation", "active": false}`; `app_profile`, `transport`, `endpoint`, `wake_key`, and `subscriptions` MUST be absent. NIP-09 deletion is unsupported for `kind:30350`: relays MUST ignore deletion requests targeting this kind, so the stored/effective/watermark invariant has exactly one transition path. The executor validates the inactive schema without consulting endpoint or app-profile availability, so revocation succeeds even after an app profile or transport has been withdrawn from the descriptor. On acceptance the executor MUST treat it as a tombstone for that lease address: stop matching, cancel undelivered jobs where practical, invalidate unredeemed wake grants, and delete transport endpoint material when no longer required for audit or abuse prevention. Reactivation is an ordinary active replacement with a yet-higher generation. The executor MUST persist the generation watermark for a lease address until at least `max(last_active_expiration, tombstone_accepted_at + max_lease_ttl) + allowed_skew` when a tombstone exists, or `last_active_expiration + allowed_skew` when none does (after which any replay fails the expiration lower bound) — or a longer descriptor-advertised fixed retention — so a replayed older event can never resurrect a revoked lease. Logging out one installation MUST NOT alter sibling installation leases.

**Endpoint rotation.** When a platform rotates an endpoint token, the client MUST publish a replacement at the same lease address with an incremented `generation` and the new endpoint encrypted in `content`. The executor MUST deliver only to the highest accepted generation. A permanent invalid-endpoint response from a transport MUST disable only that endpoint generation; it MUST NOT revoke the author's identity or affect sibling leases. A later valid replacement with a newer generation MAY reactivate the lease. Executors SHOULD apply bounded retries to transient transport failures without changing the accepted lease.

Each encrypted lease MUST identify the descriptor encryption key for which its content was produced. A descriptor MUST advertise one current encryption key and MAY advertise retiring keys together with their identifiers. On rotation, an executor MUST either retain each retiring private key for at least the maximum lease lifetime advertised while that key was current, plus allowed clock skew, or retain the endpoint material already decrypted from accepted leases until those leases expire or are revoked. Because wake grants are encrypted *from* the descriptor key, the executor MUST also retain a key's private material until every grant minted under it has expired. Key rotation MUST NOT silently invalidate an accepted lease.

Clients SHOULD replace leases under the descriptor's current key before their existing leases expire. An executor MUST reject a replacement encrypted to an unknown or no-longer-accepted key without disturbing the prior valid lease. After a retiring key's acceptance window closes, executors MUST reject new leases encrypted to that key and SHOULD erase its private material once no accepted lease or operational recovery window requires it.

## Remote Signers

This NIP introduces no delegation mechanism. A client whose user key is held by a NIP-46 remote signer creates the same root-authored lease as a local-key client. It asks the signer to perform `nip44_encrypt` to the executor's advertised encryption pubkey and `sign_event:30350` for the completed lease. When the relay requires NIP-42 authentication, the client must also be able to obtain the required kind `22242` AUTH signature, for example through the corresponding `sign_event:22242` signer permission. The relay applies identical authentication, signature, replacement, and authorization rules regardless of signer location.

A client SHOULD request only the NIP-46 permissions needed for these operations. The executor MUST NOT accept a NIP-46 client transport key, bunker URL, connection secret, authorization URL, or signer session as a substitute for a lease signed by the user's pubkey. Clients MUST NOT place such signer material in public tags or encrypted lease content.

The installation `wake_key` is independent of both the user's Nostr key and the NIP-46 transport key. It SHOULD be generated and retained by the installation in platform-protected storage accessible to the notification extension or background handler. A wake-key signature proves possession only for wake-grant redemption; it MUST NOT authorize lease creation, replacement, relay authentication, or publication of Nostr events.

A pubkey-only client cannot create, replace, or revoke a lease. If a platform endpoint rotates while the remote signer is unavailable, the client MUST NOT publish an unsigned update or reuse another installation's authorization. It SHOULD queue the replacement until the signer is available; the existing lease remains bounded by its expiry and the executor's permanent-endpoint-error handling.

Implementations MUST NOT interpret this section as NIP-26 delegation. A future specification may define a narrowly scoped installation authorization for unattended endpoint rotation, but such a capability is neither required nor implied here.

## Implementation Notes (Buzz, non-normative)

Per `RESEARCH/PUSH_RELAY_INTEGRATION.md` (pinned SHA `88c089d`): the lease matcher hooks the generic post-storage dispatch seam (`buzz-relay/src/handlers/event.rs:245 dispatch_persistent_event`), not `handle_side_effects`; Redis pub/sub is community-scoped routing precedent but not the durable offline-matching source; `event_mentions` is a ready indexed primitive for self-`#p` and needs-action subscriptions but is **not** authorization — private-channel wakes re-check same-community visibility at match/send time. Known footgun: some internal producers bypass `dispatch_persistent_event`; implementation must centralize durable dispatch or add push dispatch at each internal publish path.

## Privacy Considerations

What each party learns:

| Party | Learns |
|---|---|
| Platform push service (Apple/Google/distributor) | that *some* wake occurred for this app installation, its timing, class, and the generic fallback text; a wake grant it cannot decrypt or redeem at all without the installation's `wake_key` |
| Executor / relay | lease filters in plaintext (it must match them), the transport endpoint, and wake timing — this is new information relative to the bare event store, entrusted to the executor because it is the origin's trusted component |
| Other relay users | nothing: leases are author-only reads |

The wake-hint model means notification metadata held by platform vendors reduces to traffic analysis of wake timing. Lease count and replacement cadence are visible to the executor; `d`-randomness prevents linking leases to hardware identities, and per-origin `d` values prevent executors serving multiple origins from linking one installation across them.

## Security Considerations

Amplification is disarmed at write time by construction: no un-narrowed filter, no allow-list-external kind, no time-travel, no callback URLs, exact 64-hex match values (no prefix or glob surface reachable from a lease), byte-bounded content and strings, bounded quotas on every axis, endpoint-unique active leases, and one durable wake job per `(origin, app_profile, transport, H(endpoint), event id)`. Residual matching cost is bounded by the quotas; residual delivery cost by the wake rate cap.

Zombie leases (e.g. `#h` after leaving a channel) are neutralized by match-time authorization re-check; leaked or abandoned leases self-heal at `expiration`. The executor is a trusted component of the origin: it holds tenant read authorization and the descriptor keys, so a *malicious executor* can read whatever the origin's relay can read and can mint grants over it — this NIP's guarantees assume an honest executor, exactly as relay read-authorization guarantees assume an honest relay. What the design removes is escalation from the *client* side: a lease or grant never expands what its author can read, because wakes carry no content, reads flow through normal authenticated `REQ`, and wake grants are least-authority projections of an already-authorized lease, rechecked at redemption. Compromise of an installation's `wake_key` exposes at most the matched-event windows of unexpired grants for that installation; compromise of the user key allows lease manipulation as it allows everything else.

## Registry

- `kind:30350`: push lease (addressable)
- `exec` tag: executor encryption-key identifier for `kind:30350`
- NIP-11 `supported_extensions`: contains `"nip-pl"` pre-numbering; descriptor object `push` as specified in Executor Discovery
- Classes: `silent`, `default`, `time_sensitive`, `urgent`
- `h_grammar` values: `"uuid-v4-lowercase"` (initial entry; origins may register additional grammars with this NIP)
- Wake object versions: `1`

---
### Draft status / open items
- [x] Lane C (Max): landed — hook seam `dispatch_persistent_event` (event.rs:245), event_mentions ≠ authorization, origin-partition invariant. Folded into Implementation Notes + Matching section.
- [x] Wren adversarial reread #1 (2026-07-02): 8 blockers + non-blocking cuts, all applied — trusted-origin executor boundary, acceptance/origin-binding state machine, wake-grant wire protocol, class ordering (urgent = approvals-only v1), best-effort delivery language, minimal inactive schema + generation replay window, exact-hex/size-bound schema limits.
- [x] Wren wire review #2 (2026-07-02): 5 wire blockers + judgment call, all applied — versioned wake object + exact APNs/FCM/UP embeddings (lease reference eliminated), dual-ordering (NIP-01 ∧ generation) atomic acceptance with watermark, endpoint-keyed dedup + endpoint-uniqueness at acceptance, grant upper-bound/monotonic-omission semantics + full token/Bearer/error wire details, replay-window math fixed (`max(last_active_expiration, tombstone_accepted_at + max_lease_ttl) + allowed_skew`). Public plaintext grants CUT — all grants require wake_key. Smaller clarifications (per-origin d MUST, descriptor validity, numeric domains, h_grammar, FCM channel timing, grant-key retention) all in.
- [x] Wren final pass (2026-07-02, NO-SHIP → fixes applied): 3 blockers — (1) grant key discovery: encrypted `origin` + `key_id` in grant plaintext, bounded trial decryption over retained descriptor pubkeys, exact schema/origin/key_id/url binding, zero-or-multiple valid = ignore, retention through lease+grant TTL; (2) NIP-09 deletion unsupported for kind:30350 (relays MUST ignore), revocation exclusively higher-generation `active:false`, natural-expiry watermark = `last_active_expiration + allowed_skew`; (3) redemption failures identical status/headers/body (`404 invalid_grant`), timing/rate-limit at SHOULD. Plus 3 clarifications: `fallback` version-independent (unknown `v` → MAY display `fallback`, else no display); acceptance requires `transport == selected app_profile.transport` and endpoint uniqueness inside the atomic acceptance transaction; `max_grant_response_len` = UTF-8 JSON body bytes excluding HTTP framing.
- [x] Wren focused diff check (2026-07-02): blockers 2–3 + clarifications pass; one residual wire ambiguity fixed — grant sender key pinned to the accepted lease's `exec` key (private half unavailable ⇒ no grant, generic wake; never substitute a newer key); retained trial candidate is the full descriptor tuple `(origin, key_id, pubkey, redemption endpoint)` with byte-for-byte `url` binding to the retained endpoint (executor keeps it serving through the retention window); duplicate JSON keys in grant plaintext explicitly invalidate the candidate.
- [x] Wren SHIP blessing (2026-07-02, event 52cffa11): Minimalness 9/10, Elegance 9/10, Correctness 9/10 — no remaining protocol blocker; ready to move from internal draft to proposal/review.
- [x] Product defaults (non-protocol, Buzz): DM subscriptions default to class `time_sensitive` (urgent is approvals-only until a privacy-safe DM urgency marker exists); reactions (`kind:7`) advertised in `push_kinds` but never registered without explicit opt-in.
- [x] Kind 30350 verified unclaimed in upstream nips README registry and Buzz `kind.rs` as of 2026-07-02 (upstream HEAD 8f8444d, buzz main 02ff06c)

### Stateless public last-hop profile (Buzz)

An executor MAY delegate only the platform transport call to a stateless public gateway. This does not transfer executor authority: the relay remains the executor and MUST retain lease acceptance, matching, tenant authorization, endpoint uniqueness, quotas, coalescing, replay/idempotency, durable retries, and generation invalidation in its own database.

For APNs, the gateway issues an authenticated-encryption endpoint grant containing exactly `{v, endpoint, relay_pubkey, app_profile, max_class, generation, expires_at}`. Issuance MUST use a gateway-owned `POST /v1/grants/apns` boundary distinct from delivery. The closed request is `{v, endpoint, app_profile, max_class, generation, expires_at}`; `relay_pubkey` MUST be derived only from a valid NIP-98 signature bound to the exact configured issuance URL and payload, and caller-supplied authority fields MUST be rejected. The gateway MUST authorize the signer, reject unconfigured profiles before sealing, and require `gateway_now < expires_at <= gateway_now + max_grant_lifetime`. A successful response contains only `{endpoint_grant}`; key IDs, key material, and predecessor selection remain gateway-private.

The relay stores only that opaque grant with its lease. For each attempt it NIP-98-signs a closed delivery request `{v, endpoint_grant, request_id, class, expires_at, wake}`. The gateway MUST verify the NIP-98 payload and signer, decrypt the grant, require signer equality, enforce both expiries and the class ceiling, and perform at most one APNs request (plus one credential-refresh retry). It MUST hold no lease, endpoint, replay, quota, idempotency, or delivery state.

`request_id` is the relay's durable job id and becomes the stable APNs id across retries. A permanent endpoint response returns only the sealed generation and provider invalidation timestamp; the relay MUST apply it only if that generation is still current. Transient responses return a bounded `Retry-After` hint; the relay owns retry policy. Grant lifetime MUST NOT exceed the lease lifetime. Grant-key rotation therefore requires the gateway to retain decrypt-only predecessors through their maximum issued lifetime.
