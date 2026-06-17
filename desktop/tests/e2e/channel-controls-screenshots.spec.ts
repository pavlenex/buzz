import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/channel-controls";

// `general` seeds the mock identity as owner, so the owner/admin-gated
// visibility + ephemeral controls are live and interactive.
async function openManagementModal(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await page.getByTestId("channel-management-trigger").click();
  await expect(page.getByTestId("channel-management-modal")).toBeVisible();
}

async function openManagementEdit(page: import("@playwright/test").Page) {
  await page.getByTestId("channel-management-edit").click();
  await expect(
    page.getByTestId("channel-management-edit-dialog"),
  ).toBeVisible();
}

async function settle(page: import("@playwright/test").Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
}

test.describe("channel controls screenshots", () => {
  test("01 — lifecycle section: Private + Ephemeral switches", async ({
    page,
  }) => {
    await installMockBridge(page);
    await openManagementModal(page);
    await openManagementEdit(page);

    const lifecycle = page.getByTestId("channel-management-lifecycle");
    await lifecycle.scrollIntoViewIfNeeded();
    await expect(
      page.getByTestId("channel-management-private-toggle"),
    ).toBeVisible();
    await expect(
      page.getByTestId("channel-management-ephemeral-toggle"),
    ).toBeVisible();
    await settle(page);

    await lifecycle.screenshot({ path: `${SHOTS}/01-lifecycle-default.png` });
  });

  test("02 — Private toggled on", async ({ page }) => {
    await installMockBridge(page);
    await openManagementModal(page);
    await openManagementEdit(page);

    const lifecycle = page.getByTestId("channel-management-lifecycle");
    await lifecycle.scrollIntoViewIfNeeded();
    await page.getByTestId("channel-management-private-toggle").click();
    await expect(
      page.getByTestId("channel-management-private-toggle"),
    ).toBeChecked();
    // Save button enables once the visibility actually changed.
    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toBeEnabled();
    await settle(page);

    await lifecycle.screenshot({ path: `${SHOTS}/02-private-on.png` });
  });

  test("03 — Ephemeral on with friendly timeout field", async ({ page }) => {
    await installMockBridge(page);
    await openManagementModal(page);
    await openManagementEdit(page);

    const lifecycle = page.getByTestId("channel-management-lifecycle");
    await lifecycle.scrollIntoViewIfNeeded();
    await page.getByTestId("channel-management-ephemeral-toggle").click();

    const ttl = page.getByTestId("channel-management-ttl");
    await expect(ttl).toBeVisible();
    await ttl.fill("1d12h");
    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toBeEnabled();
    await settle(page);

    await lifecycle.screenshot({ path: `${SHOTS}/03-ephemeral-ttl.png` });
  });

  test("04 — invalid timeout blocks save with inline error", async ({
    page,
  }) => {
    await installMockBridge(page);
    await openManagementModal(page);
    await openManagementEdit(page);

    const lifecycle = page.getByTestId("channel-management-lifecycle");
    await lifecycle.scrollIntoViewIfNeeded();
    await page.getByTestId("channel-management-ephemeral-toggle").click();

    const ttl = page.getByTestId("channel-management-ttl");
    await ttl.fill("soon");
    await expect(ttl).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toBeDisabled();
    await settle(page);

    await lifecycle.screenshot({ path: `${SHOTS}/04-ttl-invalid.png` });
  });

  test("05 — sticky footer pins lifecycle buttons", async ({ page }) => {
    await installMockBridge(page);
    await openManagementModal(page);

    const footer = page.getByTestId("channel-management-footer");
    await expect(footer).toBeVisible();
    await expect(page.getByTestId("channel-management-archive")).toBeVisible();
    await settle(page);

    await footer.screenshot({ path: `${SHOTS}/05-sticky-footer.png` });
  });

  test("06 — full modal with new controls", async ({ page }) => {
    await installMockBridge(page);
    await openManagementModal(page);

    const modal = page.getByTestId("channel-management-modal");
    await expect(modal).toBeVisible();
    await settle(page);

    await modal.screenshot({ path: `${SHOTS}/06-management-modal.png` });
  });

  test("07 — saving lifecycle leaves details save idle", async ({ page }) => {
    await installMockBridge(page, { updateChannelDelayMs: 500 });
    await openManagementModal(page);
    await openManagementEdit(page);

    const modal = page.getByTestId("channel-management-edit-dialog");
    await page.getByTestId("channel-management-ephemeral-toggle").click();
    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toBeEnabled();

    await page.getByTestId("channel-management-save-lifecycle").click();
    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toHaveText("Saving...");
    await expect(
      page.getByTestId("channel-management-save-details"),
    ).toHaveText("Save details");
    await modal.screenshot({
      path: `${SHOTS}/07-lifecycle-saving-details-idle.png`,
    });

    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toHaveText("Save visibility");
  });

  test("08 — saved ephemeral lifecycle is reflected after reopen", async ({
    page,
  }) => {
    await installMockBridge(page);
    await openManagementModal(page);
    await openManagementEdit(page);

    await page.getByTestId("channel-management-private-toggle").click();
    await page.getByTestId("channel-management-ephemeral-toggle").click();
    await page.getByTestId("channel-management-save-lifecycle").click();
    await expect(
      page.getByTestId("channel-management-save-lifecycle"),
    ).toHaveText("Save visibility");

    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId("channel-management-edit-dialog"),
    ).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId("channel-management-modal"),
    ).not.toBeVisible();
    await page.getByTestId("channel-management-trigger").click();
    await openManagementEdit(page);

    const lifecycle = page.getByTestId("channel-management-lifecycle");
    await lifecycle.scrollIntoViewIfNeeded();
    await expect(
      page.getByTestId("channel-management-private-toggle"),
    ).toHaveAttribute("data-state", "checked");
    await expect(
      page.getByTestId("channel-management-ephemeral-toggle"),
    ).toHaveAttribute("data-state", "checked");
    await expect(page.getByTestId("channel-management-ttl")).toHaveValue("1d");
    await settle(page);

    await lifecycle.screenshot({
      path: `${SHOTS}/08-ephemeral-persisted-after-reopen.png`,
    });
  });
});
