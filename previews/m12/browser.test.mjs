import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const server = await createServer({ server: { port: 0, strictPort: false } });
const results = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1080 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}previews/m12/`);
  await expect(page.locator("#status")).toContainText("Ready.");
  await expect(page.locator("[data-instance]")).toHaveCount(4);
  await expect(page.getByText("Visual prototype", { exact: true })).toBeVisible();
  results.push("Initial fixture compositions render with explicit prototype status");

  const doc = page.locator('[data-binding="fixture:MassRequirement/doc"]');
  const before = Number(await doc.getAttribute("data-text-lines"));
  const identity = await doc.getAttribute("data-hit");
  await page.locator("#width").fill("250");
  await expect(doc).toHaveAttribute("data-hit", identity);
  assert.ok(Number(await doc.getAttribute("data-text-lines")) > before);
  await doc.click();
  await expect(page.locator("#selection")).toContainText("fixture:MassRequirement/doc");
  results.push("Width reflow preserves logical part identity and fixture selection");

  const start = await page.locator("[data-edge]").getAttribute("data-start");
  await page.locator("#rotation").fill("90");
  await expect(page.locator('[data-terminal="vehicle"]')).toHaveAttribute("transform", /rotate\(90\)/);
  const after = await page.locator("[data-edge]").getAttribute("data-start");
  assert.notEqual(after, start);
  assert.equal(after, await page.locator('[data-terminal="vehicle"]').getAttribute("data-anchor"));
  results.push("Rotated terminal and attached wire share the transformed anchor");

  await page.locator("#documentation").uncheck();
  await expect(doc).toHaveCount(0);
  await page.locator("#documentation").check();
  await expect(doc).toHaveCount(1);
  await page.locator("#definition").selectOption("element");
  const edited = JSON.parse(await page.locator("#definition-source").inputValue());
  edited.fill = "#f0edfc";
  await page.locator("#definition-source").fill(JSON.stringify(edited));
  await page.getByRole("button", { name: "Apply definition", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Applied element");
  for (const id of ["vehicle", "mass", "vehicle_b"])
    await expect(page.locator(`[data-instance="${id}"] > g > rect.body`)).toHaveAttribute("fill", "#f0edfc");
  results.push("One accepted definition edit updates every reuse");

  const accepted = await page.locator("#canvas").innerHTML();
  await page.getByRole("button", { name: "Try invalid definition" }).click();
  await expect(page.locator("#status")).toContainText("Rejected:");
  assert.equal(await page.locator("#canvas").innerHTML(), accepted);
  await page.locator("#definition-source").fill(JSON.stringify({ kind: "use", id: "loop", definition: "element" }));
  await page.getByRole("button", { name: "Apply definition", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Definition cycle");
  assert.equal(await page.locator("#canvas").innerHTML(), accepted);
  await page.getByRole("button", { name: "Restore definition" }).click();
  results.push("Unsupported parts and recursive definitions refuse atomically");

  await page.locator("#example").selectOption("electrical");
  await expect(page.locator("[data-instance]")).toHaveCount(2);
  await expect(page.locator("#scene-title")).toHaveText("Electrical symbol compositions");
  await page.locator("#example").selectOption("fault");
  await expect(page.locator("#scene-title")).toHaveText("Fault event & gate compositions");
  await page.locator("#theme").selectOption("mono");
  await expect(page.locator('[data-instance="failure"] > g > rect.body')).toHaveAttribute("fill", "#ffffff");
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await page.reload();
  await expect(page.locator("#example")).toHaveValue("fault");
  await expect(page.locator("#rotation")).toHaveValue("90");
  await expect(page.locator("#width")).toHaveValue("250");
  await expect(page.locator("#theme")).toHaveValue("mono");
  results.push("All three fixture libraries share the interpreter; saved controls survive reload");

  await page.locator("#example").selectOption("sysml");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await mkdir("target/m12-preview", { recursive: true });
  await page.screenshot({ path: "target/m12-preview/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#example")).toBeVisible();
  await expect(page.locator("#apply")).toBeVisible();
  await page.screenshot({ path: "target/m12-preview/mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  results.push("Desktop and narrow layouts render without page errors");
  await writeFile("target/m12-preview/results.json", JSON.stringify({ status: "passed", scope: "Standalone visual prototype only; no native/WASM engine qualification", checks: results }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: results.length, checks: results }));
} finally {
  await browser?.close();
  await server.close();
}
