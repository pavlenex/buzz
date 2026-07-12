# Stateless gateway safety model

State exists only at the relay. The gateway transition is a pure function of `(signed request, sealed grant, current time, APNs response)`.

Invariants:

1. **Signer confinement:** delivery occurs only when the NIP-98 signer equals `grant.relay_pubkey`.
2. **Lease bound:** delivery occurs only before both request and grant expiry.
3. **Class bound:** `request.class <= grant.max_class`.
4. **Endpoint secrecy/integrity:** endpoint and generation are accepted only from authenticated ciphertext; tampering fails closed.
5. **Generation-safe invalidation:** the gateway returns the grant generation; the relay compares it with current lease generation before disabling.
6. **No gateway resurrection/state:** restart changes no authorization decision because the gateway persists no state.
7. **Stable retries:** relay-owned `request_id` is used as APNs id across retry attempts.

Replay, quotas, endpoint uniqueness, coalescing, and durable retry are relay invariants and cannot be weakened by restarting or scaling the gateway.
