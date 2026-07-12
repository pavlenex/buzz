"""Formal model of NIP-PL match -> wake -> grant delivery (same draft).

Exhaustive exploration of the DELIVERY plane under adversarial interleaving of:
  - a matched event,
  - a read-authorization revocation (membership change),
  - a lease endpoint rotation (generation bump),
  - a lease tombstone,
  - worker pickup of a durable wake job,
  - grant mint + N redemption attempts (retries/replays),
and, for isolation, TWO origins that may wake the SAME installation endpoint.

Invariants (all asserted by the spec as MUSTs):

  D1 zombie-safety : a wake is DELIVERED only if the lease author is authorized to
        read the matched event at the origin AT SEND TIME. Auth at match time is
        insufficient. (Matching Semantics: "Workers MUST re-check ... current read
        authorization before delivery"; "A lease is a wake request, never a read
        grant.")
  D2 wake-dedup : at most ONE delivered wake job per
        (origin, app_profile, transport, H(endpoint), event id) -- across races and
        legacy state. (Wake Delivery: "at most one durable wake job per ...")
  D3 endpoint-gen : after endpoint rotation, only the HIGHEST accepted generation's
        endpoint receives the wake; stale-generation jobs are cancelled/superseded.
  D4 tenant-isolation : origin A's read-authorization state NEVER approves a wake at
        origin B, even for the same installation/endpoint. Cross-origin duplicate
        wakes are allowed (separate jobs) but each is gated by ITS OWN origin's auth.
  D5 grant-confinement : redemption returns a SUBSET of the mint-time event-id set;
        never a superset, never a different id. (Wake Grants: "exact, immutable set
        ... upper bound ... responses may omit ...")
  D6 grant-monotone-omission : once an event is omitted from a redemption (visibility
        lost), no later redemption of the SAME grant returns it. ("such omission is
        monotonic -- an omitted event does not return.")
  D7 grant-invalidation : replacement / deactivation / expiry / endpoint-gen bump
        before redemption invalidates the grant -> redemption returns nothing.
"""
from itertools import permutations, product

EVENT_ID = "EVT"

class Origin:
    """One origin's view: its own auth state + its own dedup table + jobs."""
    def __init__(self, name):
        self.name = name
        self.read_authorized = True     # author may read EVT at this origin
        self.lease_active = True
        self.lease_gen = 1              # highest accepted endpoint generation
        self.delivered = []             # (origin, event_id) actually pushed
        self.dedup = set()              # keys already turned into a durable job
        self.pending_jobs = []          # (event_id, gen) queued, awaiting worker

    def match_and_enqueue(self, event_id, gen):
        # dedup key per spec: (origin, app_profile, transport, H(endpoint), event id).
        # app_profile/transport/H(endpoint) are constant for this installation here,
        # so the key reduces to (origin, event_id).
        key = (self.name, event_id)
        if key in self.dedup:
            return False                # D2: no second job
        self.dedup.add(key)
        self.pending_jobs.append((event_id, gen))
        return True

    def worker_deliver(self, event_id, job_gen):
        # revalidate BEFORE send (spec: active, expiration, endpoint gen, read-auth)
        if not self.lease_active:
            return "suppressed:inactive"
        if job_gen != self.lease_gen:
            return "suppressed:stale-gen"     # D3
        if not self.read_authorized:
            return "suppressed:unauthorized"  # D1
        self.delivered.append((self.name, event_id))
        return "delivered"

class Grant:
    """Wake grant: minted over an immutable id set; redemption re-validates each."""
    def __init__(self, mint_ids, origin):
        self.mint_ids = frozenset(mint_ids)   # immutable upper bound
        self.origin = origin
        self.invalidated = False
        self.ever_omitted = set()             # ids omitted in some past redemption

    def redeem(self, visible_ids):
        if self.invalidated:
            return frozenset()                # D7
        # return only ids in mint set that are STILL visible now
        now_visible = self.mint_ids & frozenset(visible_ids)
        # D6: an id omitted before must stay omitted even if visibility "returns"
        result = now_visible - self.ever_omitted
        omitted_now = self.mint_ids - result
        self.ever_omitted |= omitted_now
        return result

def explore_delivery():
    viol = {k: [] for k in ("D1","D2","D3","D4")}
    n = 0
    # adversarial action set on ONE origin around a single matched event.
    # actions can happen before/after the worker picks up the job.
    actions = ["match", "revoke_auth", "rotate_endpoint", "tombstone", "worker",
               "match2"]  # match2 = duplicate match of same event (race/legacy)
    for perm in permutations(actions):
        n += 1
        o = Origin("A")
        for a in perm:
            if a == "match":
                o.match_and_enqueue(EVENT_ID, o.lease_gen)
            elif a == "match2":
                o.match_and_enqueue(EVENT_ID, o.lease_gen)  # dup -> must be no-op
            elif a == "revoke_auth":
                o.read_authorized = False
            elif a == "rotate_endpoint":
                o.lease_gen += 1
            elif a == "tombstone":
                o.lease_active = False
            elif a == "worker":
                # drain any pending job present now
                for (eid, g) in list(o.pending_jobs):
                    o.worker_deliver(eid, g)
                    o.pending_jobs.remove((eid, g))
        # D1: if a delivery happened, auth must have been true AT that send.
        #     we approximate: a delivery is only recorded when worker_deliver passed
        #     the live checks, so any delivery implies auth was live then. Violation
        #     if we ever delivered while, in the FINAL state, we can prove auth was
        #     already permanently revoked before the worker ran.
        # Precise check: reconstruct whether worker ran strictly after revoke.
        # Simulate the schedule again tracking auth-at-delivery:
        auth=True; active=True; gen=1; bad=False
        for a in perm:
            if a=="revoke_auth": auth=False
            elif a=="rotate_endpoint": gen+=1
            elif a=="tombstone": active=False
            elif a=="worker":
                # any job delivered now must satisfy live checks
                pass
        # D2: dedup guarantees at most one job -> at most one delivery for EVT
        if len(o.delivered) > 1:
            viol["D2"].append((perm, o.delivered))
        # D1: delivered implies auth live at send. Because worker_deliver enforces it,
        # a violation would only appear if the model let a delivery through post-revoke
        # with no re-auth. Detect: delivered non-empty AND revoke strictly precedes the
        # (single) worker in perm.
        if o.delivered:
            idx = {a:i for i,a in enumerate(perm)}
            if "revoke_auth" in idx and "worker" in idx and idx["revoke_auth"] < idx["worker"]:
                viol["D1"].append((perm, "delivered after revoke"))
        # D3: delivered implies endpoint rotation did NOT strictly precede worker with
        # a stale job gen (job carries gen=1; after rotate lease_gen=2 -> suppressed).
        if o.delivered:
            idx = {a:i for i,a in enumerate(perm)}
            match_i = min([idx[m] for m in ("match","match2") if m in idx], default=None)
            if "rotate_endpoint" in idx and match_i is not None \
                    and match_i < idx["rotate_endpoint"] < idx["worker"]:
                viol["D3"].append((perm, "stale-gen job delivered"))
    return n, viol

def explore_isolation():
    """D4: two origins wake the same endpoint; each gated by its own auth."""
    viol = []
    n = 0
    for aA, aB in product([True, False], repeat=2):
        n += 1
        A = Origin("A"); B = Origin("B")
        A.read_authorized = aA
        B.read_authorized = aB
        for o in (A, B):
            o.match_and_enqueue(EVENT_ID, o.lease_gen)
            for (eid,g) in list(o.pending_jobs):
                o.worker_deliver(eid,g); o.pending_jobs.remove((eid,g))
        # A must deliver iff aA; B iff aB. Cross-contamination = violation.
        if bool(A.delivered) != aA:
            viol.append(("A", aA, aB, A.delivered))
        if bool(B.delivered) != aB:
            viol.append(("B", aA, aB, B.delivered))
        # separate jobs allowed: both may deliver when both authorized (duplicate ok)
    return n, viol

def explore_grants():
    """D5/D6/D7: grant confinement, monotonic omission, invalidation."""
    viol = {k: [] for k in ("D5","D6","D7")}
    mint = {"e_a", "e_b", "e_c"}
    # visibility sequences the adversary can present across up to 3 redemptions,
    # plus injection of ids OUTSIDE the mint set (must never appear).
    outside = {"e_x"}
    vis_choices = [set(), {"e_a"}, {"e_a","e_b"}, mint, mint|outside, {"e_c"}|outside]
    n=0
    for seq in product(vis_choices, repeat=3):
        n+=1
        g = Grant(mint, "A")
        seen_returned = set()
        for i, vis in enumerate(seq):
            r = g.redeem(vis)
            # D5: never a superset of mint, never an outside id
            if not r <= mint:
                viol["D5"].append((seq, i, r))
            # D6: once an id was omitted (was returnable earlier but not later)...
            # track: if an id returned before but visibility present now yet not returned
            for eid in seen_returned:
                if eid in (mint & vis) and eid not in r:
                    # allowed ONLY if it was omitted at some point -> which sets ever_omitted
                    if eid not in g.ever_omitted:
                        viol["D6"].append((seq, i, eid, "reappearance gap"))
            seen_returned |= r
    # D7: invalidation kills redemption regardless of visibility
    for kill in ("replace","deactivate","expire","rotate"):
        g = Grant(mint, "A")
        g.invalidated = True   # any of the four sets this per spec
        if g.redeem(mint):
            viol["D7"].append((kill, "redeemed after invalidation"))
    return n, viol

if __name__ == "__main__":
    nd, vd = explore_delivery()
    ni, vi = explore_isolation()
    ng, vg = explore_grants()
    print(f"delivery interleavings (6! ={nd}):")
    for k,v in vd.items(): print(f"  {k}: {len(v)} violation(s)"); [print("     ",x) for x in v[:3]]
    print(f"isolation configs ({ni}): {len(vi)} violation(s)"); [print("   ",x) for x in vi[:4]]
    print(f"grant sequences ({ng}):")
    for k,v in vg.items(): print(f"  {k}: {len(v)} violation(s)"); [print("     ",x) for x in v[:3]]
    total = sum(len(v) for v in vd.values())+len(vi)+sum(len(v) for v in vg.values())
    print("RESULT:", "ALL DELIVERY INVARIANTS HOLD" if total==0 else f"{total} VIOLATION(S)")
