import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
      viewport: { width: 1700, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}languages/fmea/web/`);
  await expect(page.locator(".diagram-node")).toHaveCount(7, {
    timeout: 60000,
  });
  await expect(page.locator("#status")).toContainText("Clean FMEA");
  const failure = page.locator(".diagram-node").filter({
      has: page.locator(":scope > .node-title", { hasText: /^NoFlow$/ }),
    }),
    risk = failure.locator(":scope > .node-subtitle [data-label-part]");
  // Labels reveal the real declaration; selection cannot drag or edit it.
  const original = await page.locator("#model").inputValue(),
    transform = await failure.getAttribute("transform");
  await risk.dblclick();
  assert.equal(await failure.getAttribute("transform"), transform);
  assert.equal(await page.locator("#model").inputValue(), original);
  assert.match(
    await page
      .locator("#model")
      .evaluate((a) => a.value.slice(a.selectionStart, a.selectionEnd)),
    /^failure NoFlow/,
  );
  async function rate(s, o, d) {
    await risk.focus();
    await page.keyboard.press("F2");
    const apply = page.locator('.diagram-command button[type="submit"]');
    await expect(apply).toBeEnabled();
    for (const [name, value] of [
      ["Severity", s],
      ["Occurrence", o],
      ["Detection", d],
    ])
      await page.getByRole("textbox", { name, exact: true }).fill(value);
    await apply.click();
  }
  await rate("0", "3", "4");
  await expect(page.locator(".diagram-status:visible")).toContainText(
    "Severity must be from 1 to 10",
  );
  assert.equal(await page.locator("#model").inputValue(), original);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const id = await risk.getAttribute("data-label-part");
  await page.evaluate(() => {
    const host = window.fmea.host,
      request = host.request.bind(host);
    window.fmeaHintHeld = false;
    host.request = async (method, params) => {
      if (method === "views/labelTargets") {
        window.fmeaHintHeld = true;
        await new Promise((resolve) => (window.releaseFmeaHint = resolve));
      }
      return request(method, params);
    };
    window.restoreFmeaHint = () => (host.request = request);
  });
  await risk.focus();
  await page.keyboard.press("F2");
  await expect.poll(() => page.evaluate(() => window.fmeaHintHeld)).toBe(true);
  await expect(
    page.locator('.diagram-command button[type="submit"]'),
  ).toBeDisabled();
  for (const name of ["Severity", "Occurrence", "Detection"])
    await page.getByRole("textbox", { name, exact: true }).fill("10");
  await page.evaluate(() => {
    window.releaseFmeaHint();
    window.restoreFmeaHint();
  });
  await expect(
    page.locator('.diagram-command button[type="submit"]'),
  ).toBeEnabled();
  for (const name of ["Severity", "Occurrence", "Detection"])
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue(
      "10",
    );
  await page.locator('.diagram-command button[type="submit"]').click();
  await expect(risk).toHaveText("RPN 1000");
  assert.equal(await risk.getAttribute("data-label-part"), id);
  await expect(page.locator("#model")).toHaveValue(/ratings 10 10 10/);
  await page.locator("#undo-source").click();
  await expect(risk).toHaveText("RPN 96");
  await page.locator("#redo-source").click();
  await expect(risk).toHaveText("RPN 1000");
  const action = page.locator(".diagram-node").filter({
      has: page.locator(":scope > .node-title", { hasText: /^BackupPower$/ }),
    }),
    status = action.locator(":scope > .node-subtitle [data-label-part]");
  await status.focus();
  await page.keyboard.press("F2");
  let apply = page.locator('.diagram-command button[type="submit"]');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.locator(".diagram-status:visible")).toContainText(
    "requires an owner and evidence",
  );
  await page
    .getByRole("textbox", { name: "Owner", exact: true })
    .fill("QA team");
  await page
    .getByRole("textbox", { name: "Evidence", exact: true })
    .fill('Review "R-01" 🧭');
  await apply.click();
  await expect(status).toHaveText("done");
  await page.locator('[aria-label="Diagram view"]:visible').selectOption("actions");
  await expect(page.locator(".grid-row-header")).toHaveCount(3);
  await expect(page.locator('[data-row="1"][data-column="1"]')).toHaveText(
    "QA team",
  );
  await expect(page.locator('[data-row="1"][data-column="3"]')).toHaveText(
    'Review "R-01" 🧭',
  );
  await page.locator('[data-row="1"][data-column="1"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-row="1"][data-column="2"]')).toBeFocused();
  await page.keyboard.press("Enter");
  assert.match(
    await page
      .locator("#model")
      .evaluate((a) => a.value.slice(a.selectionStart, a.selectionEnd)),
    /^action BackupPower/,
  );
  await page.getByLabel("Grid view").selectOption("failures");
  await expect(page.locator(".grid-row-header")).toHaveCount(2);
  await expect(page.locator('[data-row="1"][data-column="4"]')).toHaveText(
    "10",
  );
  await expect(page.locator(".grid-cell.query")).toHaveCount(14);
  // An empty saved scope stays empty, and Show all restores the language-owned subjects.
  await page.locator("#clear-scope").click();
  await expect(page.locator(".grid-row-header")).toHaveCount(0);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("Clean FMEA");
  await page.reload();
  await expect(page.getByLabel("Grid view")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".grid-row-header")).toHaveCount(0);
  await page.locator("#show-all").click();
  try {
    await expect(page.locator(".grid-row-header")).toHaveCount(2);
  } catch (e) {
    console.log(
      await page.evaluate(() => ({
        selected: window.fmea.session.selectedView,
        scope: window.fmea.session.exploration().scope,
        analysis: window.fmea.session.analysis,
        status: document.querySelector("#status").textContent,
        canvas: document.querySelector(".grid-workbench .diagram-status")
          ?.textContent,
      })),
    );
    throw e;
  }
  await page.getByLabel("Grid view").selectOption("structure");
  await expect(page.locator(".diagram-node")).toHaveCount(7);
  // Real commit held while newer manual typing owns the buffer.
  await page.evaluate(() => {
    const host = window.fmea.host,
      request = host.request.bind(host);
    window.fmeaHeld = false;
    host.request = async (method, params) => {
      if (method === "views/commitCommand") {
        window.fmeaHeld = true;
        await new Promise((resolve) => (window.fmeaRelease = resolve));
      }
      return request(method, params);
    };
    window.fmeaRestore = () => (host.request = request);
  });
  await risk.focus();
  await page.keyboard.press("F2");
  apply = page.locator('.diagram-command button[type="submit"]');
  await expect(apply).toBeEnabled();
  await page.getByRole("textbox", { name: "Severity", exact: true }).fill("7");
  await apply.click();
  await expect.poll(() => page.evaluate(() => window.fmeaHeld)).toBe(true);
  await page.locator("#model").evaluate((a) => {
    a.value += "\n// newer manual FMEA typing\n";
    a.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => {
    window.fmeaRelease();
    window.fmeaRestore();
  });
  await expect(page.locator("#model")).toHaveValue(/newer manual FMEA typing/);
  await expect(
    page.getByRole("button", { name: "Set ratings", exact: true }),
  ).toBeDisabled();
  await page.locator("#analyze").click();
  await expect(page.locator("#status")).toContainText("Clean FMEA");
  await expect(risk).toHaveText("RPN 84");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  assert.equal(file.suggestedFilename(), "fmea-project.json");
  const exported = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(exported.sources.length, 5);
  assert.match(
    exported.sources.find((s) => s.uri === "pump.fmea").text,
    /newer manual FMEA typing/,
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: process.env.FMEA_SCREENSHOT ?? "docs/evidence/m11-fmea.png", fullPage: true });
  console.log(
    "PASS: real FMEA WASM, Rcore RPN, native worksheets, rating/action commands, validation isolation, source selection/keyboard, undo/redo, saved scope/reload, typing during commit and export.",
  );
} finally {
  await browser?.close();
  await server.close();
}
