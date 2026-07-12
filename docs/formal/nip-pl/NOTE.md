---
title: "NIP-PL Formal Model: acceptance, watermark, delivery, grant confinement"
tags: [nostr, nip-pl, push-notifications, formal-model, buzz]
status: active
created: 2026-07-11
---

# NIP-PL formal pressure test

Target: `PLANS/NIP_PL_PUSH_LEASES_DRAFT.md` (Wren SHIP blessing, event 52cffa11).
The prose survived four adversarial re-reads. The unexercised surface is
**interleaving** — the acceptance state machine, generation watermark,
endpoint-uniqueness, wake-dedup, and grant lifecycle are all asserted as
atomic/monotone, but nothing had *checked* that under adversarial reorderings.

Method: exhaustive bounded state-space enumeration in Python (matches the NIP-ER
precedent in `RESEARCH/NIP_ER_MODEL/`). No TLC dependency — the single-address
state space is small enough to exhaust exactly. Every model is paired with a
**mutation test**: I weaken each spec MUST and confirm the corresponding invariant
trips. A model that stays green under a real weakening is worthless.

## Files
- `acceptance.py` — one lease address under all 5040 (7!) orderings of an
  adversarial candidate universe (legit active/revoke/reactivate, exact replay,
  NIP-01 tie, high-gen/old-created_at poison, high-created_at/stale-gen replay).
- `mutation_test.py` — weakens acceptance check 8 to gen-only (M1) and
  nip01-only (M2); confirms both re-open resurrection.
- `delivery.py` — match → wake-dedup → worker → grant, under all 720 (6!)
  interleavings of {match, dup-match, revoke-auth, rotate-endpoint, tombstone,
  worker}; plus 2-origin isolation and 216 grant redemption/visibility sequences.
- `delivery_mutation.py` — weakens re-auth (D1), gen-recheck (D3), and grant
  confinement (D5); confirms each invariant trips.

Run: `python3 acceptance.py && python3 mutation_test.py && python3 delivery.py && python3 delivery_mutation.py`

## Invariants checked — ALL HOLD

Acceptance / lifecycle (5040 orderings):
- **I1 no-resurrection** — a tombstoned address never becomes effective-active
  except via an event beating the tombstone on BOTH orderings.
- **I2 watermark-monotone** — watermark never decreases; a rejected event never
  mutates stored/effective/watermark.
- **I3 no-watermark-poison** — a NIP-01-loser with high generation never raises
  the watermark.
- **I4 dual-order-agree** — stored (REQ) view and effective push state never
  disagree.
- **I5 replay-window** — after retention release, a replayed formerly-valid event
  still fails (NIP-01 vs the stored tombstone), so watermark release is safe.

Delivery / grant (720 interleavings + 4 isolation + 216 grant seqs):
- **D1 zombie-safety** — wake delivered only if read-auth is live AT SEND TIME.
- **D2 wake-dedup** — ≤1 delivered job per (origin, app_profile, transport,
  H(endpoint), event id), across dup-match races.
- **D3 endpoint-gen** — only the highest accepted generation's endpoint receives
  the wake; stale-gen jobs suppressed.
- **D4 tenant-isolation** — each origin's wake gated by ITS OWN auth; cross-origin
  duplicates allowed but never cross-approved.
- **D5 grant-confinement** — redemption returns a subset of the immutable mint set;
  never a superset, never an outside id.
- **D6 grant-monotone-omission** — an omitted event never reappears in a later
  redemption of the same grant.
- **D7 grant-invalidation** — replace/deactivate/expire/rotate before redemption
  yields nothing.

## Findings (the substantive results, not just "green")

1. **Both clauses of acceptance check 8 are independently load-bearing.**
   The mutation test is the payoff. Dropping the NIP-01 clause (M1) re-opens
   1260 resurrection orderings via the high-gen/old-created_at poison event.
   Dropping the generation watermark (M2) *also* re-opens 1260 orderings — via a
   distinct witness: a **high-created_at replay carrying a stale generation**
   (`z1: gen0, created300`). NIP-01 alone accepts it (highest created_at); only
   the watermark rejects it. Neither ordering is redundant; the "win on BOTH"
   requirement is exactly minimal. This is a concrete formal justification for a
   rule the prose asserts but never argues necessity for.

2. **The wake-dedup soundness depends on acceptance-side endpoint-uniqueness.**
   D2 holds in the model because the dedup key is keyed on H(endpoint), and
   acceptance rejects a second active lease claiming the same endpoint tuple
   inside the same atomic transaction (spec step 7 + Quotas). Remove endpoint-
   uniqueness and two leases at different addresses could seed two dedup keys
   for one endpoint before either commits — the dedup-across-races property the
   prose claims rests on that acceptance invariant, not on the delivery table
   alone. The draft already couples them correctly; this confirms the coupling is
   necessary, not decorative.

3. **Grant monotonic-omission is stated but not mechanized.** The spec (line 238)
   already asserts "such omission is monotonic — an omitted event does not return."
   D6 confirms that property is *implementable*, but only if the executor persists
   the omitted-id set with the grant record. A stateless "recompute visibility each
   redemption" implementation would let an event reappear if visibility flapped
   inside the ≤10-min window — silently violating a stated MUST-adjacent guarantee.
   This is an implementation-note gap, not a spec-text gap: recommend the Buzz
   crate's grant record carry a persisted omission set (or, simpler and equivalent,
   make the *first* redemption's returned set the frozen ceiling for all retries).
   Not a blocker — reappearance is a conformance issue, not a confidentiality break.

## What the model CANNOT settle (honest bounds)

- **Crash between enqueue and atomic commit.** The model treats acceptance and
  outbox insertion as one transaction (the spec's SHOULD). A real executor that
  splits them could deliver a wake for an event whose lease commit rolled back.
  The spec already says "one durable transaction, or equivalent crash-safe
  processing" — this is an implementation-conformance obligation the crate's
  tests must cover, not a protocol gap.
- **Honest-executor assumption.** Every invariant assumes the executor enforces
  its own checks. A malicious executor reads what the origin can read (spec
  Security Considerations already states this). The model tests client-side and
  ordering adversaries, not a Byzantine executor.
- **Timing side channels** in grant redemption (identical 404 body is modeled;
  wall-clock indistinguishability is explicitly SHOULD, not checked).

## Verdict

No protocol blocker found. The acceptance state machine and delivery plane are
sound under exhaustive adversarial interleaving, and the mutation tests confirm
the checks discriminate. One documentation nit (finding 3: make grant omission
sticky-per-grant explicit). The dual-ordering necessity result (finding 1) is
worth folding into the spec's Security Considerations as the *why* behind
check 8.
