import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.copiedGridText = value;
        },
      },
    });
  });
  await page.goto(`${server.resolvedUrls.local[0]}harness/web/`);
  await expect(page.locator(".diagram-node")).toHaveCount(6, {
    timeout: 60000,
  });
  await page.locator("#load-grid").click();
  await expect(page.getByRole("grid", { name: "Model grid" })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator(".grid-row-header")).toHaveCount(3);
  await expect(page.locator('[data-row="0"][data-column="1"]')).toHaveText("2");
  await page.locator('[data-row="0"][data-column="1"]').click();
  await expect(page.getByLabel("Relation member")).toBeVisible();
  await expect(page.locator('[data-grid-tool="trace-add"]')).toBeDisabled();
  await expect(page.locator('[data-grid-tool="trace-remove"]')).toBeDisabled();
  await page.getByLabel("Relation member").selectOption({ label: "second" });
  await expect(page.locator('[data-grid-tool="trace-remove"]')).toBeEnabled();
  await page.locator('[data-grid-tool="trace-remove"]').click();
  await expect(page.locator('[data-row="0"][data-column="1"]')).toHaveText("1");
  await expect(page.locator("#model")).not.toHaveValue(/trace second /);
  await page.locator("#undo-source").click();
  await expect(page.locator('[data-row="0"][data-column="1"]')).toHaveText("2");
  await page.locator('[data-row="1"][data-column="0"]').click();
  await expect(page.locator('[data-grid-tool="trace-add"]')).toBeEnabled();
  await page.locator('.grid-actions input[name="name"]').fill("browserTrace");
  await page.locator('[data-grid-tool="trace-add"]').click();
  await expect(page.locator('[data-row="1"][data-column="0"]')).toHaveText("1");
  await expect(page.locator("#model")).toHaveValue(
    /trace browserTrace from Beta to Alpha;/,
  );
  await page.locator("#undo-source").click();
  await expect(page.locator('[data-row="1"][data-column="0"]')).toHaveText("·");
  await page.locator('[data-row="0"][data-column="0"]').click();
  await expect(page.locator('[data-grid-tool="trace-add"]')).toBeEnabled();
  await page.locator('[data-grid-tool="trace-add"]').click();
  await expect(page.locator(".grid-workbench .diagram-status")).toContainText(
    "Trace ends must differ",
  );
  await page.getByLabel("Grid view").selectOption("table");
  await expect(page.locator(".grid-cell.query")).toHaveCount(4);
  await expect(
    page.locator(".grid-cell.query").filter({ hasText: /^0$/ }),
  ).toHaveCount(2);
  await page.locator('[data-row="0"][data-column="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-row="0"][data-column="1"]')).toBeFocused();
  const projectedBefore = await page.locator("#model").inputValue();
  await page.getByRole("button", { name: "Copy value", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.copiedGridText)).toBe("1");
  assert.equal(await page.locator("#model").inputValue(), projectedBefore);
  await page.locator('[data-row="0"][data-column="1"]').focus();
  await page.keyboard.press("Control+End");
  await expect(page.locator('[data-row="2"][data-column="1"]')).toBeFocused();
  await page.getByRole("rowheader", { name: "Alpha", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Selected");
  await page.getByLabel("Grid view").selectOption("derived");
  await expect(page.locator(".grid-cell.derived")).toHaveCount(1);
  await page.locator(".grid-cell.derived").click();
  await expect(page.locator(".grid-actions")).toContainText(
    "Derived relation — read-only",
  );
  await expect(page.locator("[data-grid-tool]")).toHaveCount(0);
  await page.getByLabel("Grid view").selectOption("matrix");
  await expect(page.locator(".grid-cell.relation")).toHaveCount(1);
  // Hold the real commit request while newer manual typing takes buffer ownership.
  const beforeRace = await page.locator("#model").inputValue();
  await page.locator('[data-row="1"][data-column="0"]').click();
  await expect(page.locator('[data-grid-tool="trace-add"]')).toBeEnabled();
  await page.locator('.grid-actions input[name="name"]').fill("raceTrace");
  await page.evaluate(() => {
    const host = window.harness.host,
      request = host.request.bind(host);
    window.gridCommitHeld = false;
    host.request = async (method, params) => {
      if (method === "views/commitCommand") {
        window.gridCommitHeld = true;
        await new Promise((resolve) => {
          window.releaseGridCommit = resolve;
        });
      }
      return request(method, params);
    };
    window.restoreGridHost = () => {
      host.request = request;
    };
  });
  await page.locator('[data-grid-tool="trace-add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.gridCommitHeld))
    .toBe(true);
  await page.locator("#model").evaluate((area) => {
    area.value += "\n// typing during grid commit\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator(".grid-workbench")).toHaveClass(/stale/);
  await expect(page.locator("[data-grid-tool]")).toHaveCount(0);
  await page.evaluate(() => {
    window.releaseGridCommit();
    window.restoreGridHost();
  });
  await expect(page.locator("#model")).toHaveValue(/typing during grid commit/);
  await expect(page.locator("#model")).toHaveValue(/trace raceTrace/);
  await page.locator("#analyze").click();
  await expect(page.locator(".grid-workbench")).not.toHaveClass(/stale/);
  await expect(page.locator(".grid-cell.relation")).toHaveCount(2);
  await page.locator("#model").fill(beforeRace);
  await page.locator("#analyze").click();
  await expect(page.locator(".grid-cell.relation")).toHaveCount(1);
  await page.locator("#clear-scope").click();
  await expect(page.locator(".grid-row-header")).toHaveCount(0);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Clean model");
  await page.reload();
  await expect(page.locator(".diagram-node")).toHaveCount(0, {
    timeout: 60000,
  });
  await expect(page.getByLabel("Grid view",{exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel("Grid view",{exact:true}).selectOption("matrix");
  await expect(page.locator(".grid-row-header")).toHaveCount(0);
  // Large sparse wire fixture exercises both-axis virtualization without a large model/VM claim.
  await page.evaluate(async () => {
    const { GridCanvas } = await import("/packages/visualization/src/grid.ts");
    const accepted = await (
      await fetch(
        "/crates/intersect-views/tests/fixtures/grid-v7-accepted-m14.json",
      )
    ).json();
    const scene = accepted.find((v) => v.name === "matrix").value;
    const binding = scene.grid.rows[0].binding;
    scene.grid.rows = Array.from({ length: 500 }, (_, i) => ({
      id: `r:${i}`,
      label: `Row ${i}`,
      binding: { ...binding, key: `row:${i}`, elementId: `row:${i}` },
    }));
    scene.grid.columns = Array.from({ length: 128 }, (_, i) => ({
      id: `c:${i}`,
      label: `Column ${i}`,
      binding: { ...binding, key: `col:${i}`, elementId: `col:${i}` },
    }));
    scene.grid.cells = [];
    const root = document.createElement("div");
    root.id = "virtual-test";
    root.style.cssText = "position:fixed;inset:0;background:white;z-index:99";
    document.body.append(root);
    const canvas = new GridCanvas(root, {
      view() {},
      select() {},
      async command() {},
      presentation() {},
      save() {},
      palette() {},
      undo() {},
    });
    canvas.setScene({
      scene,
      presentation: {fingerprint:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",libraries:[]},
      capabilities: [{ toolId: "select", enabled: true, reason: "" }],
    });
  });
  await expect(page.locator("#virtual-test .grid-cell")).toHaveCount(800);
  await page.locator('#virtual-test [data-row="0"][data-column="0"]').focus();
  await page.keyboard.press("Control+End");
  await expect(
    page.locator('#virtual-test [data-row="499"][data-column="127"]'),
  ).toBeFocused();
  assert.ok((await page.locator("#virtual-test .grid-cell").count()) <= 801);
  await page.locator("#virtual-test .grid-viewport").evaluate((n) => {
    n.scrollTop = 0;
    n.scrollLeft = 0;
  });
  await expect(
    page.locator('#virtual-test [data-row="499"][data-column="127"]'),
  ).toHaveCount(1);
  assert.ok((await page.locator("#virtual-test .grid-cell").count()) <= 801);
  await page.locator("#virtual-test").evaluate((n) => n.remove());
  assert.deepEqual(errors, []);
  await page.getByLabel("Grid view").selectOption("matrix");
  await page.locator("#load-grid").click();
  await expect(page.locator(".grid-cell.relation")).toHaveCount(1);
  await page.locator(".grid-cell.relation").click();
  await expect(page.locator("[data-grid-tool]")).toHaveCount(2);
  await expect(page.locator(".grid-actions")).not.toContainText(
    "Checking applicability",
  );
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({
    path: process.env.HARNESS_SCREENSHOT ?? "docs/evidence/m7-browser.png",
    fullPage: true,
  });
  console.log(
    "M7 browser passed: real WASM table/matrix/derived, member delete/undo, create/undo, Issue refusal, keyboard/source, form switching, typing during commit, saved empty scope, 500x128 virtual focus with <=801 cells.",
  );
} finally {
  await browser?.close();
  await server.close();
}
