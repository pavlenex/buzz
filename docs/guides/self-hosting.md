# Self-Hosting Buzz

> **Status: stub — Phase 1 (structure).** Content to be written in Phase 2.
>
> **Scope:** Deploying and operating your own relay: Docker Compose VPS bundle, Helm chart, TLS, membership administration, multi-tenancy.

## Outline

- Deployment options overview
- Docker Compose bundle (run.sh, Caddy TLS)
- Kubernetes (Helm chart)
- Relay configuration (env vars)
- Membership + admin (buzz-admin, NIP-43 allowlist)
- Multi-tenant operation (links to design docs/specs)
- Upgrades and backups

## Source material

- `deploy/compose/README.md`, `deploy/charts/buzz/README.md`
- `Dockerfile`, `docker-compose.yml`
- `NOSTR.md` (allowlist/admin operational half)
- `docs/multi-tenant-relay.md`, `docs/multi-tenant-conformance.md` (linked)
- `crates/buzz-admin`
