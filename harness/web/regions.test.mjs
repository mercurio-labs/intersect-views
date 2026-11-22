import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
      viewport: { width: 1700, height: 1050 },
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
  await page.locator("#load-regions").click();
  await expect(page.locator(".diagram-region")).toHaveCount(4, {
    timeout: 60000,
  });
  await expect(page.locator(".diagram-edge")).toHaveCount(2);
  const alpha = page.locator(".diagram-node").filter({
    has: page.locator(":scope > .node-title", { hasText: /^Alpha/ }),
  });
  const regions = alpha.locator(":scope > .diagram-region");
  async function geometry() {
    const issues = await alpha.evaluate((root) => {
      const issues = [],
        world = document.querySelector(".diagram-world"),
        matrix = world.getCTM().inverse();
      const box = (el) => {
        const b = el.getBBox(),
          m = el.getCTM();
        const a = new DOMPoint(b.x, b.y)
            .matrixTransform(m)
            .matrixTransform(matrix),
          z = new DOMPoint(b.x + b.width, b.y + b.height)
            .matrixTransform(m)
            .matrixTransform(matrix);
        return { x: a.x, y: a.y, width: z.x - a.x, height: z.y - a.y };
      };
      const regions = [...root.children].filter((e) =>
        e.classList.contains("diagram-region"),
      );
      for (let i = 0; i < regions.length; i++) {
        const r = box(regions[i].querySelector(":scope > rect"));
        for (let j = i + 1; j < regions.length; j++) {
          const q = box(regions[j].querySelector(":scope > rect"));
          if (
            !(
              r.x + r.width <= q.x + 0.1 ||
              q.x + q.width <= r.x + 0.1 ||
              r.y + r.height <= q.y + 0.1 ||
              q.y + q.height <= r.y + 0.1
            )
          )
            issues.push("Partition interiors overlap");
          const gap=Math.max(q.x-r.x-r.width,r.x-q.x-q.width,q.y-r.y-r.height,r.y-q.y-q.height);
          if(gap<20-.1)issues.push("Partition routing gutter is missing");
        }
        for (const child of regions[i].querySelectorAll(
          ":scope > .diagram-node > .node-body",
        )) {
          const c = box(child);
          if (
            c.x < r.x ||
            c.y < r.y ||
            c.x + c.width > r.x + r.width + 0.1 ||
            c.y + c.height > r.y + r.height + 0.1
          )
            issues.push("Child escaped partition");
        }
      }
      const port = root.querySelector(".diagram-region .diagram-port rect"),
        edge = document.querySelector(".diagram-edge .edge-line");
      if (port && edge) {
        const p = new DOMPoint(
            Number(port.getAttribute("x")) + 6,
            Number(port.getAttribute("y")) + 6,
          )
            .matrixTransform(port.getCTM())
            .matrixTransform(matrix),
          start = edge
            .getAttribute("d")
            .match(/-?\d+(?:\.\d+)?/g)
            .slice(0, 2)
            .map(Number);
        if (Math.abs(p.x - start[0]) > 1 || Math.abs(p.y - start[1]) > 1)
          issues.push("Cross-partition edge detached");
      }
      return issues;
    });
    assert.deepEqual(issues, []);
  }
  await geometry();
  const source = await page.locator("#model").inputValue(),
    before = await alpha.getAttribute("transform");
  await alpha
    .locator(":scope > .node-title [data-label-part]")
    .nth(1)
    .dblclick();
  assert.equal(await alpha.getAttribute("transform"), before);
  assert.equal(await page.locator("#model").inputValue(), source);
  assert.match(
    await page
      .locator("#model")
      .evaluate((n) => n.value.slice(n.selectionStart, n.selectionEnd)),
    /^kind Shared/,
  );
  const body = await alpha.locator(":scope > .node-body").boundingBox();
  await page.mouse.move(body.x + 7, body.y + 50);
  await page.mouse.down();
  await page.mouse.move(body.x + 57, body.y + 65, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(()=>window.harness.canvas.whenReady());
  assert.notEqual(await alpha.getAttribute("transform"), before);
  await geometry();
  const handle = await alpha.locator(":scope > .node-resize").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 3);
  await page.mouse.down();
  await page.mouse.move(handle.x + 83, handle.y + 73, { steps: 6 });
  await geometry();
  await page.mouse.up();
  await page.evaluate(()=>window.harness.canvas.whenReady());
  await expect
    .poll(
      async () =>
        await alpha.locator(":scope > .node-body").getAttribute("width"),
    )
    .not.toBe(String(body.width));
  await geometry();
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Clean model");
  await page.reload();
  await expect(page.locator('[aria-label="Diagram view"]:visible')).toBeVisible({ timeout: 60000 });
  await page.locator('[aria-label="Diagram view"]:visible').selectOption("regions");
  await expect(page.locator(".diagram-region")).toHaveCount(4, {
    timeout: 60000,
  });
  await geometry();

  // An internal move cannot cross its region separator or reparent the member.
  const member = alpha
    .locator(":scope > .diagram-region > .diagram-node")
    .first();
  const start = await member.evaluate((n) => {
    const p = new DOMPoint(8, 45).matrixTransform(n.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  const originalModel = await page.locator("#model").inputValue();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 500, start.y + 150, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(()=>window.harness.canvas.whenReady());
  await geometry();
  assert.equal(await page.locator("#model").inputValue(), originalModel);
  // Both declarations are the same Field; F2 opens the language-owned action.
  const values = page
    .locator(".diagram-field [data-label-part]")
    .filter({ hasText: /^low$/ });
  await expect(values).toHaveCount(2);
  const stablePart = await values.first().getAttribute("data-label-part");
  await values.first().focus();
  await page.keyboard.press("F2");
  const apply = page.locator('.diagram-command button[type="submit"]');
  await expect(apply).toBeEnabled();
  await page.getByRole("textbox", { name: "Value", exact: true }).fill("9");
  await apply.click();
  await expect(
    page
      .locator(".diagram-field [data-label-part]")
      .filter({ hasText: /^high$/ }),
  ).toHaveCount(2);
  assert.equal(
    await page.locator(`[data-label-part="${stablePart}"]`).textContent(),
    "high",
  );
  await expect(page.locator("#model")).toHaveValue(/field level = 9/);
  await page.locator("#undo-source").click();
  await expect(page.locator("#model")).toHaveValue(/field level = 2/);
  await expect(values).toHaveCount(2);
  await page.locator("#redo-source").click();
  await expect(
    page
      .locator(".diagram-field [data-label-part]")
      .filter({ hasText: /^high$/ }),
  ).toHaveCount(2);
  // An empty Group stays visible, with Unicode punctuation and an empty bound hit.
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Extra" + "W".repeat(96));
  await expect(alpha).toHaveClass(/diagram-legal-target/);
  const ab = await alpha.evaluate((n) => {
    const p = new DOMPoint(8, 45).matrixTransform(n.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(ab.x, ab.y);
  await expect(page.locator(".diagram-region")).toHaveCount(5);
  await expect(page.locator("#model")).toHaveValue(/group Extra/);
  const extra = alpha.locator(":scope > .diagram-region").filter({
    has: page.locator(":scope > .region-label", { hasText: /^Extra/ }),
  });
  await expect(extra).toHaveCount(1);
  await expect(extra.locator(":scope > .diagram-node")).toHaveCount(0);
  assert.ok(
    await extra
      .locator("[data-label-part][tabindex]")
      .last()
      .getAttribute("aria-label"),
  );
  assert.equal(
    await extra
      .locator(":scope > .region-label [data-label-part]")
      .first()
      .textContent(),
    "Extra" + "W".repeat(96),
  );
  assert.equal(
    await extra.evaluate(
      (n) =>
        n.querySelector(".region-label").getBBox().width <=
        Number(n.querySelector(":scope > rect").getAttribute("width")),
    ),
    true,
    "Long Unicode/empty label clipped",
  );
  // Reject contextual notation, keep the current profile and stale scene; recover without source editing.
  await page
    .locator("#notation")
    .evaluate((el) => (el.closest("details").open = true));
  const profile = JSON.parse(await page.locator("#notation").inputValue());
  profile.shapes.box.shape = "ellipse";
  await page.locator("#notation").fill(JSON.stringify(profile));
  await page.locator("#notation-apply").click();
  await expect(page.locator("#status")).toContainText("graph.notation.regions");
  await expect(
    page.getByRole("button", { name: "Group", exact: true }),
  ).toBeDisabled();
  profile.shapes.box.shape = "rounded";
  await page.locator("#notation").fill(JSON.stringify(profile));
  await page.locator("#notation-apply").click();
  await expect(
    page.getByRole("button", { name: "Group", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await page.locator('[aria-label="Diagram view"]:visible').selectOption("regions-column");
  // Example navigation seeds compatible projections. Clear this view explicitly
  // before checking incremental model-tree additions.
  await expect(page.locator(".diagram-region")).toHaveCount(5);
  await page.locator("#clear-scope").click();
  await expect(page.locator(".diagram-region")).toHaveCount(0);
  await expect(page.locator(".diagram-node")).toHaveCount(0);
  await page.getByRole("tab",{name:"Model",exact:true}).click();
  if(await page.locator(".workbench-tree").getAttribute("open")===null)await page.locator(".workbench-tree > summary").click();
  await page.getByTitle("Add Alpha to diagram", { exact: true }).click();
  await expect(page.locator(".diagram-region")).toHaveCount(3);
  await page.getByTitle("Add Beta to diagram", { exact: true }).click();
  await expect(page.locator(".diagram-region")).toHaveCount(5);
  await geometry();
  // Collapsing one inherited Group never collapses the other occurrence.
  const left = alpha.locator(":scope > .diagram-region").filter({
    has: page.locator(":scope > .region-label", { hasText: /^Left/ }),
  });
  const nestedHeader = await left
    .locator(":scope > .diagram-node")
    .evaluate((n) => {
      const p = new DOMPoint(5, 50).matrixTransform(n.getScreenCTM());
      return { x: p.x, y: p.y };
    });
  await page.mouse.click(nestedHeader.x, nestedHeader.y, { button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Collapse occurrence", exact: true }),
  ).toBeVisible();
  await page
    .locator(".diagram-scope-menu")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const header = await left.evaluate((n) => {
    const p = new DOMPoint(5, 5).matrixTransform(n.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  const beforeCollapse=await page.evaluate(()=>structuredClone(window.harness.canvas.graph.response.scene.edges));
  await page.mouse.click(header.x, header.y, { button: "right" });
  await page
    .getByRole("menuitem", { name: "Collapse region", exact: true })
    .click();
  await expect(page.locator(".diagram-node")).toHaveCount(5);
  await expect(page.locator(".diagram-edge")).toHaveCount(2);
  await expect(page.locator(".diagram-proxy")).toHaveCount(1);
  assert.deepEqual(await page.evaluate(()=>window.harness.canvas.graph.response.scene.edges),beforeCollapse);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Clean model");
  await page.reload();
  await expect(page.locator('[aria-label="Diagram view"]:visible')).toBeVisible({ timeout: 60000 });
  await page.locator('[aria-label="Diagram view"]:visible').selectOption("regions-column");
  await expect(page.locator(".diagram-node")).toHaveCount(5);

  assert.deepEqual(errors, []);
  await page.screenshot({ path: process.env.HARNESS_SCREENSHOT ?? "docs/evidence/m8-gate.png", fullPage: true });
  console.log(
    "PASS: M8 browser geometry, editing, undo/redo, empty Group, notation guard, region collapse/save/reload, keyboard actions; real WASM repeated regions, disjoint bounds, attached endpoints after move/resize/reload, and separately bound label reveal without drag/source mutation.",
  );
} finally {
  await browser?.close();
  await server.close();
}
