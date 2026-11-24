import assert from "node:assert/strict";
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
  await page.goto(`${server.resolvedUrls.local[0]}harness/web/`);
  await expect(page.locator(".diagram-node")).toHaveCount(6, {
    timeout: 60000,
  });
  const beta = page.locator(".diagram-node").filter({
    has: page.locator(":scope > .node-title", { hasText: /^Beta$/ }),
  });
  async function clickOwner() {
    const p = await beta.evaluate((n) => {
      for (const x of [5, 10, 20, 30, 50])
        for (const y of [40, 50, 60]) {
          const p = new DOMPoint(x, y).matrixTransform(n.getScreenCTM()),
            el = document.elementFromPoint(p.x, p.y);
          if (el === n.querySelector(":scope > .node-body"))
            return { x: p.x, y: p.y };
        }
      throw new Error("No exposed owner body hit");
    });
    await page.mouse.click(p.x, p.y);
  }
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.locator("[data-symbol].diagram-legal-target")).toHaveCount(
    6,
  );
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("BrowserBox");
  // Native palette drag/drop and click-to-place both use the same transaction.
  await page
    .getByRole("button", { name: "Box", exact: true })
    .dragTo(beta.locator(":scope > .node-body"), {
      targetPosition: { x: 5, y: 30 },
    });
  await expect(page.locator(".diagram-node")).toHaveCount(7);
  await expect(page.locator("#model")).toHaveValue(/box BrowserBox/);
  await expect(page.locator("#status")).toContainText("revision 2");
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.locator("[data-symbol].diagram-legal-target")).toHaveCount(
    7,
  );
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("browserIn");
  await page
    .getByRole("textbox", { name: "Direction", exact: true })
    .fill("in");
  await clickOwner();
  await expect(page.locator("#model")).toHaveValue(/pin browserIn : in;/);
  await expect(page.locator("#status")).toContainText("revision 3");
  const source = beta.locator(".diagram-port").filter({ hasText: /^outbound/ });
  const target = beta
    .locator(":scope > .diagram-port")
    .filter({ hasText: /^browserIn/ });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("browserLink");
  // The command form reduces the canvas height. Fit into the new viewport
  // before targeting an SVG port with screen coordinates.
  await page.locator('.diagram-zoom button[aria-label="Fit diagram"]').click();
  await expect(source).toHaveClass(/diagram-legal-target/);
  await expect(target).not.toHaveClass(/diagram-legal-target/);
  const a = await source.locator(":scope > rect").boundingBox();
  assert.ok(a);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await expect(target).toHaveClass(/diagram-legal-target/);
  await expect(source).not.toHaveClass(/diagram-legal-target/);
  const b = await target.locator(":scope > rect").boundingBox();
  assert.ok(b);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".diagram-edge")).toHaveCount(4);
  await expect(page.locator("#model")).toHaveValue(/link browserLink/);
  await expect(page.locator("#status")).toContainText("revision 4");
  // A semantic validation rejection is authoritative after a legal drop target.
  const before = await page.locator("#model").inputValue();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(beta).toHaveClass(/diagram-legal-target/);
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("BrowserBox");
  await clickOwner();
  await expect(page.locator(".diagram-status:visible")).toContainText(
    "Names must be unique",
  );
  assert.equal(await page.locator("#model").inputValue(), before);
  assert.equal(await page.evaluate(() => window.harness.revision), 4);
  await expect(page.locator(".diagram-edge")).toHaveCount(4);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".diagram-legal-target")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo source", exact: true }).click();
  await expect(page.locator("#status")).toContainText("revision 5");
  await expect(page.locator(".diagram-edge")).toHaveCount(3);
  await expect(page.locator("#model")).not.toHaveValue(/link browserLink/);
  await page.getByRole("button", { name: "Redo source", exact: true }).click();
  await expect(page.locator("#status")).toContainText("revision 6");
  await expect(page.locator(".diagram-edge")).toHaveCount(4);
  await expect(page.locator(".diagram-command")).toBeHidden();
  const childBoxes = await beta
    .locator(":scope > .diagram-node > .node-body")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
  assert.equal(childBoxes.length, 2);
  const [first, second] = childBoxes;
  assert.ok(
    first.x + first.width <= second.x ||
      second.x + second.width <= first.x ||
      first.y + first.height <= second.y ||
      second.y + second.height <= first.y,
    "New child overlaps its sibling",
  );
  await page.screenshot({
    path: process.env.HARNESS_SCREENSHOT ?? "docs/evidence/m6-editing.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real WASM palette drag/place box, border pin, source/target highlighting, connection drag, structured candidate rejection with isolation, source undo/redo; no page errors.",
  );
} finally {
  await browser?.close();
  await server.close();
}
