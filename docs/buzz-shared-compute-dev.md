# Buzz shared compute: local GUI verification

This runbook verifies the actual desktop path used by the built-in **Fizz** agent:

`Buzz Desktop → buzz-acp → buzz-agent → MeshLLM SDK → local/remote compute`

It does not use a substitute agent harness.

## Before starting

Run from the `block/buzz` repository root on the mesh-enabled branch.

Free the development ports if a previous run was interrupted:

```bash
lsof -nP -iTCP:3000 -iTCP:8080 -iTCP:9102 -iTCP:9337 -iTCP:3131
```

Stop only stale Buzz/MeshLLM processes shown by that command. Do not leave a
standalone `mesh-llm` process using `9337` or `3131`; the desktop owns those
ports during this test.

## 1. Launch the mesh-enabled desktop

```bash
. ./bin/activate-hermit
just mesh=1 dev
```

Keep that terminal open. The first run may build/install the native runtime and
take several minutes. Wait for the Buzz window to open and for the terminal to
stop printing build progress.

Using plain `just dev` is not sufficient: the Compute UI and embedded MeshLLM
runtime are behind the `mesh-llm` feature.

## 2. Share this machine

1. Open **Settings**.
2. Select **Compute**.
3. Under **Share compute**, choose a suggested model.
   - Prefer `Gemma-4-E4B-it-Q4_K_M` when it is suggested; it passes repeated
     real-hardware Fizz publication, ordinary chat, and file-tool checks.
   - `Qwen3-8B-Q4_K_M` is the verified fallback. Models smaller than these may
     chat successfully but are not recommended for Fizz's structured tool use.
4. Turn on **Share this machine**.
5. Wait until the card says it is sharing/running. Do not start Fizz while the
   card says downloading, preparing, or starting.

Buzz may download the model on first use. The model picker ranks models for the
current hardware; avoid entering a model the card marks too large.

## 3. Make shared compute the agent default

1. Open **Agents** from the left sidebar.
2. In **Agent defaults**, set **Default LLM provider** to
   **Buzz shared compute**.
3. Set **Default model** to **Default (auto)**.
4. Click **Save defaults** and wait for **Saved**.

Fizz has no pinned runtime/provider/model, so it inherits these defaults and
resolves to the bundled `buzz-agent`. No API key is required.

## 4. Start the real Fizz path

1. Find the **Fizz** card on the Agents screen.
2. If Fizz is stopped, click the small play badge over its avatar. If it is
   running, the badge is a green status dot instead of a stop control.
3. Wait for its runtime indicator to become active.
4. Add Fizz to a channel if it is not already a channel member.
5. In that channel, send:

   ```text
   @Fizz Reply exactly: FIZZ_MESH_OK
   ```

6. Confirm that Fizz replies `FIZZ_MESH_OK` in the channel.

That channel response is the end-to-end proof. A green Compute card alone proves
only model serving; it does not prove the Fizz harness and provider inheritance.

To stop a running agent, click the body/name of its card to open its profile,
then click **Stop** near the top. The green avatar badge is status-only while the
agent is running. Once stopped, the profile action becomes **Respawn** and the
avatar badge becomes a play button.

To create a separate test agent, choose **New agent → New agent**, use
**buzz-agent** as the runtime, **Buzz shared compute** as the LLM provider,
**Default (auto)** as the model, and **This computer** under **Run on**. Shared
compute is an LLM provider; do not select a remote compute backend as the run
location merely because its name mentions mesh.

## 5. Optional diagnostics

While Buzz is running:

```bash
# The desktop should own both ports.
lsof -nP -iTCP:9337 -iTCP:3131

# The embedded OpenAI-compatible ingress should advertise the model.
curl -sS http://127.0.0.1:9337/v1/models | jq '.data[].id'

# Fizz should resolve through the real managed-agent subprocesses.
ps -eo pid,ppid,command | grep -E '[b]uzz-(desktop|acp|agent)'
```

If Fizz fails, open its runtime details from the Agents screen first. Common
causes are:

- launched with `just dev` instead of `just mesh=1 dev`;
- a stale process owns `9337`/`3131`;
- the model is still downloading or preparing;
- Fizz is not a member of the channel;
- defaults were changed but not saved;
- no current Buzz membership snapshot is available (admission fails closed).

## Security boundary

Buzz publishes member-signed discovery notes through an ordinary relay-supported
NIP-51 event. The note includes a MeshLLM-key signature binding the member to the
advertised MeshLLM owner identity. Current Buzz membership controls which owner
identities are admitted and which serving targets are selectable.

MeshLLM—not the Buzz relay—carries inference over direct QUIC or its encrypted
iroh relays and enforces the owner allowlist. The dependency is pinned to the
post-v0.72.2 admission fix that prevents a non-member with a leaked invite token
from using passive inference streams.
