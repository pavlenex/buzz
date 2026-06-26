#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLA2TOOLS_JAR="${TLA2TOOLS_JAR:-$ROOT/.scratch/proof-check/tla2tools.jar}"
TAMARIN_PROVER="${TAMARIN_PROVER:-tamarin-prover}"

if [[ ! -f "$TLA2TOOLS_JAR" ]]; then
  echo "TLA2TOOLS_JAR does not point to a readable jar: $TLA2TOOLS_JAR" >&2
  exit 1
fi

cd "$ROOT"

echo "==> TLC: docs/spec/MultiTenantRelay.tla"
java -XX:+UseParallelGC \
  -cp "$TLA2TOOLS_JAR" \
  tlc2.TLC \
  -workers auto \
  -config docs/spec/MultiTenantRelay.cfg \
  docs/spec/MultiTenantRelay.tla

echo "==> Tamarin: docs/spec/MultiTenantAuth.spthy"
"$TAMARIN_PROVER" --prove docs/spec/MultiTenantAuth.spthy
