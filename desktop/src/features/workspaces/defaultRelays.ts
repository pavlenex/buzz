/**
 * Default public Nostr relays offered as quick-picks when creating a
 * serverless workspace.
 *
 * Sourced from the deez mesh client's `DEFAULT_RELAYS`
 * (`deez/crates/mesh-client/src/network/nostr.rs`) so Sprout's serverless mode
 * and the mesh ecosystem converge on the same well-known relays.
 *
 * These are only suggestions — users can type any relay URL. They apply only
 * to serverless workspaces; Sprout-server workspaces use their own relay.
 */
export const DEFAULT_PUBLIC_RELAYS: readonly string[] = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.land",
  "wss://nostr.wine",
] as const;

/** The relay pre-filled when a user first enables serverless mode. */
export const DEFAULT_SERVERLESS_RELAY = DEFAULT_PUBLIC_RELAYS[0];
