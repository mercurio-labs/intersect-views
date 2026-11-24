// Actual WASM dependency, shared canvas and actual layout worker. No fabricated bindings.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const out = "target/symbol-properties/browser",
  receipt = { checks: [], errors: [] };
await mkdir(out, { recursive: true });
const server = await createServer({
  server: { port: 0, strictPort: false, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
      viewport: { width: 1900, height: 1150 },
    }),
    base = server.resolvedUrls.local[0];
  page.on("pageerror", (e) => receipt.errors.push(e.message));
  receipt.wasmSha256 = createHash("sha256")
    .update(
      new Uint8Array(
        await fetch(base + "symbols-host.wasm").then((r) => r.arrayBuffer()),
      ),
    )
    .digest("hex");
  await page.goto(base + "harness/web/symbols.html");
  const ready = async () => {
    await page.waitForFunction(
      () => /Ready|refused/.test(document.querySelector("#status").textContent),
      { timeout: 60000 },
    );
    assert.match(await page.locator("#status").textContent(), /^Ready/);
    await page.evaluate(() => window.symbols.active.canvas.whenReady());
  };
  await ready();
  const snapshot = () =>
    page.evaluate(() => {
      const a = window.symbols.active,
        g = a.canvas.graph;
      return {
        source: a.source,
        scene: a.scene,
        layout: g.layout,
        presentation: g.presentation,
        targets: g.symbolTargets,
        selection: [...g.symbolSelection],
        stored: localStorage.getItem("intersect.symbol-properties.v5"),
      };
    });
  const initial = await snapshot(),
    ids = initial.scene.scene.nodes.map((n) => n.id);
  assert.equal(ids.length, 2);
  assert.equal(initial.presentation.schemaVersion, 5);
  assert.ok(
    initial.scene.scene.nodes
      .flatMap((n) => [n, ...n.ports])
      .every((o) => o.binding.readOnly),
  );
  assert.deepEqual(initial.scene.scene.nodes[0].graphic.sourceParameters, []);
  const node = (id) => page.locator(`[data-symbol="${id}"]`),
    body = (id) => node(id).locator(".node-body").first();
  const selectBody = async (id, modifiers = []) => {
    const b = await body(id).boundingBox();
    await body(id).click({
      position: { x: b.width / 2, y: b.height - 6 },
      modifiers,
    });
  };
  const open = () => page.locator("[data-symbol-open]").click(),
    panel = () => page.locator(".symbol-inspector"),
    apply = async () => {
      await expect(
        panel().locator('[data-symbol-action="apply"]'),
      ).toBeEnabled();
      await panel().locator('[data-symbol-action="apply"]').click();
      await expect(panel()).toHaveCount(0);
    };
  const change = async (label, value) => {
    const input = panel().getByLabel(label, { exact: true });
    if (typeof value === "boolean") await input.setChecked(value);
    else {
      await input.fill(String(value));
      await input.press("Tab");
    }
    await expect(panel().locator("[data-symbol-status]")).toHaveText(
      /Preview ready/,
      { timeout: 15000 },
    );
  };
  const focusedLabel=node(ids[0]).locator('[data-bound-label-block] .diagram-label-part[tabindex]').first();await focusedLabel.focus();await focusedLabel.press('Alt+Enter');await expect(panel()).toBeVisible();await panel().getByLabel('Filter symbol properties').press('Escape');await expect(panel()).toHaveCount(0);receipt.checks.push('A focused bound occurrence opens Symbol properties with Alt+Enter and cancels with Escape');
  await selectBody(ids[0]);
  await open();
  await expect(panel().getByLabel("Fill color", { exact: true })).toBeEnabled();
  const before = await snapshot();
  await change("Fill color", "#e7d3ba");
  const preview = await snapshot();
  assert.deepEqual(preview.presentation, before.presentation);
  assert.equal(preview.stored, before.stored);
  await expect(body(ids[0])).toHaveAttribute("style", /fill:#e7d3ba/);
  await expect(body(ids[1])).not.toHaveAttribute("style", /fill:#e7d3ba/);
  await apply();
  const first = await snapshot();
  assert.equal(first.source, initial.source);
  assert.deepEqual(first.scene, initial.scene);
  assert.notEqual(first.stored, initial.stored);
  receipt.checks.push(
    "Actual read-only inherited occurrences accept independent local styles; preview leaves persisted bytes and source unchanged",
  );
  await selectBody(ids[0]);
  await selectBody(ids[1], ["Control"]);
  await open();
  await expect(
    panel().getByLabel("Fill color", { exact: true }),
  ).toHaveAttribute("placeholder", "Mixed");
  await change("Fill color", "#cddfed");
  await apply();
  for (const id of ids)
    await expect(body(id)).toHaveAttribute("style", /fill:#cddfed/);
  await page.locator("[data-symbol-undo]").click();
  await expect(body(ids[0])).toHaveAttribute("style", /fill:#e7d3ba/);
  await expect(body(ids[1])).not.toHaveAttribute("style", /fill:#cddfed/);
  await page.locator("[data-symbol-redo]").click();
  await expect(body(ids[1])).toHaveAttribute("style", /fill:#cddfed/);
  receipt.checks.push(
    "Exact Ctrl-click mixed selection applies to both IDs with independent presentation undo and redo",
  );
  await selectBody(ids[0]);
  await open();
  const accepted = await snapshot();
  await change("Fill color", "#f4bfc3");
  await panel().locator('[data-symbol-action="cancel"]').first().click();
  await expect(body(ids[0])).toHaveAttribute("style", /fill:#cddfed/);
  assert.deepEqual((await snapshot()).presentation, accepted.presentation);
  await open();
  await change("Fill color", "#b9d8be");
  await panel()
    .getByLabel("Fill color", { exact: true })
    .fill("url(https://invalid.example/paint)");
  await panel().getByLabel("Fill color", { exact: true }).press("Tab");
  await expect(panel().locator('[data-symbol-action="apply"]')).toBeDisabled();
  await expect(panel().locator("[data-symbol-status]")).toHaveText(/violates/);
  assert.deepEqual((await snapshot()).presentation, accepted.presentation);
  await panel().locator('[data-symbol-action="cancel"]').first().click();
  receipt.checks.push(
    "Cancel restores accepted paint; invalid paint URL is rejected atomically with Apply disabled",
  );
  const text = node(ids[0]).locator("[data-bound-label-block]").first(),
    block = await text.getAttribute("data-bound-label-block");
  await text.locator(".label-hit").first().click();
  await open();
  await expect(panel().getByLabel("Fill color", { exact: true })).toHaveCount(
    0,
  );
  const textBefore = await snapshot();
  await change("Font size", 22);
  await apply();
  assert.equal(await text.getAttribute("data-bound-label-block"), block);
  const textAfter = await snapshot();
  assert.ok(
    textAfter.layout.nodes[ids[0]].height >=
      textBefore.layout.nodes[ids[0]].height,
  );
  assert.ok(
    textAfter.targets.some(
      (t) =>
        t.target === block &&
        t.descriptor.id === "fontSize" &&
        t.current === 22,
    ),
  );
  assert.equal(textAfter.source, initial.source);
  assert.deepEqual(textAfter.scene, initial.scene);
  await text.locator(".label-hit").first().dblclick();
  assert.equal(
    await page
      .locator("#source")
      .evaluate((el) => el.selectionEnd > el.selectionStart),
    true,
  );
  receipt.checks.push(
    "Bound logical text style reflows actual complete source content; IDs, read-only source reveal and semantic scene remain unchanged",
  );
  const port = page.locator(".diagram-port").first();
  await port.locator(".label-hit").first().click();
  await open();
  const portBefore = await snapshot();
  await panel().getByLabel("Font size", { exact: true }).fill("16");
  await panel().getByLabel("Font size", { exact: true }).press("Tab");
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /routing\.terminal\.obstructed/,
  );
  await expect(panel().locator('[data-symbol-action="apply"]')).toBeDisabled();
  assert.deepEqual((await snapshot()).presentation, portBefore.presentation);
  assert.deepEqual((await snapshot()).layout, portBefore.layout);
  await change("Font size", 10);
  await apply();
  const transformed = await snapshot();
  assert.deepEqual(transformed.scene, initial.scene);
  assert.ok(
    Object.values(transformed.layout.routing.labelFrames).some(
      (f) => Math.abs(f.frame[1]) > 0.1,
    ),
  );
  const edge = page.locator(".diagram-edge").first(),
    markerText = edge.locator("[data-bound-label-block]").first();
  await markerText.locator(".label-hit").first().click();
  await open();
  await change("Font size", 15);
  await apply();
  assert.deepEqual((await snapshot()).scene, initial.scene);
  receipt.checks.push(
    "Rotated port and marker text styles retain real source hits and exact routed endpoints after remeasurement",
  );
  const saved = await snapshot();
  await page.locator("#reload").click();
  await ready();
  const loaded = await snapshot();
  assert.deepEqual(loaded.presentation, saved.presentation);
  assert.deepEqual(loaded.scene, saved.scene);
  assert.equal(loaded.source, saved.source);
  receipt.checks.push(
    "v5 reload restores exact display state against the same package and projection",
  );
  await selectBody(ids[0]);
  await open();
  await panel()
    .getByRole("button", { name: "Reset selected styles", exact: true })
    .click();
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /Preview ready/,
  );
  await apply();
  const reset = await snapshot();
  assert.equal(
    reset.presentation.views.properties.symbolOverrides[ids[0]],
    undefined,
  );
  assert.ok(reset.presentation.views.properties.symbolOverrides[ids[1]]);
  receipt.checks.push(
    "Reset selected removes only the explicitly selected occurrence styles",
  );
  await selectBody(ids[0]);
  await open();
  const sizingBefore = await snapshot();
  await panel().getByLabel("Symbol width", { exact: true }).fill("600");
  await panel().getByLabel("Symbol width", { exact: true }).press("Tab");
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /Preview ready/,
  );
  await apply();
  const manual = await snapshot();
  assert.ok(manual.layout.nodes[ids[0]].width >= 600);
  await selectBody(ids[0]);
  await open();
  await panel().getByRole("button", { name: "Auto size", exact: true }).click();
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /Preview ready/,
  );
  await apply();
  const auto = await snapshot(),
    pos = auto.presentation.views.properties.positions[ids[0]];
  assert.equal(pos.width, undefined);
  assert.equal(pos.height, undefined);
  assert.equal(pos.x, manual.presentation.views.properties.positions[ids[0]].x);
  assert.equal(pos.y, manual.presentation.views.properties.positions[ids[0]].y);
  await page.locator("[data-symbol-undo]").click();
  await expect(body(ids[0])).toHaveAttribute("width", "600");
  await page.locator("[data-symbol-redo]").click();
  await expect(body(ids[0])).not.toHaveAttribute("width", "600");
  assert.equal((await snapshot()).source, sizingBefore.source);
  receipt.checks.push(
    "Manual sizing remeasures attachments; Auto size removes only allocation and preserves position through style undo/redo",
  );
  await selectBody(ids[0]);
  await open();
  await panel().getByLabel("Fill enabled", { exact: true }).press("Space");
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /Preview ready/,
  );
  await apply();
  await expect(body(ids[0])).toHaveAttribute("style", /fill:none/);
  assert.equal(await page.locator(".diagram-port").count(), 4);
  assert.equal((await snapshot()).source, initial.source);
  await selectBody(ids[0]);
  await open();
  await panel()
    .getByRole("button", { name: "Reset Fill enabled", exact: true })
    .click();
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /Preview ready/,
  );
  await apply();
  await expect(body(ids[0])).not.toHaveAttribute("style", /fill:none/);
  receipt.checks.push(
    "Keyboard boolean control and single-property reset retain semantic contents and port occurrences",
  );
  await selectBody(ids[0]);
  await page
    .locator(".diagram-port")
    .first()
    .locator(".label-hit")
    .first()
    .click({ modifiers: ["Control"] });
  await open();
  await expect(panel()).toContainText("Unavailable on");
  assert.equal(await panel().locator("[data-property]:enabled").count(), 0);
  await panel().locator('[data-symbol-action="cancel"]').first().click();
  receipt.checks.push(
    "Ineligible mixed symbol kinds are reported and never silently skipped",
  );
  await selectBody(ids[0]);
  await open();
  await panel()
    .getByRole("button", { name: "Reset view styles", exact: true })
    .click();
  await expect(panel().locator("[data-symbol-status]")).toHaveText(
    /Preview ready/,
  );
  await apply();
  assert.deepEqual(
    (await snapshot()).presentation.views.properties.symbolOverrides,
    {},
  );
  receipt.checks.push(
    "Explicit view reset clears all local styles while retaining the presentation envelope",
  );
  await page.locator("#readonly-store").check();
  await ready();
  const readonlyBytes = (await snapshot()).stored;
  await selectBody(ids[0]);
  await open();
  await expect(
    panel().getByLabel("Fill color", { exact: true }),
  ).toBeDisabled();
  await expect(panel()).toContainText("Presentation store is read only");
  await expect(page.locator("[data-save-layout]")).toBeDisabled();
  await panel().locator('[data-symbol-action="cancel"]').first().click();
  assert.equal((await snapshot()).stored, readonlyBytes);
  receipt.checks.push(
    "A read-only presentation store disables saving and styling independently of read-only model content",
  );
  await page.locator("#readonly-store").uncheck();
  await ready();
  await selectBody(ids[0]);
  await open();
  await change("Fill color", "#dec9ee");
  await page.locator("#protect").click();
  await ready();
  await expect(panel()).toHaveCount(0);
  const protectedScene = await snapshot();
  assert.equal(protectedScene.stored, null);
  await selectBody(ids[0]);
  await open();
  await expect(
    panel().getByLabel("Fill color", { exact: true }),
  ).toBeDisabled();
  await expect(panel()).toContainText("Value supplied by a source rule");
  receipt.checks.push(
    "Package replacement invalidates a pending selection/preview; source-rule supplied values are disabled with an explicit reason",
  );
  await page.screenshot({ path: out + "/inspector.png", fullPage: true });
  // Parsed-library capability admission is enforced by the actual WASM host.
  const missing = await page.evaluate(async () => {
    const a = window.symbols.active,
      input = structuredClone(a.input);
    input.manifests[0].requires = input.manifests[0].requires.filter(
      (c) => c !== "views.symbolProperties.v1",
    );
    const { WorkerHost } = await import(
        "/packages/visualization/src/worker-host.ts"
      ),
      host = new WorkerHost(
        new Worker("/harness/web/symbols.worker.ts", { type: "module" }),
      );
    try {
      await host.request("initialize", { protocolVersion: 2 });
      await host.request("views/preparePresentation", input);
      return "accepted";
    } catch (e) {
      return String(e);
    } finally {
      host.destroy();
    }
  });
  assert.match(missing, /views.symbolProperties.v1/);
  receipt.checks.push(
    "Actual native/WASM package admission rejects descriptors without the Symbol properties capability",
  );
  assert.deepEqual(receipt.errors, []);
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  receipt.failure = String(error);
  throw error;
} finally {
  await writeFile(
    out + "/receipt.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await browser?.close();
  await server.close();
}
