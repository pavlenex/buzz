import * as React from "react";

import {
  dmPeerPubkey,
  makeDmIngestDecryptor,
} from "@/features/messages/lib/dmCrypto";
import type { Channel, RelayEvent } from "@/shared/api/types";

/**
 * Decrypt deep-link / search-hit target events before they reach the rendered
 * timeline.
 *
 * The route layer fetches deep-link targets, thread ancestors, and search hits
 * as RAW RelayEvents (no decrypt) and threads them down as `targetMessageEvents`.
 * `ChannelScreen` merges those into the rendered list — so for a DM, where the
 * body is NIP-44 v2 ciphertext, the raw target would render garbled and, on an
 * id collision, CLOBBER the decrypted cache copy (the merge keeps the last
 * writer).
 *
 * This is the single choke point for that whole class: every contributor flows
 * through the one `targetMessageEvents` array, so decrypting it here once covers
 * the synchronous mount-seed, the cached-search-hit path, and the async fetch
 * path uniformly — a decrypt split across the individual setters would miss the
 * synchronous mount-seed and leak on a search-jump first paint.
 *
 * Outside a 2-party DM (`dmPeerPubkey` null) there is nothing to decrypt, so the
 * events pass through synchronously with no held-back frame. Inside a DM the
 * events are held back (empty) until the async decrypt resolves, so raw
 * ciphertext never paints.
 */
export function useDecryptedTargetMessageEvents(
  activeChannel: Channel | null,
  targetMessageEvents: RelayEvent[],
  selfPubkey: string | undefined,
): RelayEvent[] {
  const needsDecrypt =
    activeChannel !== null && dmPeerPubkey(activeChannel, selfPubkey) !== null;

  const [decryptedEvents, setDecryptedEvents] = React.useState<RelayEvent[]>(
    [],
  );

  React.useEffect(() => {
    if (!needsDecrypt || targetMessageEvents.length === 0) {
      return;
    }

    let isCancelled = false;
    const decryptIngested = makeDmIngestDecryptor(activeChannel, selfPubkey);
    void decryptIngested(targetMessageEvents).then((decrypted) => {
      if (!isCancelled) {
        setDecryptedEvents(decrypted);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [activeChannel, needsDecrypt, selfPubkey, targetMessageEvents]);

  // Outside a DM there is nothing to decrypt: pass the events through directly so
  // a non-DM deep-link splices its target on first paint with no held-back frame.
  return needsDecrypt ? decryptedEvents : targetMessageEvents;
}
