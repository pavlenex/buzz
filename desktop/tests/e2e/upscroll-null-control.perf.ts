import { test } from "@playwright/test";

/**
 * NULL CONTROL for the portable upscroll classifier.
 *
 * WHY (thread c62888de, Eva's fixture-floor concern). Across four wildly
 * different timeline architectures — main, broken Virtuoso, one-writer
 * Virtuoso, transform-positioned TanStack with a no-op scrollToFn — the
 * portable classifier scored post-momentum bite ≈21–26 at bite-max EXACTLY
 * 60.0px, every impl, every engine, every session. Three different scroll
 * mechanisms producing one identical signature is more consistent with the
 * fixture's own synthetic wheel drive manufacturing a fixed quantum on the
 * coalesced still frame than with every candidate coincidentally failing the
 * same way. If so, "bites → 0" is unreachable BY CONSTRUCTION and the bite
 * column measures the instrument, not the impl.
 *
 * THE PROBE. Run the IDENTICAL sampler + wheel drive + reversal/bite scorer
 * (copied verbatim from the frozen classifier @ 5e5bd4a5) against a page with
 * NOTHING to anchor: a plain overflow:auto div, 500 fixed-height rows carrying
 * data-message-id, overflow-anchor:none, zero JS writers, zero virtualization,
 * zero React, zero framework. There is no impl here — only the browser's native
 * scroll and the fixture's own wheel drive.
 *
 *   • Null scores ~0 bites  → floor theory dead, the discriminator is sound, and
 *     the identical candidate numbers are a REAL shared failure (a finding: the
 *     class is engine-level, not impl-level).
 *   • Null scores ~20 @ 60  → the bite is the wheel QUEUE discharging on the
 *     coalesced catch-up frame, below the impl layer entirely. The co-gate must
 *     recalibrate to delta-below-this-floor; every bite-based verdict re-reads.
 *
 * Same selectors as the real fixture (data-testid="message-timeline" scroller,
 * [data-message-id] rows) so the sampler/scorer run byte-identical — the only
 * thing swapped is the target.
 */

const SEED_ROWS = 500;
const ROW_H = 72; // fixed height — no estimator, no reflow, no measurement loop
const WHEEL_DELTA = 12; // px/event — IDENTICAL to the classifier drive
const WHEEL_PERIOD_MS = 32; // ~375px/s — IDENTICAL
const DURATION_MS = 12_000; // IDENTICAL
const SAFE_MARGIN = 100; // IDENTICAL
const REVERSAL_PX = 3; // IDENTICAL
const ABOVE_EPS = 1; // IDENTICAL
const MOMENTUM_PX = 8; // IDENTICAL
const POST_MOMENTUM_FRAMES = 3; // IDENTICAL

type Frame = {
  t: number;
  top: number | null;
  offsetTop: number;
  scrollTop: number;
  rowId: string | null;
};

test("NULL CONTROL: bite floor of the synthetic wheel drive on plain overflow:auto", async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);

  // Static page — no app, no bridge, no framework. A plain scroll container and
  // fixed rows, nothing that could anchor, compensate, virtualize, or write.
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;height:100%;}
  [data-testid="message-timeline"]{
    height:100vh; overflow:auto; overflow-anchor:none;
  }
  .row{ box-sizing:border-box; height:${ROW_H}px; padding:8px 12px;
        border-bottom:1px solid #ddd; font:14px/1.4 system-ui; }
</style></head>
<body>
  <div data-testid="message-timeline">
    ${Array.from(
      { length: SEED_ROWS },
      (_unused, i) =>
        `<div class="row" data-message-id="null-${i}">row ${i}</div>`,
    ).join("")}
  </div>
</body></html>`);

  const timeline = page.getByTestId("message-timeline");

  // Pin to bottom, then run the IDENTICAL sampler as the classifier.
  await timeline.evaluate((element) => {
    const el = element as HTMLDivElement;
    el.style.overflowAnchor = "none";
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await timeline.hover();

  await timeline.evaluate((element, margin: number) => {
    const el = element as HTMLDivElement;
    const w = window as unknown as {
      __PCLASS__: { frames: Frame[]; stop: boolean };
    };
    type Frame = {
      t: number;
      top: number | null;
      offsetTop: number;
      scrollTop: number;
      rowId: string | null;
    };
    w.__PCLASS__ = { frames: [], stop: false };
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
      if (w.__PCLASS__.stop) return;
      let top: number | null = null;
      let offsetTop = 0;
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
          offsetTop = row.offsetTop;
        }
      }
      if (top === null) trackedId = pick();
      w.__PCLASS__.frames.push({
        t,
        top,
        offsetTop,
        scrollTop: el.scrollTop,
        rowId: trackedId,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SAFE_MARGIN);

  const started = Date.now();
  while (Date.now() - started < DURATION_MS) {
    await page.mouse.wheel(0, -WHEEL_DELTA);
    await page.waitForTimeout(WHEEL_PERIOD_MS);
  }

  const frames: Frame[] = await timeline.evaluate(() => {
    const w = window as unknown as {
      __PCLASS__: { frames: Frame[]; stop: boolean };
    };
    w.__PCLASS__.stop = true;
    return w.__PCLASS__.frames;
  });

  // Scorer — copied verbatim from the frozen classifier.
  type Cause = "reflow-driven" | "tracking-failure";
  let scored = 0;
  const reversals: Array<{
    i: number;
    rowMove: number;
    dScroll: number;
    aboveDelta: number;
    cause: Cause;
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
      continue;
    }
    scored += 1;
    const rowMove = b.top - a.top;
    if (rowMove > -REVERSAL_PX) continue;
    const dScroll = b.scrollTop - a.scrollTop;
    const aboveDelta = b.offsetTop - a.offsetTop;
    const cause: Cause =
      Math.abs(aboveDelta) > ABOVE_EPS ? "reflow-driven" : "tracking-failure";
    reversals.push({ i, rowMove, dScroll, aboveDelta, cause });
  }

  const maxReversalPx =
    reversals.length === 0
      ? 0
      : Math.max(...reversals.map((r) => Math.abs(r.rowMove)));
  const stillFrame = reversals.filter((r) => Math.abs(r.dScroll) < REVERSAL_PX);
  const hadRecentMomentum = (frameIndex: number): boolean => {
    for (
      let j = frameIndex - 1;
      j >= Math.max(1, frameIndex - POST_MOMENTUM_FRAMES);
      j -= 1
    ) {
      const d = Math.abs(frames[j].scrollTop - frames[j - 1].scrollTop);
      if (d >= MOMENTUM_PX) return true;
    }
    return false;
  };
  const postMomentumBite = reversals.filter(
    (r) =>
      r.cause === "tracking-failure" &&
      Math.abs(r.dScroll) < REVERSAL_PX &&
      hadRecentMomentum(r.i),
  );
  const postMomentumBiteMaxPx =
    postMomentumBite.length === 0
      ? 0
      : Math.max(...postMomentumBite.map((r) => Math.abs(r.rowMove)));
  const midMomentumFight = reversals.filter(
    (r) => Math.abs(r.dScroll) >= MOMENTUM_PX && r.cause === "tracking-failure",
  );

  // CONFOUND GUARD: the bite gate can only fire on a still frame trailing a
  // momentum frame. If the null page produced NO momentum frames and NO still
  // frames, "0 bites" would be vacuous (empty window) rather than a real floor
  // of 0. Emit both so the zero is legible: a null with a healthy momentum+still
  // frame population AND 0 bites is a TRUE floor-of-0; a null with no such frames
  // is inconclusive on the instrument.
  let momentumFrames = 0;
  let stillFrames = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const d = Math.abs(frames[i].scrollTop - frames[i - 1].scrollTop);
    if (d >= MOMENTUM_PX) momentumFrames += 1;
    if (d < REVERSAL_PX) stillFrames += 1;
  }

  /* eslint-disable no-console */
  console.log("\n=== NULL CONTROL (plain overflow:auto, zero writers) ===");
  console.log(`engine:                 ${browserName}`);
  console.log(`frames sampled:         ${frames.length}`);
  console.log(`frame-pairs scored:     ${scored}`);
  console.log(`reversal frames:        ${reversals.length}`);
  console.log(`  of which still-frame: ${stillFrame.length}`);
  console.log(`max reversal px:        ${maxReversalPx.toFixed(1)}`);
  console.log(
    `TRACKING-FAILURE:       ${reversals.filter((r) => r.cause === "tracking-failure").length}`,
  );
  console.log(
    `REFLOW-DRIVEN:          ${reversals.filter((r) => r.cause === "reflow-driven").length}`,
  );
  console.log(`mid-momentum jerks:     ${midMomentumFight.length}`);
  console.log(`momentum frames:        ${momentumFrames}`);
  console.log(`still frames:           ${stillFrames}`);
  console.log(
    `POST-momentum bite:     ${postMomentumBite.length}  (bite-set max px: ${postMomentumBiteMaxPx.toFixed(1)})`,
  );
  // PRE-REGISTERED (Eva, thread c62888de): the raw per-bite |rowMove| histogram
  // is the discriminator between "wheel queue discharge" (bites are exact
  // multiples of WHEEL_DELTA=12 → 12/24/36/48/60) and "some other forcing that
  // caps at 60". On a STATIC null page there is no layout motion to add a
  // sub-quantum, so if the floor is wheel-queue every bite must be ≡ 0 mod 12.
  // Non-12 values here would falsify the wheel-queue mechanism.
  const biteVals = postMomentumBite
    .map((r) => Math.round(Math.abs(r.rowMove)))
    .sort((a, b) => a - b);
  const hist = new Map<number, number>();
  for (const v of biteVals) hist.set(v, (hist.get(v) ?? 0) + 1);
  const nonMultiplesOf12 = biteVals.filter((v) => v % WHEEL_DELTA !== 0);
  console.log(
    `  bite |rowMove| histogram: ${[...hist.entries()]
      .map(([px, n]) => `${px}px×${n}`)
      .join("  ")}`,
  );
  console.log(`  bite raw values:          [${biteVals.join(", ")}]`);
  console.log(
    `  ≡0 mod ${WHEEL_DELTA}? ${
      biteVals.length === 0
        ? "N/A — zero bites (see floor reading below)"
        : nonMultiplesOf12.length === 0
          ? "ALL bites are 12-multiples (wheel-queue mechanism holds for the cap)"
          : `NO — non-multiples present: [${nonMultiplesOf12.join(", ")}] (wheel-queue mechanism falsified)`
    }`,
  );
  console.log(
    biteVals.length === 0 && (momentumFrames > 20 || stillFrames > 20)
      ? "  FLOOR READING: healthy momentum+still-frame population, ZERO bites — TRUE floor-of-0 (not a vacuous empty window). The bite signature requires an impl; native scroll alone produces none."
      : "  FLOOR READING: inspect momentum/still counts above before trusting the bite total.",
  );
  console.log("=======================================================\n");
  /* eslint-enable no-console */
});
