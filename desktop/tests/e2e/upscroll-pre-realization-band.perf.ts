import { expect, test } from "@playwright/test";
import { decode } from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";

import { installRelayBridge } from "../helpers/bridge";

/**
 * Geometry proof for `useTimelinePreRealizationBand`.
 *
 * This deliberately does not score smoothness — the W1-only vs W1+W2 live
 * trackpad gate owns that. It answers the cheap proof questions for W2:
 *   1. IntersectionObserver fires for `content-visibility:auto` timeline rows.
 *   2. Rows marked `data-buzz-pre-realized` are above the viewport, inside the
 *      configured warm band, during an upscroll.
 */

const RELAY_HTTP =
  process.env.BUZZ_E2E_RELAY_URL ?? "https://sprout-oss.stage.blox.sqprod.co";
const NSEC = process.env.BUZZ_PERF_NSEC ?? "";
const COMMUNITY_HOST = process.env.BUZZ_COMMUNITY_HOST ?? "";
const TARGET_CHANNEL = process.env.BUZZ_PERF_CHANNEL ?? "buzz-bugs";
const BAND_PX = 1800;
const BAND_TOLERANCE_PX = 8;
const SWIPE_COUNT = Number(process.env.BUZZ_PERF_SWIPES ?? 8);
const IDENTITY_OVERRIDE_KEY = "buzz:e2e-identity-override.v1";
const ONBOARDING_PREFIX = "buzz-onboarding-complete.v1:";
const WELCOME_PREFIX = "buzz-welcome-channel-ensured.v2:";
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

test.use({ userAgent: REAL_CHROME_UA });

function deriveIdentity(nsec: string) {
  const decoded = decode(nsec.trim());
  if (decoded.type !== "nsec") throw new Error("BUZZ_PERF_NSEC is not an nsec");
  const skBytes = decoded.data as Uint8Array;
  return {
    privateKey: Buffer.from(skBytes).toString("hex"),
    pubkey: getPublicKey(skBytes),
    username: "perf-max",
  };
}

function swipeDeltas(): number[] {
  const deltas: number[] = [];
  for (let i = 0; i < 12; i++) deltas.push(4 + Math.round((32 * i) / 11));
  let v = 36;
  while (v >= 1) {
    deltas.push(Math.round(v));
    v *= 0.94;
  }
  return deltas;
}

type WarmSample = {
  below: number;
  inBand: number;
  maxOffset: number | null;
  minOffset: number | null;
  scrollTop: number;
  total: number;
};

test("MEASURE: pre-realization band warms rows above viewport", async ({
  page,
}) => {
  test.setTimeout(900_000);
  if (!NSEC) throw new Error("Set BUZZ_PERF_NSEC to a real member nsec");
  const identity = deriveIdentity(NSEC);

  await installRelayBridge(page, "tyler");
  const wsUrl = RELAY_HTTP.replace(/^http/, "ws");
  await page.addInitScript(
    ({ ident, onboardingPrefix, welcomePrefix, relayUrl, overrideKey }) => {
      window.localStorage.setItem(overrideKey, JSON.stringify(ident));
      window.localStorage.setItem(`${onboardingPrefix}${ident.pubkey}`, "true");
      window.localStorage.setItem(
        `${welcomePrefix}${encodeURIComponent(relayUrl)}:${ident.pubkey}`,
        "true",
      );
      const w = window as unknown as { __BUZZ_E2E__?: Record<string, unknown> };
      w.__BUZZ_E2E__ = { ...(w.__BUZZ_E2E__ ?? {}), identity: ident };
    },
    {
      ident: identity,
      onboardingPrefix: ONBOARDING_PREFIX,
      welcomePrefix: WELCOME_PREFIX,
      relayUrl: wsUrl,
      overrideKey: IDENTITY_OVERRIDE_KEY,
    },
  );

  const relayHost = new URL(RELAY_HTTP).host;
  await page.route(
    (url) => url.host === relayHost,
    async (route) => {
      const req = route.request();
      const fwd = { ...req.headers(), "user-agent": REAL_CHROME_UA };
      delete fwd["sec-ch-ua"];
      delete fwd["sec-ch-ua-mobile"];
      delete fwd["sec-ch-ua-platform"];
      if (COMMUNITY_HOST) fwd.host = COMMUNITY_HOST;
      let resp: Awaited<ReturnType<typeof route.fetch>> | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          resp = await route.fetch({ headers: fwd });
          break;
        } catch (err) {
          if (attempt === 4) throw err;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      if (!resp) throw new Error("unreachable");
      const headers = { ...resp.headers() };
      headers["access-control-allow-origin"] = "*";
      headers["access-control-allow-headers"] = "*";
      headers["access-control-allow-methods"] = "*";
      await route.fulfill({ response: resp, headers, body: await resp.body() });
    },
  );

  await page.goto("/");
  await page.getByTestId("app-sidebar").waitFor({ state: "visible" });
  const channel = page.getByTestId(`channel-${TARGET_CHANNEL}`).first();
  await channel.waitFor({ state: "visible", timeout: 45_000 });
  await channel.click();
  await page
    .locator('[data-testid="message-timeline"] [data-message-id]')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(3000);

  const timeline = page.getByTestId("message-timeline");
  await timeline.evaluate((element) => {
    const el = element as HTMLDivElement;
    el.style.overflowAnchor = "none";
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(500);

  await timeline.evaluate(() => {
    const store = window as unknown as {
      __BUZZ_WARM_SAMPLES__: WarmSample[];
      __BUZZ_WARM_SAMPLER_STOP__?: boolean;
    };
    store.__BUZZ_WARM_SAMPLES__ = [];
  });

  await timeline.evaluate(
    (element, { bandPx, tolerancePx }) => {
      const el = element as HTMLDivElement;
      const store = window as unknown as {
        __BUZZ_WARM_SAMPLES__: WarmSample[];
        __BUZZ_WARM_SAMPLER_STOP__?: boolean;
      };
      const loop = () => {
        if (store.__BUZZ_WARM_SAMPLER_STOP__) return;
        const viewport = el.getBoundingClientRect();
        let below = 0;
        let inBand = 0;
        let maxOffset: number | null = null;
        let minOffset: number | null = null;
        let total = 0;
        for (const row of el.querySelectorAll<HTMLElement>(
          '[data-buzz-pre-realized="true"]',
        )) {
          total += 1;
          const rect = row.getBoundingClientRect();
          const offset = rect.top - viewport.top;
          minOffset = minOffset === null ? offset : Math.min(minOffset, offset);
          maxOffset = maxOffset === null ? offset : Math.max(maxOffset, offset);
          if (
            rect.top >= viewport.top - bandPx - tolerancePx &&
            rect.top <= viewport.top + tolerancePx
          ) {
            inBand += 1;
          }
          if (rect.top > viewport.top + tolerancePx) {
            below += 1;
          }
        }
        store.__BUZZ_WARM_SAMPLES__.push({
          below,
          inBand,
          maxOffset,
          minOffset,
          scrollTop: el.scrollTop,
          total,
        });
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    { bandPx: BAND_PX, tolerancePx: BAND_TOLERANCE_PX },
  );

  const box = await timeline.boundingBox();
  if (!box) throw new Error("no timeline box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const isChromium =
    page.context().browser()?.browserType().name() === "chromium";
  const cdp = isChromium ? await page.context().newCDPSession(page) : null;

  for (let swipe = 0; swipe < SWIPE_COUNT; swipe++) {
    for (const delta of swipeDeltas()) {
      if (cdp) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          deltaX: 0,
          deltaY: -delta,
          pointerType: "mouse",
        });
      } else {
        await page.mouse.wheel(0, -delta);
      }
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    await page.waitForTimeout(120);
  }

  await page.evaluate(() => {
    (
      window as unknown as { __BUZZ_WARM_SAMPLER_STOP__?: boolean }
    ).__BUZZ_WARM_SAMPLER_STOP__ = true;
  });
  const samples = (await page.evaluate(
    () =>
      (window as unknown as { __BUZZ_WARM_SAMPLES__: WarmSample[] })
        .__BUZZ_WARM_SAMPLES__,
  )) as WarmSample[];
  const withWarmRows = samples.filter((sample) => sample.total > 0);
  const badSamples = withWarmRows.filter(
    (sample) => sample.below > 0 || sample.inBand !== sample.total,
  );

  console.log(
    `\n=== PRE-REALIZATION BAND GEOMETRY: #${TARGET_CHANNEL} engine=${page.context().browser()?.browserType().name()} ===`,
  );
  console.log(
    `samples=${samples.length} samplesWithWarmRows=${withWarmRows.length} badSamples=${badSamples.length}`,
  );
  for (const sample of withWarmRows.slice(0, 20)) {
    console.log(
      `  scrollTop=${sample.scrollTop.toFixed(0)} warm=${sample.total} inBand=${sample.inBand} below=${sample.below} offsets=[${sample.minOffset?.toFixed(1)}, ${sample.maxOffset?.toFixed(1)}]`,
    );
  }
  if (badSamples.length > 0) {
    console.log("--- bad warm-row geometry samples ---");
    for (const sample of badSamples.slice(0, 20)) {
      console.log(
        `  scrollTop=${sample.scrollTop.toFixed(0)} warm=${sample.total} inBand=${sample.inBand} below=${sample.below} offsets=[${sample.minOffset?.toFixed(1)}, ${sample.maxOffset?.toFixed(1)}]`,
      );
    }
  }
  console.log("==============================================\n");

  expect(samples.length).toBeGreaterThan(30);
  expect(withWarmRows.length).toBeGreaterThan(0);
  expect(badSamples).toHaveLength(0);
});
