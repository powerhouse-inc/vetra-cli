import { readFileSync } from "node:fs";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import {
  STUDIO_LOG,
  type StudioFixture,
  loadFixture,
  loadRun,
} from "../support/target.js";

/**
 * Seeded end-to-end. Against a freshly-booted, EMPTY studio (global-setup), we
 * type the prompt into the idea screen (which starts the product and its first
 * conversation), and let the replay agent drive the REAL build (project init →
 * model → editor → preview). We then assert the generated editor renders in
 * the preview pane's iframe with the preview data —
 * proving the whole loop: chat → agent → tools → reactor → studio.
 */
const fixture = loadFixture();
const run = loadRun();
const studioHome = `${run.baseUrl}/d/${run.driveId}`;

/** Connect's cookie banner has a full-screen blur backdrop that intercepts
 * clicks. Dismiss it; safe to call repeatedly (no-op once gone). */
async function dismissCookieBanner(page: Page): Promise<void> {
  const reject = page.getByRole("button", { name: /reject all cookies/i });
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await expect(reject).toBeHidden();
    return;
  }
  // It may paint slightly after load — short bounded chance, then give up
  // (a missing banner is the common case and must not cost the full wait).
  try {
    await reject.waitFor({ state: "visible", timeout: 3_000 });
    await reject.click();
    await expect(reject).toBeHidden();
  } catch {
    /* never appeared — fine */
  }
}

/** Throw on the first replay-step error (teed to STUDIO_LOG) so a failed build
 * fails in seconds instead of waiting out the whole preview timeout. */
function assertNoReplayError(): void {
  let log = "";
  try {
    log = readFileSync(STUDIO_LOG, "utf8");
  } catch {
    return; // not written yet
  }
  // Anchor on the status field (`<tool> ERROR:`) so a successful step whose
  // result text merely contains "ERROR" isn't a false positive.
  const m = log.match(/^\[replay\]\s+\d+\/\d+\s+\S+\s+ERROR\b.*/m);
  if (m) throw new Error(`replay failed — ${m[0].trim()}`);
}

/** The reactor-project's BUILD route on our own proxy: the authoritative
 * "build landed on this instance" signal (the proxy only knows its backends). */
async function reactorProjectUp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/_proxy/routes`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const routes = (await res.json()) as { source?: string; prefix?: string }[];
    return routes.some(
      (r) =>
        r.source === "service:reactor-project" &&
        typeof r.prefix === "string" &&
        r.prefix.startsWith("/reactor-project/vetra-studio"),
    );
  } catch {
    return false;
  }
}

/** Start the build the way a customer does. An empty Studio shows the idea
 * screen ("What do you want to build?"): typing the idea there and pressing
 * Build it creates the product, the first conversation and its first message,
 * and the page turns into the build — the step strip over the story (the idea
 * quoted first) and the live preview. */
async function startBuild(page: Page, prompt: string): Promise<void> {
  const idea = page.getByRole("textbox", { name: "Your idea" });
  await expect(idea).toBeVisible({ timeout: 30_000 });
  await dismissCookieBanner(page); // in case it painted late, before the next click
  await expect(
    page.getByRole("heading", { name: "What do you want to build?" }),
  ).toBeVisible();

  await idea.fill(prompt);
  await page.getByRole("button", { name: "Build it", exact: true }).click();

  // The idea screen gives way to the build: the step strip on top and the
  // story on the left, which opens with the idea in quotes.
  await expect(idea).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('header[aria-label="Steps"]')).toBeVisible({
    timeout: 30_000,
  });
  const story = page.locator('aside[aria-label="Story"]');
  await expect(
    story.getByText(`\u201c${prompt}\u201d`, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  console.log("[e2e] build started from the idea screen");
}

/** Wait until the preview iframe is mounted (preview = ready). The preview
 * pane follows the agent: it shows the preview once the agent's
 * spec-preview-show lands. If it hasn't after the build has landed, pick the
 * editor's tab under the preview, as a customer would. The whole cold build
 * can take minutes. */
async function waitForReadyPreview(
  page: Page,
  baseUrl: string,
): Promise<FrameLocator> {
  const iframe = page.locator('main iframe[title="Preview"]');
  const firstTab = page
    .getByRole("tablist", { name: "Screens" })
    .getByRole("tab")
    .first();
  const deadline =
    Date.now() + Number(process.env.VETRA_E2E_PREVIEW_TIMEOUT_MS ?? 480_000);
  let reactorSeenAt: number | null = null;
  let nudged = false;
  while (Date.now() < deadline) {
    assertNoReplayError();
    if (await iframe.isVisible().catch(() => false)) break;
    // Once our reactor-project is on the proxy the build has landed.
    if (reactorSeenAt === null && (await reactorProjectUp(baseUrl))) {
      reactorSeenAt = Date.now();
      console.log("[e2e] reactor-project up on this run's proxy");
    }
    // Give following a fair chance before picking the tab by hand.
    if (
      !nudged &&
      reactorSeenAt !== null &&
      Date.now() - reactorSeenAt > 60_000 &&
      (await firstTab.isVisible().catch(() => false))
    ) {
      console.log("[e2e] preview not shown yet — picking the editor's tab");
      await firstTab.click().catch(() => {});
      nudged = true;
    }
    await page.waitForTimeout(2000);
  }
  assertNoReplayError();
  await expect(iframe).toBeAttached({ timeout: 5000 });
  return page.frameLocator('main iframe[title="Preview"]');
}

/** Assert the generated editor renders with the preview document's data. */
async function assertEditor(
  preview: FrameLocator,
  fx: StudioFixture,
): Promise<void> {
  // Heading = the document name. (Both the editor and the DocumentToolbar
  // render an h1 of header.name; they always agree, so .first() is safe.)
  await expect(
    preview
      .getByRole("heading", { name: fx.preview.documentName, exact: true })
      .first(),
  ).toBeVisible({ timeout: 45_000 });

  // Interactive generated editor, not the generic viewer.
  await expect(preview.getByPlaceholder("New todo…")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    preview.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  // Gate on the document having synced before reading per-row state.
  await expect(preview.locator("li")).toHaveCount(fx.preview.items.length, {
    timeout: 45_000,
  });
  // Rows are present once the count matches, so per-row checks are quick.
  for (const item of fx.preview.items) {
    const row = preview.locator("li").filter({ hasText: item.text });
    await expect(row).toBeVisible({ timeout: 5_000 });
    const checkbox = row.getByRole("checkbox");
    if (item.completed) await expect(checkbox).toBeChecked({ timeout: 5_000 });
    else await expect(checkbox).not.toBeChecked({ timeout: 5_000 });
  }
}

/** The outer Studio Connect syncs the Studio drive, which holds the agent's
 * project specs (document-model, document-editor, …). A spec type the outer
 * Connect can't load shows Connect's missing-model banner to the customer. */
async function assertNoMissingModelBanner(page: Page): Promise<void> {
  const banner = page.getByText(/document types? couldn't load \(missing models?\)/i);
  // The sync that would trip it has landed by now; allow a short settle.
  await page.waitForTimeout(3_000);
  await expect(banner).toBeHidden();
}

test.describe("Vetra studio — seeded build", () => {
  test("agent builds the todo-list from empty and the editor renders in the preview", async ({
    page,
  }) => {
    await page.goto(studioHome, { waitUntil: "domcontentloaded" });
    await dismissCookieBanner(page);

    await startBuild(page, fixture.prompt);

    const preview = await waitForReadyPreview(page, run.baseUrl);
    await assertEditor(preview, fixture);
    await assertNoMissingModelBanner(page);
  });
});
