"""Mutation test for the delivery model -- prove D1/D3/D5 checks have teeth.

Each mutation weakens one spec MUST; the corresponding invariant MUST trip.
"""
from itertools import permutations, product
from delivery import Origin, Grant, EVENT_ID

def run_D1_mutant():
    """Weaken worker: skip the read-auth re-check (use match-time auth only)."""
    caught = 0
    actions = ["match","revoke_auth","worker"]
    for perm in permutations(actions):
        o = Origin("A")
        matched_auth = None
        for a in perm:
            if a=="match":
                o.match_and_enqueue(EVENT_ID, o.lease_gen); matched_auth = o.read_authorized
            elif a=="revoke_auth":
                o.read_authorized = False
            elif a=="worker":
                # MUTANT: deliver if lease active + gen ok, IGNORING current auth
                for (eid,g) in list(o.pending_jobs):
                    if o.lease_active and g==o.lease_gen:
                        o.delivered.append((o.name,eid))
                    o.pending_jobs.remove((eid,g))
        idx={a:i for i,a in enumerate(perm)}
        if o.delivered and idx.get("revoke_auth",99)<idx.get("worker",99):
            caught += 1   # zombie wake delivered post-revoke
    return caught

def run_D3_mutant():
    """Weaken worker: skip endpoint-generation revalidation."""
    caught=0
    actions=["match","rotate_endpoint","worker"]
    for perm in permutations(actions):
        o=Origin("A")
        for a in perm:
            if a=="match": o.match_and_enqueue(EVENT_ID,o.lease_gen)
            elif a=="rotate_endpoint": o.lease_gen+=1
            elif a=="worker":
                for (eid,g) in list(o.pending_jobs):
                    if o.lease_active and o.read_authorized:  # MUTANT: no gen check
                        o.delivered.append((o.name,eid))
                    o.pending_jobs.remove((eid,g))
        idx={a:i for i,a in enumerate(perm)}
        if o.delivered and idx.get("match",99)<idx.get("rotate_endpoint",99)<idx.get("worker",99):
            caught+=1   # delivered to a rotated-away (stale) endpoint generation
    return caught

def run_D5_mutant():
    """Weaken grant: redemption honors a client-supplied filter that can GROW."""
    mint={"e_a","e_b"}
    class GrowGrant(Grant):
        def redeem(self, visible_ids):
            if self.invalidated: return frozenset()
            return frozenset(visible_ids)  # MUTANT: return whatever is visible now
    caught=0
    for extra in ({"e_a","e_b","e_x"}, {"e_x"}, mint|{"e_y"}):
        g=GrowGrant(mint,"A")
        r=g.redeem(extra)
        if not r<=mint:   # returned an id outside the immutable mint set
            caught+=1
    return caught

d1=run_D1_mutant(); d3=run_D3_mutant(); d5=run_D5_mutant()
print(f"D1 mutant (skip re-auth)      -> zombie wakes caught: {d1}")
print(f"D3 mutant (skip gen recheck)  -> stale-endpoint wakes caught: {d3}")
print(f"D5 mutant (filterable grant)  -> confinement breaches caught: {d5}")
print("teeth:", "OK" if (d1 and d3 and d5) else "WEAK CHECK")
