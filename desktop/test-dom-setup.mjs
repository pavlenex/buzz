// DOM test bootstrap for the (b)-lite net. Imported via `--import` so it runs
// before any test module loads:
//   1. install a jsdom `window`/`document`/etc. into globalThis (global-jsdom)
//   2. register the JSX/TSX-transforming module loader
//
// Scope is deliberately thin: just enough DOM to render React components and
// exercise the virtualized scroll path. jsdom has no layout engine, so it does
// NOT cover react-virtual's real measurement/scroll math — those stay on the
// manual/visual verification pass. See FEASIBILITY.md.

import "global-jsdom/register";

import { register } from "node:module";

register("./test-dom-loader-hooks.mjs", import.meta.url);
