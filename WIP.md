# WIP: Offline-root signing

Status: implementation paused while we confirm what “generic delegated
signing” should mean.

## What we are trying to protect

A Buzz account has a routine key that remains available to the desktop app and
may also be accessible to agents. That key should continue to sign ordinary
Buzz events. For a sensitive action such as approving a pull request, we want
an additional signature from an offline root.

The original PR event and its updates are already signed and content-addressed.
The offline root therefore does not need to sign another copy of the payload or
participate in a separate request/policy workflow. It needs to sign the exact
event ID it reviewed.

A Nostr event has one author and one signature, and its ID commits to that
author, its tags, and its content. We cannot append a second signature to an
existing event without changing it. The root must publish a new signed event
that references the original event.

## Delegation and countersigning are different

Tyler's comment that we will probably want this generically for delegated
signing changes where the primitive should live, but it does not bring back the
generic approval system.

There are two related operations:

- **Delegation:** a root authorizes another key to sign some class of future
  events on its behalf.
- **Countersigning:** a root reviews an event that already exists and signs a
  reference to that exact event.

Ordinary delegation alone does not solve the high-assurance problem. If the
routine key is compromised, an attacker can use whatever authority was
delegated to it. High-assurance approval requires the second operation: the
offline root must countersign each exact sensitive event.

The two operations can share a generic representation of the relationship
between an account and its signing authority, but their verification rules and
security properties must remain distinct.

## Proposed minimal primitive

The reusable protocol needs only two signed objects in addition to the event
being approved.

First, the routine account publishes a root link. The link contains a root
signature over the routine pubkey, and the routine profile signs the link in
turn. This proves that both keys agree on the relationship.

Second, the root publishes an endorsement with:

- the exact subject event ID;
- the exact account/root-link event ID;
- the routine account represented by the root; and
- a short signed purpose such as `approve`.

The generic verifier checks the profile, subject, and endorsement signatures;
the root-to-account link; the exact references; and the signed purpose. It does
not know anything about pull requests.

The relay may use that same verifier before storing an endorsement. It should
validate the signing relationship and referenced events, but it should not
implement PR-specific rules.

## Pull requests become a thin consumer

For a pull request, the subject is the current signed revision:

- the latest trusted kind `1619` update, when one exists; or
- otherwise the original kind `1618` pull-request event.

The PR code treats a valid endorsement with purpose `approve` as an approval by
the routine account. If a new update is published, its event ID is different,
so an endorsement of the previous revision no longer counts. No separate
staleness or payload-digest mechanism is required.

The desktop should export the subject event and account link as an offline
signing package. The root secret remains on the offline device. The desktop
only imports the resulting public endorsement event.

## What Tyler's comment changes

The underlying SDK and wire format should use generic event-signing language,
not PR-specific types. The offline CLI should likewise sign an arbitrary exact
event package. PR code supplies the subject and interprets `approve`.

The current direction is therefore mostly right, but any checks for PR kinds or
the literal `approve` action belong in the PR feature, not in the generic
endorsement builder or publisher.

This does **not** justify adding:

- approval policies;
- request and decision records;
- thresholds or quorum calculation;
- a generic approval inbox;
- copied payloads and payload digests; or
- a separate proof-object hierarchy.

Those features solve different problems and were responsible for most of the
earlier size and complexity.

## Root rotation and revocation

Changing or removing the root must itself require authorization from the
current root. Otherwise a compromised routine key could remove the protection
before performing a sensitive action.

We still need to decide how rotation affects old endorsements. There are two
reasonable meanings:

- The endorsement proves that the root was valid when it signed. It remains
  valid historical evidence after rotation.
- An endorsement may authorize a pending action only while its referenced root
  link is current. Rotation immediately prevents old-root endorsements from
  authorizing new execution.

For PR admission, the second rule is safer. We can preserve the old event as
historical evidence while requiring the current account/root link when deciding
whether the PR may merge.

## Questions to settle before continuing

1. Did Tyler mean classic future-event delegation, exact-event countersigning,
   or a shared protocol that supports both?
2. Should the account/root relationship remain a tag on the routine profile,
   or become a dedicated replaceable event reusable by other signing features?
3. Is the first version intentionally one root per account, or must it support
   multiple scoped delegates now?
4. Should active authorization always require the currently linked root, while
   preserving older endorsements only as audit history?

My recommendation is to ship one root per account and one generic exact-event
endorsement. Use it first for PR approvals, keep PR interpretation outside the
generic verifier, and defer policies, quorum, and broader delegation until a
concrete second consumer requires them.
