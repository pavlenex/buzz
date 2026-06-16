import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

// Smoke test that proves the (b)-lite DOM net is wired: jsdom globals exist,
// esbuild transforms TSX, React renders into the document, and Testing Library
// can query it. The real virtualized-scroll DOM tests build on this lane.
function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}!</p>;
}

test("DOM harness: jsdom + esbuild + testing-library render a component", () => {
  render(<Greeting name="Springfield" />);
  assert.ok(screen.getByText("Hello, Springfield!"));
});
