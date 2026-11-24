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
      viewport: { width: 1500, height: 950 },
    }),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.goto(`${server.resolvedUrls.local[0]}harness/web/`);
  await expect(page.locator(".diagram-node")).toHaveCount(6, {
    timeout: 60000,
  });
  await expect(page.locator(".diagram-edge")).toHaveCount(3);
  await expect(page.locator("#status")).toContainText("Clean model");
  const node = page.locator(".diagram-node").filter({
    has: page.locator(":scope > .node-title", { hasText: /^Beta$/ }),
  });
  const title = node.locator(":scope > .node-title");
  await title.click();
  await expect(page.locator("#status")).toContainText("Selected");
  const before = await node.getAttribute("transform");
  const point = await node.evaluate((n) => {
    const p = new DOMPoint(8, 45).matrixTransform(n.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 45, point.y + 30, { steps: 8 });
  await page.mouse.up();
  assert.notEqual(await node.getAttribute("transform"), before);
  await page
    .locator(".diagram-node > .node-title")
    .filter({ hasText: /^Alpha$/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Expand: Linked boxes" }).click();
  await expect(page.locator("#scope-count")).toHaveText("3 scope operations");
  await expect(page.locator(".diagram-node")).toHaveCount(7);
  const beta = page.locator(".diagram-node").filter({
    has: page.locator(":scope > .node-title", { hasText: /^Beta$/ }),
  });
  await beta.locator(":scope > .node-title").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Collapse occurrence" }).click();
  try { await expect(beta.locator(".diagram-port")).toHaveCount(0); }
  catch(error){console.error(await page.evaluate(()=>({status:document.querySelector("#status").textContent,layoutStatus:document.querySelector(".diagram-status").textContent,scene:window.harness.canvas.graph.response?.scene,scope:document.querySelector("#view").value})));throw error;}
  await beta.locator(":scope > .node-title").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide root" }).click();
  await expect(beta).toHaveCount(0);
  await page.locator("#notation").evaluate((el) => {
    el.closest("details").open = true;
  });
  const profile = JSON.parse(await page.locator("#notation").inputValue());
  profile.shapes.box = { shape: "ellipse", fill: "#e8f0ff", stroke: "#345678" };
  profile.styleClasses = {};
  await page.locator("#notation").fill(JSON.stringify(profile, null, 2));
  await page
    .getByRole("button", { name: "Apply notation", exact: true })
    .click();
  await expect(page.locator("ellipse.node-body")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Analyze source", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Clean model");
  // Tree API adds a root without modifying model source.
  const source = await page.locator("#model").inputValue();
  await page.getByRole("tab", { name: "Model", exact: true }).click();
  await page.locator(".workbench-tree > summary").click();
  await page.getByTitle("Add Beta to diagram").click();
  await expect(beta).toHaveCount(1);
  assert.equal(await page.locator("#model").inputValue(), source);
  await page
    .getByRole("button", { name: "Save project", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Clean model");
  const savedCount = await page.locator(".diagram-node").count();
  await page.reload();
  await expect(page.locator(".diagram-node")).toHaveCount(savedCount, {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Clear scope", exact: true }).click();
  await expect(page.locator(".diagram-node")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save project", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Clean model");
  await page.reload();
  await expect(page.locator("#status")).toContainText("Clean model", {
    timeout: 60000,
  });
  await expect(page.locator(".diagram-node")).toHaveCount(0);
  // Invalid model source gates scenes and reports located diagnostics.
  await page
    .locator("#model")
    .fill(
      "space Broken { box X { field duplicate = 1; field duplicate = 2; } }",
    );
  await page
    .getByRole("button", { name: "Analyze source", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Model has diagnostics");
  await expect(page.locator("#diagnostics")).toContainText(
    "harness.names.unique",
  );
  await page
    .getByRole("button", { name: "Reset example", exact: true })
    .click();
  await expect(page.locator(".diagram-node")).toHaveCount(6, {
    timeout: 60000,
  });
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({
    path: process.env.HARNESS_SCREENSHOT ?? "docs/evidence/m5-harness.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real WASM render, select, move, expand, collapse, hide, notation shape, tree seed, save/reload, validation and recovery; no page errors.",
  );
} finally {
  await browser?.close();
  await server.close();
}
