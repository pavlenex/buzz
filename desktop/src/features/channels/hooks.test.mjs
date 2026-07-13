import assert from "node:assert/strict";
import test from "node:test";

import { upsertCachedChannel } from "./hooks.ts";

function makeChannel(id, name, channelType = "stream") {
  return { id, name, channelType };
}

test("upsertCachedChannel_reseedsOpenedDmAfterStaleRefetch", () => {
  const staleChannels = [makeChannel("general", "General")];
  const openedDm = makeChannel("new-dm", "Alice", "dm");

  const repairedChannels = upsertCachedChannel(staleChannels, openedDm);

  assert.strictEqual(
    repairedChannels.find((channel) => channel.id === openedDm.id),
    openedDm,
    "the route must be able to resolve the exact relay-returned DM",
  );
});

test("upsertCachedChannel_replacesExistingChannelWithoutDuplicates", () => {
  const staleDm = makeChannel("new-dm", "Old name", "dm");
  const openedDm = makeChannel("new-dm", "Alice", "dm");

  const repairedChannels = upsertCachedChannel([staleDm], openedDm);

  assert.deepEqual(repairedChannels, [openedDm]);
});
