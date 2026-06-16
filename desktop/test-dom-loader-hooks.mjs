// DOM test loader — extends the pure-logic resolver in `test-loader-hooks.mjs`
// with a `load` hook so JSX/TSX components can be rendered under jsdom.
//
// The default `pnpm test` lane (node --test over *.test.mjs) runs pure logic and
// imports .ts via `--experimental-strip-types`, which strips types but does NOT
// transform JSX. The DOM lane needs real component rendering, so it routes .ts
// and .tsx through esbuild (TS + JSX -> JS, automatic React runtime). This keeps
// the net thin: one transform dep, no second test runner.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const srcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "src",
);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Extensionless `@/` and relative specifiers resolve .tsx first (components),
// then fall back to .ts (logic) — so both lanes of source resolve under jsdom.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@features-manifest") {
    const resolved = path.join(repoRoot, "preview-features.json");
    return nextResolve(resolved, context);
  }
  if (specifier.startsWith("@/")) {
    const stripped = specifier.slice(2);
    if (path.extname(stripped)) {
      return nextResolve(`${srcRoot}/${stripped}`, context);
    }
    return nextResolve(`${srcRoot}/${stripped}.tsx`, context).catch(() =>
      nextResolve(`${srcRoot}/${stripped}.ts`, context),
    );
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !path.extname(specifier) &&
    context.parentURL
  ) {
    const tsx = new URL(`${specifier}.tsx`, context.parentURL).href;
    return nextResolve(tsx, context).catch(() =>
      nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context),
    );
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const filename = fileURLToPath(url);
    const source = await readFile(filename, "utf8");
    const { code } = await transform(source, {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      jsx: "automatic",
      format: "esm",
      target: "es2022",
      sourcemap: "inline",
      sourcefile: filename,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
