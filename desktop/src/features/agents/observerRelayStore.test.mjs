import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  isKnownAgentPubkey,
  registerKnownAgentPubkeys,
  resetAgentObserverStore,
  unregisterKnownAgentPubkeys,
} from "./observerRelayStore.ts";

const AGENT_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AGENT_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const AGENT_C =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

describe("observerRelayStore known agent registrations", () => {
  beforeEach(() => {
    resetAgentObserverStore();
  });

  it("unions known agents from multiple bridge registrations", () => {
    const agentsPage = Symbol("agents-page");
    const profilePanel = Symbol("profile-panel");

    registerKnownAgentPubkeys(agentsPage, [AGENT_A, AGENT_B]);
    registerKnownAgentPubkeys(profilePanel, [AGENT_C]);

    assert.equal(isKnownAgentPubkey(AGENT_A), true);
    assert.equal(isKnownAgentPubkey(AGENT_B), true);
    assert.equal(isKnownAgentPubkey(AGENT_C), true);

    registerKnownAgentPubkeys(profilePanel, []);

    assert.equal(isKnownAgentPubkey(AGENT_A), true);
    assert.equal(isKnownAgentPubkey(AGENT_B), true);
    assert.equal(isKnownAgentPubkey(AGENT_C), false);

    unregisterKnownAgentPubkeys(agentsPage);

    assert.equal(isKnownAgentPubkey(AGENT_A), false);
    assert.equal(isKnownAgentPubkey(AGENT_B), false);
  });
});
