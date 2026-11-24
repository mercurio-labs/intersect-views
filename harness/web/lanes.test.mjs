import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
      viewport: { width: 1750, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.goto(`${server.resolvedUrls.local[0]}harness/web/`);
  await expect(page.locator(".diagram-node")).toHaveCount(6, {
    timeout: 60000,
  });
  await page.locator("#load-lanes").click();
  await expect(page.locator(".lane-step")).toHaveCount(4, { timeout: 60000 });
  await expect(page.locator(".lane-header")).toHaveCount(3);
  await expect(page.locator(".lane-span")).toHaveCount(1);
  await expect(page.locator(".lane-axis")).toContainText("horizontal");
  const step = (name) =>
    page
      .locator(".lane-step")
      .filter({
        has: page.locator("text").filter({ hasText: new RegExp(`^${name}$`) }),
      });
  const lane = (name) =>
    page
      .locator("[data-lane]")
      .filter({
        has: page.locator("text").filter({ hasText: new RegExp(`^${name}$`) }),
      });
  const check = step("Check"),
    activity = step("Activity"),
    finish = step("Finish"),
    model = page.locator("#model");
  const ready = async () => {
    await expect(page.locator(".lane-canvas")).toHaveAttribute(
      "data-revision",
      String(await page.evaluate(() => window.harness.revision)),
    );
    await expect(page.locator(".lane-canvas")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  };
  const original = await model.inputValue();
  const exact = activity.locator("[data-lane-part]").nth(1);
  await exact.dblclick();
  assert.match(
    await model.evaluate((e) =>
      e.value.slice(e.selectionStart, e.selectionEnd),
    ),
    /^step Activity/,
  );
  await check.locator(".lane-step-body").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Place Step", exact: true }).click();
  await expect(page.locator(".lane-form")).toContainText("orders all Steps");
  const operator = await lane("Operator").getAttribute("data-lane"),
    controller = await lane("ControllerWithALongLabel").getAttribute(
      "data-lane",
    );
  await page.getByLabel("Target lane", { exact: true }).selectOption(operator);
  await page
    .getByLabel("Insert before", { exact: true })
    .selectOption(await activity.getAttribute("data-step"));
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply placement" }).click();
  await expect(model).toHaveValue(/step Check in Operator after Start/);
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 1/,
  );
  await page.locator("#undo-source").click();
  await ready();
  await expect(model).toHaveValue(original);
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 2/,
  );
  await page.locator("#redo-source").click();
  await ready();
  await expect(model).toHaveValue(/step Check in Operator after Start/);
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 1/,
  );
  // An invalid backward span reaches the real language provider and changes nothing.
  const beforeReject = await model.inputValue();
  await activity.locator(".lane-step-body").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Place Step", exact: true }).click();
  await page
    .getByLabel("Span end", { exact: true })
    .selectOption(await step("Start").getAttribute("data-step"));
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply placement" }).click();
  await expect(page.locator(".lane-status")).toContainText(
    "Span must end after",
  );
  assert.equal(await model.inputValue(), beforeReject);
  await page
    .locator(".lane-form")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  // A real body drag proposes (and then applies) a lane/rank change.
  await page.getByRole("button", { name: "Fit lanes", exact: true }).click();
  const from = await check.locator(".lane-step-body").boundingBox(),
    to = await finish.locator(".lane-step-body").boundingBox(),
    band = await lane("ControllerWithALongLabel")
      .locator(".lane-header")
      .boundingBox();
  assert(from && to && band);
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(to.x - 30, band.y + band.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".lane-form")).toBeVisible();
  await expect(page.getByLabel("Target lane", { exact: true })).toHaveValue(
    controller,
  );
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply placement" }).click();
  await expect(model).toHaveValue(
    /step Check in ControllerWithALongLabel after Activity/,
  );
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 2/,
  );
  // Resize a span through its end handle, with source undo restoring its endpoint.
  await page.getByRole("button", { name: "Fit lanes", exact: true }).click();
  const handle = await page.locator(".lane-span-handle").boundingBox(),
    end = await check.locator(".lane-step-body").boundingBox();
  assert(handle && end);
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(end.x + 5, end.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel("Span end", { exact: true })).toHaveValue(
    await check.getAttribute("data-step"),
  );
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply placement" }).click();
  await expect(model).toHaveValue(/end Check/);
  await page.locator("#undo-source").click();
  await ready();
  await expect(model).toHaveValue(/end Finish/);
  // Presentation lane reorders preserve span coverage; semantic source is unchanged.
  const beforeLayout = await model.inputValue();
  await page
    .getByRole("button", {
      name: "Move lane Lane · Empty earlier",
      exact: true,
    })
    .click();
  await expect(page.locator(".lane-status")).toContainText("split a span");
  await page
    .getByRole("button", {
      name: "Move lane Lane · Operator later",
      exact: true,
    })
    .click();
  assert.equal(await model.inputValue(), beforeLayout);
  await page.locator("#save").click();
  await expect(page.locator("#analyze")).toBeEnabled();
  await page.reload();
  await expect(page.locator(".lane-step")).toHaveCount(4, { timeout: 60000 });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("intersect.views.harness.v1")),
  );
  assert.equal(saved.presentation.schemaVersion, 5);
  const layout = saved.presentation.views["lanes-horizontal"];
  assert.equal(layout.form, "laneGraph");
  assert.deepEqual(Object.keys(layout).sort(), [
    "form",
    "laneOrder",
    "packageFingerprint",
    "projection",
    "viewport",
  ]);
  assert.match(layout.packageFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(layout.projection, "harness.lanes-horizontal");
  assert.equal(layout.laneOrder[0], controller);
  await page
    .locator('.lane-canvas select[aria-label="Diagram view"]')
    .selectOption("lanes-vertical");
  await expect(page.locator(".lane-axis")).toContainText("vertical");
  await page.getByRole("tab", { name: "Model", exact: true }).click();
  if (await page.locator(".workbench-tree").getAttribute("open") === null)
    await page.locator(".workbench-tree > summary").click();
  await page.getByTitle("Add Process to diagram", { exact: true }).click();
  await expect(page.locator(".lane-step")).toHaveCount(4);
  await page.getByRole("button", { name: "Fit lanes", exact: true }).click();
  // View metadata and the retained step count can precede the async layout.
  // Wait for the transposed geometry, including a complete DOM replacement.
  await expect.poll(async () => {
    const a = await step("Start").locator(".lane-step-body").boundingBox(),
      b = await step("Finish").locator(".lane-step-body").boundingBox();
    return !!a && !!b && b.y > a.y;
  }).toBe(true);
  await exact.dblclick();
  assert.match(
    await model.evaluate((e) =>
      e.value.slice(e.selectionStart, e.selectionEnd),
    ),
    /^step Activity/,
  );

  // The transposed semantic drag and span resize use the same checked commands.
  await page.getByRole("button", { name: "Fit lanes", exact: true }).click();
  const vfrom = await check.locator(".lane-step-body").boundingBox(),
    vto = await activity.locator(".lane-step-body").boundingBox(),
    vband = await lane("Operator").locator(".lane-header").boundingBox();
  assert(vfrom && vto && vband);
  await page.mouse.move(vfrom.x + 5, vfrom.y + 5);
  await page.mouse.down();
  await page.mouse.move(vband.x + vband.width / 2, vto.y - 30, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply placement" }).click();
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 1/,
  );
  await page.locator("#undo-source").click();
  await ready();
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 2/,
  );
  await page.getByRole("button", { name: "Fit lanes", exact: true }).click();
  const vh = await page.locator(".lane-span-handle").boundingBox(),
    ve = await check.locator(".lane-step-body").boundingBox();
  assert(vh && ve);
  await page.mouse.move(vh.x + vh.width / 2, vh.y + vh.height / 2);
  await page.mouse.down();
  await page.mouse.move(ve.x + 5, ve.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply placement" }).click();
  await expect(model).toHaveValue(/end Check/);
  await page.locator("#undo-source").click();
  await ready();
  await expect(model).toHaveValue(/end Finish/);
  await expect(check.locator(".lane-step-body")).toHaveAttribute(
    "aria-label",
    /rank 2/,
  );
  // Delay real worker replies, preserving the actual semantic computation.
  await page.evaluate(() => {
    const host = window.harness.host,
      request = host.request.bind(host);
    host.request = async (method, params) => {
      const result = await request(method, params);
      if (method === "views/laneTargets" && window.delayLaneHint) {
        window.delayLaneHint = false;
        window.laneHintHeld = true;
        await new Promise((r) => setTimeout(r, 900));
        window.laneHintReleased = true;
      }
      if (method === "views/commitCommand" && window.delayLaneCommit) {
        window.delayLaneCommit = false;
        window.laneCommitHeld = true;
        await new Promise((r) => setTimeout(r, 900));
        window.laneCommitReleased = true;
      }
      return result;
    };
    window.delayLaneHint = true;
  });
  await check.locator(".lane-step-body").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Place Step", exact: true }).click();
  await page.waitForFunction(() => window.laneHintHeld);
  await page
    .getByLabel("Target lane", { exact: true })
    .selectOption(await lane("Operator").getAttribute("data-lane"));
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.waitForFunction(() => window.laneHintReleased);
  await expect(page.getByLabel("Target lane", { exact: true })).toHaveValue(
    await lane("Operator").getAttribute("data-lane"),
  );
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page
    .locator(".lane-form")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await check.locator(".lane-step-body").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Place Step", exact: true }).click();
  await page
    .getByLabel("Target lane", { exact: true })
    .selectOption(await lane("Operator").getAttribute("data-lane"));
  await page
    .getByLabel("Insert before", { exact: true })
    .selectOption(await activity.getAttribute("data-step"));
  await expect(
    page.getByRole("button", { name: "Apply placement" }),
  ).toBeEnabled();
  await page.evaluate(() => (window.delayLaneCommit = true));
  await page.getByRole("button", { name: "Apply placement" }).click();
  await page.waitForFunction(() => window.laneCommitHeld);
  const typed =
    (await model.inputValue()) + "\n// later typing owns this buffer";
  await model.fill(typed);
  await page.locator("#analyze").click();
  await page.waitForFunction(() => window.laneCommitReleased);
  await expect(model).toHaveValue(typed);
  await expect(page.locator(".lane-step")).toHaveCount(4);

  // Source may analyze cleanly while violating view order constraints.
  const cleanText = await model.inputValue();
  await model.fill(
    cleanText.replace(
      "step Start in Operator;",
      "step Start in Operator after Finish;",
    ),
  );
  await page.locator("#analyze").click();
  await expect(page.locator("#status")).toContainText("Clean model");
  await expect(page.locator(".lane-status")).toContainText("cycle");
  await expect(page.locator(".lane-step")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Place Step", exact: true }),
  ).toBeDisabled();
  await model.fill(cleanText);
  await page.locator("#analyze").click();
  await ready();
  await page.screenshot({
    path: process.env.LANE_SCREENSHOT || "docs/evidence/m9-lanes.png",
  });
  assert.deepEqual(errors, []);
  const preserved = await model.inputValue();
  await page.evaluate((current) => {
    const key = "intersect.views.harness.v1",
      saved = JSON.parse(localStorage.getItem(key));
    saved.model = current;
    saved.presentation = { schemaVersion: 1, views: {} };
    localStorage.setItem(key, JSON.stringify(saved));
  }, preserved);
  await page.reload();
  await expect(page.locator("#layout-warning")).toContainText(
    "export or reset",
  );
  assert.equal(await model.inputValue(), preserved);
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("intersect.views.harness.v1"))
          .presentation.schemaVersion,
    ),
    1,
  );
  console.log(
    "PASS M9 lane browser: both axes, Unicode/long/empty lanes, exact label reveal, keyboard source placement, drag, span resize, rejection, source undo/redo, contiguous presentation order and reload.",
  );
} finally {
  await browser?.close();
  await server.close();
}
