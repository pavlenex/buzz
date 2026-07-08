#!/usr/bin/env node
// Generates desktop/src/shared/constants/kinds.generated.ts from
// crates/buzz-core/src/kind.rs — the authoritative Buzz kind registry.
//
// Usage:
//   node scripts/generate-kinds.mjs            # write the generated file
//   node scripts/generate-kinds.mjs --check    # fail (exit 1) if the committed
//                                              # file differs from regenerated
//                                              # output (drift or hand-edits)
//
// kind.rs is read-only input; never edit it from here. Output is byte-stable:
// constants are emitted in kind.rs source order with the first doc-comment
// line carried over.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(desktopDir);
const sourcePath = join(repoRoot, "crates", "buzz-core", "src", "kind.rs");
const outputPath = join(
  desktopDir,
  "src",
  "shared",
  "constants",
  "kinds.generated.ts",
);

function parseKinds(rustSource) {
  const lines = rustSource.split("\n");
  const kinds = [];
  let docFirstLine = null;
  for (const line of lines) {
    const doc = line.match(/^\s*\/\/\/\s?(.*)$/);
    if (doc) {
      // Keep only the first line of each doc block as the TS comment.
      if (docFirstLine === null) docFirstLine = doc[1].trim();
      continue;
    }
    const konst = line.match(/^pub const (KIND_\w+): u32 = (\d+);/);
    if (konst) {
      kinds.push({ name: konst[1], value: konst[2], doc: docFirstLine });
      docFirstLine = null;
      continue;
    }
    // Any non-doc line (blank, attribute, other item) ends a doc block.
    docFirstLine = null;
  }
  return kinds;
}

function render(kinds) {
  const header = `// GENERATED FILE — DO NOT EDIT.
//
// Generated from crates/buzz-core/src/kind.rs (the authoritative Buzz kind
// registry) by desktop/scripts/generate-kinds.mjs. To change a kind number or
// add a kind, edit kind.rs and re-run:
//
//   node scripts/generate-kinds.mjs
//
// CI runs \`node scripts/generate-kinds.mjs --check\` (via \`pnpm check\`) and
// fails on any drift between this file and kind.rs, including manual edits
// to this file.
`;
  const body = kinds
    .map(({ name, value, doc }) => {
      const comment = doc ? `/** ${doc} */\n` : "";
      return `${comment}export const ${name} = ${value};\n`;
    })
    .join("");
  return `${header}\n${body}`;
}

const kinds = parseKinds(readFileSync(sourcePath, "utf8"));
if (kinds.length === 0) {
  console.error(
    `generate-kinds: parsed 0 constants from ${sourcePath} — parser is broken or kind.rs moved`,
  );
  process.exit(1);
}
const generated = render(kinds);

if (process.argv.includes("--check")) {
  let committed = null;
  try {
    committed = readFileSync(outputPath, "utf8");
  } catch {
    console.error(
      `generate-kinds --check: ${outputPath} is missing; run node scripts/generate-kinds.mjs`,
    );
    process.exit(1);
  }
  if (committed !== generated) {
    console.error(
      "generate-kinds --check: kinds.generated.ts is out of sync with crates/buzz-core/src/kind.rs.\n" +
        "Re-run `node scripts/generate-kinds.mjs` from desktop/ and commit the result.\n" +
        "(If you edited kinds.generated.ts by hand: don't — edit kind.rs instead.)",
    );
    process.exit(1);
  }
  console.log(`generate-kinds --check: OK (${kinds.length} constants in sync)`);
} else {
  writeFileSync(outputPath, generated);
  console.log(
    `generate-kinds: wrote ${kinds.length} constants to ${outputPath}`,
  );
}
