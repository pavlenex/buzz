# CLI Reference

> **Status: stub — Phase 1 (structure).** Content to be written in Phase 2.
>
> **Scope:** Command-by-command reference for the `buzz` CLI, derived from --help output and verified against `crates/buzz-cli` source (README has known drift).

## Outline

- Global flags, env vars (BUZZ_RELAY_URL, BUZZ_PRIVATE_KEY, BUZZ_AUTH_TAG), exit codes
- Command groups: messages, channels, canvas, reactions, dms, users, workflows, feed, social, repos, upload, mem
- Examples per group

## Source material

- `buzz --help` and per-group `--help` (primary)
- `crates/buzz-cli/src/` (verify — do not trust `crates/buzz-cli/README.md`)
