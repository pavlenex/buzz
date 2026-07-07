# Buzz Documentation

> **Status: skeleton — Phase 1 (structure).** Stub pages carry per-page outlines and
> source-material pointers; content lands in Phase 2.

## Getting Started

- [Installation](getting-started/installation.md)
- [Quickstart](getting-started/quickstart.md)
- [Running a Local Relay](getting-started/local-relay.md)

## Architecture

- [Overview](architecture/overview.md)
- [Protocol](architecture/protocol.md)
- [Connection Lifecycle](architecture/connection-lifecycle.md)
- [Event Pipeline](architecture/event-pipeline.md)
- [Subscription System](architecture/subscriptions.md)
- [Crate Reference](architecture/crates.md)
- [Security Model](architecture/security-model.md)
- [Infrastructure](architecture/infrastructure.md)

## Guides

- [Development](guides/development.md)
- [Testing](guides/testing.md)
- [Working with Agents](guides/agents.md)
- [Workflows](guides/workflows.md)
- [Self-Hosting](guides/self-hosting.md)
- [Using Third-Party Nostr Clients](guides/nostr-clients.md)
- [Adding a New Event Kind](guides/adding-event-kinds.md)
- [Adding a New API Endpoint](guides/adding-api-endpoints.md)
- [Releasing](guides/releasing.md)

## Reference

- [CLI Reference](reference/cli.md)
- [Configuration](reference/configuration.md)
- [Known Limitations](reference/known-limitations.md)
- [Buzz NIPs Index](reference/nips.md) → [`nips/`](nips/)
- [Design Documents Index](reference/design-docs.md) → loose docs + [`spec/`](spec/)

## Vision

- [Vision](vision/README.md) — aspirational direction, **not** current behavior

## Root-Level Docs (stay at repository root)

GitHub-convention files remain at the root: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`GOVERNANCE.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `AGENTS.md`/`CLAUDE.md`.

`ARCHITECTURE.md`, `NOSTR.md`, `TESTING.md`, `RELEASING.md`, and `VISION*.md` are being
migrated into this tree. In Phase 2 they will be reduced to pointer files once their
content has moved; they are untouched in Phase 1.

## Note on file locations

`docs/nips/`, `docs/spec/`, and the loose design docs (`docs/*.md`) are referenced by
code, tests, and migrations (55 references outside `docs/`). They stay at their current
paths; the `reference/` index pages link to them instead.
