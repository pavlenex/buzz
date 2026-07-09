import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Slow-scroll characterization leg — Tyler's felt-regime coverage.
 *
 * The W4a gate (`upscroll-raf-correction.perf.ts`) drives a CONSTANT 12px/32ms
 * (~375px/s) upscroll. That is not the regime Tyler reports the residual in: a
 * slow deliberate trackpad gesture moves 2-4px/frame and decays through a
 * momentum tail, and a mid-history correction that is invisible under momentum
 * is 5-7 frames of motion at 2-3px/frame (Eva's characterization, thread
 * event 2de99f4d). This leg drives that regime and CHARACTERIZES the reversal
 * distribution — it does NOT gate a pass/fail ceiling, because the slow-regime
 * floor is exactly what we're measuring. Liveness + stale-`dist` guard only.
 *
 * HONESTY BOUND (flagged in-thread before build): Playwright `mouse.wheel` is a
 * synthetic discrete event. It faithfully reproduces "the correction WRITE as a
 * felt jump" (correction magnitude vs per-frame rendered row motion at low
 * velocity — measured here) but it does NOT reproduce a real trackpad's
 * compositor-coalesced momentum, so the WebKit `dScroll=0.0` coalesced still
 * frame is a real-device phenomenon this fixture cannot manufacture. A green
 * run here means "the correction is not a large felt jump in a low-velocity
 * synthetic gesture" — NOT "reproduces everything Tyler feels."
 */

// Momentum-decay drive: initial slow velocity decaying toward a tail. Each
// wheel event is small (2-4px early, ~1px in the tail) so a correction landing
// mid-gesture is many frames of the eye's motion, not one.
const WHEEL_START_DELTA = 4; // px/event at gesture start (slow deliberate)
const WHEEL_TAIL_DELTA = 1; // px/event in the momentum tail
const DECAY_PER_EVENT = 0.98; // geometric decay toward the tail
const WHEEL_PERIOD_MS = 16; // one event per frame (60fps trackpad cadence)
const DURATION_MS = 12_000;
const SAFE_MARGIN = 100;
// Same reversal definition as the gate: row moving against the scroll by more
// than staircase noise. Upscroll → rowMove normally >= 0, so a genuine
// against-direction move is < -REVERSAL_PX.
const REVERSAL_PX = 3;
// Must equal `ANCHOR_BUILD_STAMP` in `useAnchoredScroll.ts` — stale-`dist`
// guard (see the gate fixture). Bump BOTH together per experiment.
const EXPECTED_BUILD_STAMP = "w4a-ungated-ro-2";

type Frame = {
  t: number;
  top: number | null;
  scrollTop: number;
  mounted: number;
  rowId: string | null;
};

test("W4a slow-scroll: reversal distribution in the felt low-velocity regime", async ({
  page,
  browserName,
}) => {
  await installMockBridge(page);
  page.on("console", (m) => {
    if (m.type() === "error") console.log("PAGE ERROR:", m.text());
  });
  page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", e.message));
  await page.addInitScript(() => {
    (
      globalThis as unknown as { __ANCHOR_PROBE__: unknown[] }
    ).__ANCHOR_PROBE__ = [];
  });
  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function",
  );
  await page.getByTestId("channel-jitter-corpus").click();
  const timeline = page.getByTestId("message-timeline");
  await page.waitForFunction(() => {
    const el = document.querySelector(
      '[data-testid="message-timeline"]',
    ) as HTMLDivElement | null;
    return !!el && el.scrollHeight > el.clientHeight + 1000;
  });

  await timeline.evaluate((element) => {
    const el = element as HTMLDivElement;
    el.style.overflowAnchor = "none";
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await timeline.hover();

  // Per-frame sampler (identical to the gate: one clock, same row-tracking) so
  // the two legs' distributions are directly comparable.
  await timeline.evaluate((element, margin: number) => {
    const el = element as HTMLDivElement;
    const w = window as unknown as {
      __PROBE__: { frames: Frame[]; stop: boolean };
    };
    type Frame = {
      t: number;
      top: number | null;
      scrollTop: number;
      mounted: number;
      rowId: string | null;
    };
    w.__PROBE__ = { frames: [], stop: false };
    let trackedId: string | null = null;
    const pick = (): string | null => {
      const box = el.getBoundingClientRect();
      for (const row of el.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const rect = row.getBoundingClientRect();
        if (rect.top > box.top + margin && rect.bottom < box.bottom - margin) {
          return row.dataset.messageId ?? null;
        }
      }
      return null;
    };
    const tick = (t: number) => {
      if (w.__PROBE__.stop) return;
      const mounted = el.querySelectorAll("[data-message-id]").length;
      let top: number | null = null;
      if (trackedId) {
        const row = el.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(trackedId)}"]`,
        );
        if (row) {
          const rect = row.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          const inBand =
            rect.top > box.top + margin && rect.bottom < box.bottom - margin;
          top = inBand ? rect.top : null;
        }
      }
      if (top === null) trackedId = pick();
      w.__PROBE__.frames.push({
        t,
        top,
        scrollTop: el.scrollTop,
        mounted,
        rowId: trackedId,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SAFE_MARGIN);

  // Momentum-decay drive: velocity decays geometrically from START toward TAIL,
  // so the gesture spends most of its time in the 1-2px/frame regime where a
  // correction is felt. Fractional deltas accumulate a remainder so sub-pixel
  // velocity still produces integer wheel steps at the right average rate.
  const started = Date.now();
  let delta = WHEEL_START_DELTA;
  let remainder = 0;
  while (Date.now() - started < DURATION_MS) {
    remainder += delta;
    const step = Math.max(1, Math.round(remainder));
    remainder -= step;
    await page.mouse.wheel(0, -step);
    await page.waitForTimeout(WHEEL_PERIOD_MS);
    delta = Math.max(WHEEL_TAIL_DELTA, delta * DECAY_PER_EVENT);
  }

  const frames: Frame[] = await timeline.evaluate((_el) => {
    const w = window as unknown as {
      __PROBE__: { frames: Frame[]; stop: boolean };
    };
    type Frame = {
      t: number;
      top: number | null;
      scrollTop: number;
      mounted: number;
      rowId: string | null;
    };
    w.__PROBE__.stop = true;
    return w.__PROBE__.frames;
  });

  const { corrections, buildStamp } = await page.evaluate(() => {
    const g = globalThis as unknown as {
      __ANCHOR_PROBE__?: Array<{
        source: "raf" | "ro";
        wouldFire: boolean;
        residual: number;
      }>;
      __ANCHOR_BUILD_STAMP__?: string;
    };
    return {
      corrections: g.__ANCHOR_PROBE__ ?? [],
      buildStamp: g.__ANCHOR_BUILD_STAMP__ ?? null,
    };
  });

  // Score same-row frame pairs. A reversal is rowMove <= -REVERSAL_PX. Pair each
  // with the per-frame rendered scroll delta (dScroll) so we can see whether a
  // reversal lands on a near-still frame (the felt case) or rides momentum.
  let scored = 0;
  let reanchors = 0;
  const reversals: Array<{
    i: number;
    rowMove: number;
    dScroll: number;
    rowId: string | null;
  }> = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    if (
      a.top === null ||
      b.top === null ||
      a.rowId === null ||
      a.rowId !== b.rowId
    ) {
      reanchors += 1;
      continue;
    }
    scored += 1;
    const rowMove = b.top - a.top;
    const dScroll = b.scrollTop - a.scrollTop;
    if (rowMove <= -REVERSAL_PX) {
      reversals.push({ i, rowMove, dScroll, rowId: b.rowId });
    }
  }

  const maxReversalPx =
    reversals.length === 0
      ? 0
      : Math.max(...reversals.map((r) => Math.abs(r.rowMove)));
  // A reversal on a near-still frame (|dScroll| < REVERSAL_PX) is the felt case:
  // the eye is barely moving, so a backward row snap is maximally visible.
  const stillFrameReversals = reversals.filter(
    (r) => Math.abs(r.dScroll) < REVERSAL_PX,
  );

  /* eslint-disable no-console */
  console.log("\n=== W4a SLOW-SCROLL CHARACTERIZATION ===");
  console.log(`engine:                 ${browserName}`);
  console.log(`build stamp:            ${buildStamp ?? "(absent)"}`);
  console.log(`frames sampled:         ${frames.length}`);
  console.log(`frame-pairs scored:     ${scored}`);
  console.log(`re-anchor/skip frames:  ${reanchors}`);
  console.log(`reversal frames:        ${reversals.length}`);
  console.log(`  of which still-frame: ${stillFrameReversals.length}`);
  console.log(`max reversal px:        ${maxReversalPx.toFixed(1)}`);
  for (const r of reversals
    .slice()
    .sort((x, y) => x.rowMove - y.rowMove)
    .slice(0, 12)) {
    console.log(
      `  frame ${r.i} rowMove=${r.rowMove.toFixed(1)} dScroll=${r.dScroll.toFixed(1)} row=${r.rowId}`,
    );
  }
  console.log("========================================\n");
  /* eslint-enable no-console */

  // Sanity: the actuation actually produced a scored slow upscroll.
  expect(scored).toBeGreaterThan(50);
  // Stale-`dist` guard — a slow-regime characterization on a stale bundle would
  // mislead exactly like a stale gate run. Assert the experiment's stamp ran.
  expect(buildStamp).toBe(EXPECTED_BUILD_STAMP);
  // Liveness: at least one mid-history correction fired, else the corpus
  // realized nothing and the distribution above is vacuous.
  const anyFired = corrections.some((c) => c.wouldFire);
  expect(anyFired).toBe(true);
  // Characterization only — no reversal ceiling asserted. The distribution and
  // still-frame count above are the deliverable; the slow-regime floor is what
  // we are measuring, not gating.
});
