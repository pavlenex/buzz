import assert from "node:assert/strict";
import test from "node:test";

import {
  canSubmitPersonaDialog,
  createPersonaDialogState,
  duplicatePersonaDialogState,
  editPersonaDialogState,
  importPersonaDialogState,
  saveAsPersonaTemplateDialogState,
} from "./personaDialogState.ts";

// Minimal ManagedAgent fixture — only the fields the save-as mapping reads.
function makeManagedAgent(overrides = {}) {
  return {
    pubkey: "agentpub",
    name: "Helper",
    personaId: null,
    relayUrl: "wss://relay",
    acpCommand: "goose",
    agentCommand: "/usr/local/bin/goose",
    agentCommandOverride: null,
    agentArgs: [],
    mcpCommand: "",
    turnTimeoutSeconds: 0,
    idleTimeoutSeconds: null,
    maxTurnDurationSeconds: null,
    parallelism: 1,
    systemPrompt: "Be helpful.",
    model: "claude-sonnet",
    provider: "anthropic",
    personaOutOfDate: false,
    personaOrphaned: false,
    mcpToolsets: null,
    envVars: { ANTHROPIC_API_KEY: "sk-test" },
    ...overrides,
  };
}

function makeRuntime(overrides = {}) {
  return {
    id: "goose",
    label: "Goose",
    avatarUrl: "",
    availability: "available",
    command: "goose",
    binaryPath: "/usr/local/bin/goose",
    defaultArgs: [],
    mcpCommand: null,
    installHint: "",
    installInstructionsUrl: "",
    canAutoInstall: false,
    underlyingCliPath: null,
    ...overrides,
  };
}

test("canSubmitPersonaDialog requires a display name but not a system prompt", () => {
  // Empty system prompt is allowed: core memory is auto-injected, so the
  // persona prompt is optional. Only the display name gates submission.
  assert.equal(
    canSubmitPersonaDialog({ displayName: "Coder", isPending: false }),
    true,
  );
  assert.equal(
    canSubmitPersonaDialog({ displayName: "  Coder  ", isPending: false }),
    true,
  );
});

test("canSubmitPersonaDialog blocks an empty or whitespace display name", () => {
  assert.equal(
    canSubmitPersonaDialog({ displayName: "", isPending: false }),
    false,
  );
  assert.equal(
    canSubmitPersonaDialog({ displayName: "   ", isPending: false }),
    false,
  );
});

test("canSubmitPersonaDialog blocks while a save is pending", () => {
  assert.equal(
    canSubmitPersonaDialog({ displayName: "Coder", isPending: true }),
    false,
  );
});

test("createPersonaDialogState returns a fresh empty draft", () => {
  const first = createPersonaDialogState();
  const second = createPersonaDialogState();

  assert.equal(first.title, "Create persona");
  assert.deepEqual(first.initialValues, {
    displayName: "",
    avatarUrl: "",
    systemPrompt: "",
    runtime: undefined,
    model: undefined,
  });
  assert.notStrictEqual(first.initialValues, second.initialValues);
});

test("duplicatePersonaDialogState copies persona fields into a new draft", () => {
  const state = duplicatePersonaDialogState({
    id: "persona-1",
    displayName: "Solo",
    avatarUrl: "avatar://solo",
    systemPrompt: "Be direct.",
    runtime: "provider-a",
    model: "model-a",
    provider: null,
    isBuiltIn: false,
    isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.deepEqual(state.initialValues, {
    displayName: "Solo copy",
    avatarUrl: "avatar://solo",
    systemPrompt: "Be direct.",
    runtime: "provider-a",
    model: "model-a",
    provider: undefined,
    namePool: [],
    envVars: {},
  });
});

test("duplicatePersonaDialogState carries envVars and namePool into the duplicate", () => {
  // Regression: codex R10 P2. Without this, a duplicated persona that
  // relies on an API key in env_vars would silently fail at spawn until
  // the user re-entered every credential.
  const state = duplicatePersonaDialogState({
    id: "persona-with-secrets",
    displayName: "Coder",
    avatarUrl: null,
    systemPrompt: "Write code.",
    runtime: null,
    model: null,
    isBuiltIn: false,
    isActive: true,
    namePool: ["alice", "bob"],
    envVars: { ANTHROPIC_API_KEY: "sk-test", GOOSE_PROVIDER: "anthropic" },
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.deepEqual(state.initialValues.envVars, {
    ANTHROPIC_API_KEY: "sk-test",
    GOOSE_PROVIDER: "anthropic",
  });
  assert.deepEqual(state.initialValues.namePool, ["alice", "bob"]);
});

test("editPersonaDialogState preserves the persona id for updates", () => {
  const state = editPersonaDialogState({
    id: "persona-2",
    displayName: "Kit",
    avatarUrl: null,
    systemPrompt: "Keep it weird.",
    runtime: null,
    model: null,
    provider: null,
    isBuiltIn: true,
    isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.equal(state.title, "Edit persona");
  assert.equal(state.description, "");
  assert.equal(state.submitLabel, "Save changes");
  assert.deepEqual(state.initialValues, {
    id: "persona-2",
    displayName: "Kit",
    avatarUrl: "",
    systemPrompt: "Keep it weird.",
    runtime: undefined,
    model: undefined,
    provider: undefined,
    namePool: [],
    envVars: {},
  });
});

test("editPersonaDialogState seeds envVars and namePool from the persona", () => {
  const state = editPersonaDialogState({
    id: "persona-3",
    displayName: "Coder",
    avatarUrl: null,
    systemPrompt: "Write code.",
    runtime: null,
    model: null,
    isBuiltIn: false,
    isActive: true,
    namePool: ["alice", "bob"],
    envVars: { ANTHROPIC_API_KEY: "sk-test" },
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.deepEqual(state.initialValues.envVars, {
    ANTHROPIC_API_KEY: "sk-test",
  });
  assert.deepEqual(state.initialValues.namePool, ["alice", "bob"]);
});

test("importPersonaDialogState maps parsed persona previews into create drafts", () => {
  const state = importPersonaDialogState({
    displayName: "Imported",
    avatarDataUrl: null,
    systemPrompt: "Imported prompt",
    runtime: null,
    model: "model-b",
    provider: null,
    namePool: [],
    sourceFile: "import.persona.json",
  });

  assert.equal(state.title, "Import Imported");
  assert.deepEqual(state.initialValues, {
    displayName: "Imported",
    avatarUrl: "",
    systemPrompt: "Imported prompt",
    runtime: undefined,
    model: "model-b",
    provider: undefined,
  });
});

test("editPersonaDialogState preserves provider=databricks", () => {
  const state = editPersonaDialogState({
    id: "persona-provider",
    displayName: "DB Agent",
    avatarUrl: null,
    systemPrompt: "Use databricks.",
    runtime: "goose",
    model: "dbrx",
    provider: "databricks",
    isBuiltIn: false,
    isActive: true,
    namePool: [],
    envVars: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.equal(state.initialValues.provider, "databricks");
});

test("editPersonaDialogState maps provider=null to undefined", () => {
  const state = editPersonaDialogState({
    id: "persona-no-provider",
    displayName: "Plain",
    avatarUrl: null,
    systemPrompt: "No provider.",
    runtime: null,
    model: null,
    provider: null,
    isBuiltIn: false,
    isActive: true,
    namePool: [],
    envVars: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.equal(state.initialValues.provider, undefined);
});

test("duplicatePersonaDialogState preserves provider=databricks", () => {
  const state = duplicatePersonaDialogState({
    id: "persona-dup-provider",
    displayName: "DB Agent",
    avatarUrl: null,
    systemPrompt: "Use databricks.",
    runtime: "goose",
    model: "dbrx",
    provider: "databricks",
    isBuiltIn: false,
    isActive: true,
    namePool: [],
    envVars: {},
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  assert.equal(state.initialValues.provider, "databricks");
});

test("importPersonaDialogState preserves provider=anthropic", () => {
  const state = importPersonaDialogState({
    displayName: "Imported With Provider",
    avatarDataUrl: null,
    systemPrompt: "Anthropic agent.",
    runtime: "goose",
    model: "claude-sonnet",
    provider: "anthropic",
    namePool: [],
    sourceFile: "provider-test.persona.json",
  });

  assert.equal(state.initialValues.provider, "anthropic");
});

test("saveAsPersonaTemplateDialogState carries agent config into a create draft", () => {
  const state = saveAsPersonaTemplateDialogState(makeManagedAgent(), [
    makeRuntime(),
  ]);

  assert.equal(state.title, "Save as persona template");
  assert.equal(state.submitLabel, "Save as persona template");
  assert.equal(state.description, "Reuse this setup to create more agents.");
  assert.deepEqual(state.initialValues, {
    displayName: "Helper",
    avatarUrl: "",
    systemPrompt: "Be helpful.",
    // Reverse-mapped from agentCommand basename → matching runtime id.
    runtime: "goose",
    model: "claude-sonnet",
    provider: "anthropic",
    // Persona-only field starts empty; the user fills it in the dialog.
    namePool: [],
    envVars: { ANTHROPIC_API_KEY: "sk-test" },
  });
});

test("saveAsPersonaTemplateDialogState reverse-maps the runtime by command basename", () => {
  // Agent's resolved command is an absolute path; the runtime exposes a bare
  // command. commandsMatch normalizes on basename, so they should still pair.
  const state = saveAsPersonaTemplateDialogState(
    makeManagedAgent({ agentCommand: "/opt/homebrew/bin/goose" }),
    [makeRuntime({ id: "goose-runtime", command: "goose" })],
  );

  assert.equal(state.initialValues.runtime, "goose-runtime");
});

test("saveAsPersonaTemplateDialogState falls back to undefined runtime when none match", () => {
  // No runtime matches the agent command, or runtimes not loaded yet — the
  // dialog then uses its own default-runtime behavior.
  const noMatch = saveAsPersonaTemplateDialogState(
    makeManagedAgent({ agentCommand: "claude-code-acp" }),
    [makeRuntime({ command: "goose" })],
  );
  assert.equal(noMatch.initialValues.runtime, undefined);

  const noRuntimes = saveAsPersonaTemplateDialogState(makeManagedAgent(), []);
  assert.equal(noRuntimes.initialValues.runtime, undefined);
});

test("saveAsPersonaTemplateDialogState skips runtimes with a null command", () => {
  // Catalog entries can be unavailable (command: null). Those must not throw
  // and must not match — only resolvable commands participate in the map.
  const state = saveAsPersonaTemplateDialogState(makeManagedAgent(), [
    makeRuntime({ id: "uninstalled", command: null, availability: "missing" }),
    makeRuntime({ id: "goose", command: "goose" }),
  ]);

  assert.equal(state.initialValues.runtime, "goose");
});

test("saveAsPersonaTemplateDialogState maps a null provider/model/systemPrompt to undefined/empty", () => {
  const state = saveAsPersonaTemplateDialogState(
    makeManagedAgent({ provider: null, model: null, systemPrompt: null }),
    [],
  );

  assert.equal(state.initialValues.provider, undefined);
  assert.equal(state.initialValues.model, undefined);
  assert.equal(state.initialValues.systemPrompt, "");
});

test("default managed-agent create stays persona-less (no personaId set)", () => {
  // Part 1 regression guard. A default agent create must not carry a
  // personaId — that linkage only exists when a persona/template is chosen.
  // The save-as flow promotes an existing agent INTO a template; it never
  // back-fills personaId onto the source agent.
  const agent = makeManagedAgent();
  assert.equal(agent.personaId, null);

  // The promote produces a CreatePersonaInput (no agent personaId mutation),
  // and a persona-create draft has no personaId field at all.
  const state = saveAsPersonaTemplateDialogState(agent, []);
  assert.equal("personaId" in state.initialValues, false);
});
