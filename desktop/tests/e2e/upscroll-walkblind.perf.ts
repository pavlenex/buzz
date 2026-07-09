import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Walk-blind reversal DIAGNOSIS — what moves a row one wheel quantum backward
 * that BOTH mid-history instruments read as zero above-anchor shift?
 *
 * WHY THIS EXISTS. Under `w4a-gate-1` the fast corpus leaves 2 bounded WebKit
 * survivors (rows mock-jitter-393/381, −14.5px, one wheel quantum). Sami's
 * arbiter stream (`ffa77bb6`) typed them `source=ro`, `signedShift=0.0`,
 * `renderedScroll=n/a` — the ResizeObserver corrector FIRED but declined to
 * write (`!changed` or `|drift|<=0.5`), and no rAF attempt exists in the window
 * (the rAF re-pick guard `prev.id===cur.id` skipped it). So the reflow that
 * moved the row is invisible to BOTH triggers: the rAF band walk never ran, and
 * the RO's observed-row `changed` gate did not trip. Eva's leg question: which
 * of three mechanisms is it —
 *   (A) the ANCHOR ROW ITSELF realizing (its own height changes; a top-edge
 *       resize moves the row without being an above-anchor reflow),
 *   (B) a STRADDLER outside the walked band (a row crossing the top fold whose
 *       realization shifts everything below it, but sits outside the rAF band or
 *       is not an observed `.timeline-row-cv` height delta the RO counts), or
 *   (C) BELOW-anchor container growth (a row below the anchor grows; should not
 *       move the anchor up — if it is the only change, that is its own puzzle).
 *
 * MEASURED RESULT (webkit, w4a-gate-1, 3 runs). Both survivors reproduce
 * (rows mock-jitter-393/381, rowMove=-14.5, dScroll=0.0, src=ro,
 * signedShift=0.0, fired=false) and the discriminator falsifies ALL FIVE
 * content-reflow candidates: self=0 above=0 below=0 (no same-frame height
 * delta), mount+0/-0 (no membership churn), near=0.0@0 (no height change on any
 * row within +-2 frames). The move is NOT content-driven.
 *
 * The raw scrollTop neighborhood names it. At the reversal frame scrollTop is
 * FROZEN across the reversal (e.g. f138 4970 -> f139 4970 -> f140 4970, then
 * f141 resumes 4958) while the tracked row's top jumps -14.6 on the frozen
 * frame and self-heals when scrollTop resumes. scrollTop advances in exact
 * 12px wheel quanta but WebKit delivers them on ~2 of every 3 rAF frames; the
 * survivor is a COALESCED STILL FRAME where the compositor has already moved
 * the visual layer ~one wheel quantum but `scrollTop` has not yet committed it.
 * `snapshotReadingAnchor` (:210-216) makes the correction scroll-invariant via
 * `scrollTop + topOffset` — an invariant that holds ONLY when both are read
 * from the same committed frame. The desync breaks it: getBoundingClientRect
 * reflects the new visual position, scrollTop the old one, so the sum shifts by
 * the wheel quantum with NO reflow. Both instruments correctly report zero
 * above-anchor reflow (there is none) and the RO's signedShift=0.0 is its
 * `!changed` early-return (:1009-1015, a LITERAL 0 emitted before drift is ever
 * measured — height never changed, so the `changed` gate never trips). The
 * -14.5 class is a WebKit compositor-vs-scroll-model timing artifact on
 * coalesced wheel frames, one quantum, self-healing next committed frame — not
 * a visibility gap in any corrector. Characterization-first (Eva): inside the
 * ratified one-quantum bound; whether it blocks Tyler's build is her ruling.
 *
 * HONESTY BOUND: Playwright `mouse.wheel` is a synthetic discrete event and the
 * WebKit `dScroll=0.0` coalesced still frame is the real-device phenomenon; this
 * reproduces the frames to diagnose, not Tyler's exact trackpad feel.
 */

const WHEEL_DELTA = 12; // px/event — matches the gate's constant velocity
const WHEEL_PERIOD_MS = 32; // gate cadence (~375px/s)
const DURATION_MS = 12_000;
const SAFE_MARGIN = 100;
const REVERSAL_PX = 3;
const EXPECTED_BUILD_STAMP = "w4a-gate-1";
// A row whose height changed by more than this between two frames "realized".
const REALIZE_PX = 1;
// +-frames scanned around a reversal for an adjacent-frame height flush.
const LOOKBACK = 2;

type RowSnap = { top: number; height: number };
type Frame = {
  t: number;
  top: number | null;
  scrollTop: number;
  rowId: string | null;
  probeLen: number;
  // Every mounted row's viewport-relative top + laid-out height this frame,
  // keyed by message id. The reflow-source discriminator reads from this.
  rows: Record<string, RowSnap>;
};

test("W4a walk-blind: diagnose the source of the RO-path survivors", async ({
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

  // Per-frame sampler. Same tracked-row logic as the classifier (pick the first
  // row held SAFE_MARGIN inside the band; keep tracking it until it leaves), PLUS
  // a full per-frame {top,height} snapshot of every mounted row so a reversal can
  // be attributed to whichever rows resized that frame.
  await timeline.evaluate((element, margin: number) => {
    const el = element as HTMLDivElement;
    const w = window as unknown as {
      __PROBE__: { frames: Frame[]; stop: boolean };
    };
    type RowSnap = { top: number; height: number };
    type Frame = {
      t: number;
      top: number | null;
      scrollTop: number;
      rowId: string | null;
      probeLen: number;
      rows: Record<string, RowSnap>;
    };
    const g = globalThis as unknown as { __ANCHOR_PROBE__?: unknown[] };
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
      const box = el.getBoundingClientRect();
      const rows: Record<string, RowSnap> = {};
      for (const row of el.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const id = row.dataset.messageId;
        if (!id) continue;
        const rect = row.getBoundingClientRect();
        rows[id] = { top: rect.top - box.top, height: rect.height };
      }
      let top: number | null = null;
      if (trackedId) {
        const snap = rows[trackedId];
        if (snap) {
          const inBand =
            snap.top > margin && snap.top + snap.height < box.height - margin;
          top = inBand ? snap.top : null;
        }
      }
      if (top === null) trackedId = pick();
      w.__PROBE__.frames.push({
        t,
        top,
        scrollTop: el.scrollTop,
        rowId: trackedId,
        probeLen: g.__ANCHOR_PROBE__?.length ?? 0,
        rows,
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

  const frames: Frame[] = await timeline.evaluate((_el) => {
    const w = window as unknown as {
      __PROBE__: { frames: Frame[]; stop: boolean };
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
        signedShift: number;
        renderedScroll?: number;
      }>;
      __ANCHOR_BUILD_STAMP__?: string;
    };
    return {
      corrections: g.__ANCHOR_PROBE__ ?? [],
      buildStamp: g.__ANCHOR_BUILD_STAMP__ ?? null,
    };
  });

  // FIRST-CUT RESULT (webkit, w4a-gate-1): both survivors reproduced —
  // rowMove=-14.5, dScroll=0.0, src=ro, signedShift=0.0, fired=false — but the
  // same-frame height discriminator read self=0 above=0 below=0: NO mounted row
  // changed height >=1px on the reversal frame. That falsifies A/B/C-as-a-
  // same-frame-height-delta and reframes the leg: the RO's signedShift=0.0 is
  // its `!changed` early-return (useAnchoredScroll.ts:1009-1015 reports a
  // LITERAL signedShift:0 before it ever measures drift), so "0.0" means "no
  // OBSERVED row's height changed this batch" — not "no drift". Two live
  // mechanisms remain for a -14.5 move with no surviving-row height delta:
  //   (1) MOUNT/UNMOUNT above the anchor — virtualization adds/removes a row
  //       above the tracked row, shifting everything below it, with no single
  //       surviving row resizing (invisible to a both-frames height diff), or
  //   (2) an ADJACENT-FRAME height flush — the resize landed on frame i-1/i-2
  //       and the visual move flushed on frame i (same-frame diff sees stable
  //       heights because the growth already settled).
  // So this cut adds (a) mounted-set membership delta above/below the anchor and
  // (b) a +-LOOKBACK-frame height-change scan, alongside the same-frame deltas.
  // Also record the attributed correction (largest |signedShift| in the probe
  // window) so the DOM story lines up with Sami's source/signedShift stream.
  type Diag = {
    i: number;
    rowMove: number;
    dScroll: number;
    rowId: string;
    selfDelta: number; // moved row's own height change
    aboveDelta: number; // summed height change of rows above it
    belowDelta: number; // summed height change of rows below it
    aboveCount: number;
    belowCount: number;
    // Mounted-set membership churn this frame, split by position vs the moved
    // row's pre-frame top (mechanism 1).
    addedAbove: number;
    addedBelow: number;
    removedAbove: number;
    removedBelow: number;
    // Largest |height change| of ANY surviving row within +-LOOKBACK frames of
    // the reversal, and at which frame offset it landed (mechanism 2).
    nearMaxDelta: number;
    nearMaxOffset: number;
    source: "raf" | "ro" | "none";
    signedShift: number | null;
    fired: boolean;
  };
  const diags: Diag[] = [];
  let scored = 0;
  let reanchors = 0;
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
    if (rowMove > -REVERSAL_PX) continue;
    const movedTop = a.rows[a.rowId]?.top ?? 0;
    let selfDelta = 0;
    let aboveDelta = 0;
    let belowDelta = 0;
    let aboveCount = 0;
    let belowCount = 0;
    for (const [id, snap] of Object.entries(b.rows)) {
      const prev = a.rows[id];
      if (!prev) continue;
      const dh = snap.height - prev.height;
      if (Math.abs(dh) <= REALIZE_PX) continue;
      if (id === a.rowId) {
        selfDelta += dh;
      } else if (prev.top < movedTop) {
        aboveDelta += dh;
        aboveCount += 1;
      } else {
        belowDelta += dh;
        belowCount += 1;
      }
    }
    const next = frames[i + 1] ?? b;
    const window = corrections.slice(a.probeLen, next.probeLen);
    let attempt: (typeof corrections)[number] | null = null;
    for (const c of window) {
      if (
        attempt === null ||
        Math.abs(c.signedShift) > Math.abs(attempt.signedShift)
      ) {
        attempt = c;
      }
    }
    // Mechanism 1: mounted-set membership churn this frame. A row present in b
    // but not a APPEARED; present in a but not b DISAPPEARED. Bucket by the
    // row's own top in the frame it exists (b for added, a for removed) vs the
    // moved row's pre-frame top — churn ABOVE the anchor shifts it, churn below
    // does not.
    let addedAbove = 0;
    let addedBelow = 0;
    let removedAbove = 0;
    let removedBelow = 0;
    for (const [id, snap] of Object.entries(b.rows)) {
      if (a.rows[id]) continue;
      if (snap.top < movedTop) addedAbove += 1;
      else addedBelow += 1;
    }
    for (const [id, snap] of Object.entries(a.rows)) {
      if (b.rows[id]) continue;
      if (snap.top < movedTop) removedAbove += 1;
      else removedBelow += 1;
    }
    // Mechanism 2: adjacent-frame height flush. Scan +-LOOKBACK frames around
    // the reversal for the largest surviving-row height change on ANY row,
    // recording the signed frame offset where it landed (0 = same frame).
    let nearMaxDelta = 0;
    let nearMaxOffset = 0;
    for (let k = -LOOKBACK; k <= LOOKBACK; k += 1) {
      const p = frames[i - 1 + k];
      const q = frames[i + k];
      if (!p || !q) continue;
      for (const [id, snap] of Object.entries(q.rows)) {
        const prev = p.rows[id];
        if (!prev) continue;
        const dh = snap.height - prev.height;
        if (Math.abs(dh) > Math.abs(nearMaxDelta)) {
          nearMaxDelta = dh;
          nearMaxOffset = k;
        }
      }
    }
    diags.push({
      i,
      rowMove,
      dScroll,
      rowId: a.rowId,
      selfDelta,
      aboveDelta,
      belowDelta,
      aboveCount,
      belowCount,
      addedAbove,
      addedBelow,
      removedAbove,
      removedBelow,
      nearMaxDelta,
      nearMaxOffset,
      source: attempt?.source ?? "none",
      signedShift: attempt?.signedShift ?? null,
      fired: attempt?.wouldFire ?? false,
    });
  }

  const classify = (d: Diag): string => {
    const self = Math.abs(d.selfDelta) > REALIZE_PX;
    const above = Math.abs(d.aboveDelta) > REALIZE_PX;
    const below = Math.abs(d.belowDelta) > REALIZE_PX;
    if (above && !self) return "B:straddler-above";
    if (self && !above) return "A:anchor-self-realize";
    if (self && above) return "A+B:self+above";
    if (below && !above && !self) return "C:below-only";
    // No same-frame height delta anywhere. Distinguish the two live mechanisms.
    if (d.addedAbove > 0 || d.removedAbove > 0) return "D:mount-churn-above";
    if (Math.abs(d.nearMaxDelta) > REALIZE_PX)
      return `E:adjacent-flush@${d.nearMaxOffset}`;
    return "none:no-height-change";
  };

  /* eslint-disable no-console */
  console.log("\n=== W4a WALK-BLIND DIAGNOSIS ===");
  console.log(`engine:              ${browserName}`);
  console.log(`build stamp:         ${buildStamp ?? "(absent)"}`);
  console.log(`frames sampled:      ${frames.length}`);
  console.log(`frame-pairs scored:  ${scored}`);
  console.log(`re-anchor frames:    ${reanchors}`);
  console.log(`reversal frames:     ${diags.length}`);
  for (const d of diags.sort((x, y) => x.rowMove - y.rowMove)) {
    const s = d.signedShift === null ? "n/a" : d.signedShift.toFixed(1);
    console.log(
      `  frame ${d.i} rowMove=${d.rowMove.toFixed(1)} dScroll=${d.dScroll.toFixed(1)} ` +
        `self=${d.selfDelta.toFixed(1)} above=${d.aboveDelta.toFixed(1)}(${d.aboveCount}) ` +
        `below=${d.belowDelta.toFixed(1)}(${d.belowCount}) ` +
        `mount+${d.addedAbove}a/${d.addedBelow}b -${d.removedAbove}a/${d.removedBelow}b ` +
        `near=${d.nearMaxDelta.toFixed(1)}@${d.nearMaxOffset} src=${d.source} ` +
        `signedShift=${s} fired=${d.fired} class=${classify(d)} row=${d.rowId}`,
    );
  }
  console.log("================================\n");

  // RAW NEIGHBORHOOD DUMP around each reversal — the same-frame/adjacent/mount
  // discriminators all read zero, so the move is not content-driven. Print the
  // exact scrollTop (not the delta) and the tracked row's top for i-2..i+2 to
  // see whether scrollTop is fractional (subpixel coalescing) and whether `top`
  // recovers next frame (transient compositor artifact vs persistent move).
  for (const d of diags) {
    console.log(`--- neighborhood of reversal frame ${d.i} (${d.rowId}) ---`);
    for (let k = -2; k <= 2; k += 1) {
      const f = frames[d.i + k];
      if (!f) continue;
      const rt = d.rowId ? (f.rows[d.rowId]?.top ?? null) : null;
      console.log(
        `  f${d.i + k} scrollTop=${f.scrollTop.toFixed(3)} ` +
          `trackTop=${f.top === null ? "n/a" : f.top.toFixed(1)} ` +
          `rowTop=${rt === null ? "n/a" : rt.toFixed(1)}`,
      );
    }
  }
  console.log("================================\n");
  /* eslint-enable no-console */

  expect(scored).toBeGreaterThan(50);
  expect(buildStamp).toBe(EXPECTED_BUILD_STAMP);
});
