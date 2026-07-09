import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

async function dispatchWheelPrevented(
  page: import("@playwright/test").Page,
  selector: string,
  deltas: { deltaX?: number; deltaY?: number },
) {
  return page.evaluate(
    ({ selector, deltaX, deltaY }) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Missing element for selector: ${selector}`);
      }

      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX,
        deltaY,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, deltaX: deltas.deltaX ?? 0, deltaY: deltas.deltaY ?? 0 },
  );
}

test.beforeEach(async ({ page }) => {
  // Boundary-lock contracts exercise the stable/default path. Most E2E suites
  // opt every preview feature in, but compositorTimelineScroll intentionally
  // removes this listener so trackpad scrolling can stay off the main thread.
  await installMockBridge(page, undefined, { seedPreviewFeatures: false });
});

test("compositor timeline scrolling leaves timeline wheel events unhandled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "buzz-feature-overrides-v1",
      JSON.stringify({ compositorTimelineScroll: true }),
    );
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-timeline")).toBeVisible();

  // The diagnostic path removes the global non-passive listener rather than
  // merely returning early for conversations. The fixed-height shell and CSS
  // overscroll backstop remain; JS no longer blocks timeline scrolling.
  await expect(
    dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(false);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
      deltaX: -120,
    }),
  ).resolves.toBe(false);
});

test("locks viewport rubber-band outside conversation scrollers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-timeline")).toBeVisible();

  await expect(
    dispatchWheelPrevented(page, '[data-testid="app-top-chrome"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="sidebar-pinned-header"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="app-sidebar-scroll-anchor"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="chat-title"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);

  await expect(
    dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(false);
});

test("locks horizontal viewport pan everywhere", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-timeline")).toBeVisible();

  for (const deltaX of [-120, 120]) {
    await expect(
      dispatchWheelPrevented(page, '[data-testid="app-top-chrome"]', {
        deltaX,
      }),
    ).resolves.toBe(true);
    await expect(
      dispatchWheelPrevented(page, '[data-testid="sidebar-pinned-header"]', {
        deltaX,
      }),
    ).resolves.toBe(true);
    await expect(
      dispatchWheelPrevented(page, '[data-testid="chat-title"]', { deltaX }),
    ).resolves.toBe(true);

    // Unlike vertical, horizontal pans over the conversation pane are locked
    // too — there is no horizontal elastic affordance.
    await expect(
      dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
        deltaX,
      }),
    ).resolves.toBe(true);
  }

  // A predominantly vertical gesture with slight horizontal drift still
  // reaches the conversation scroller.
  await expect(
    dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
      deltaX: -10,
      deltaY: -120,
    }),
  ).resolves.toBe(false);
});
