// M1 render smoke only. No host, project session or editing implementation.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const html = `<!doctype html><html><head><title>Scene v7 graph smoke</title>
<style>:root{--bg:#fff;--panel:#f6f8fb;--text:#213047;--muted:#65718a;--blue:#3568b8;--accent:#bf5a28;--selected:#e8f0fb;--border:#cdd5df;--shadow:none}html,body{margin:0;height:100%;font:14px system-ui}#canvas{height:100vh;width:100vw}</style>
</head><body><div id="canvas"></div><script type="module">
import { DiagramCanvas } from '/packages/visualization/src/canvas.ts';
const scene = await (await fetch('/crates/intersect-views/tests/fixtures/scene-v6-m14.json')).json();
const canvas = new DiagramCanvas(document.querySelector('#canvas'), {
 view(){},select(){},async command(){},presentation(value){window.savedPresentation=value;},save(){},palette(){},undo(){}
});
const response={scene,presentation:{fingerprint:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',libraries:[]},capabilities:[{toolId:'select',enabled:true,reason:''}]};
canvas.views([scene.view],scene.view.key);
canvas.setScene(response);
window.smoke={canvas,response};
</script></body></html>`;
const server = await createServer({
  configFile: false,
  cacheDir: "target/vite-canvas-cache",
  server: {
    host: "127.0.0.1", port: 0,
    watch: { ignored: ["**/target/**", "**/test-reports/**", "**/docs/evidence/**"] },
  },
  plugins: [
    {
      name: "m1-smoke",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/__m1__") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("Browser console:", message.text());
  });
  await page.goto(`${server.resolvedUrls.local[0]}__m1__`);
  await page.waitForFunction(() => Boolean(window.smoke));
  await expect(page.locator(".diagram-node")).toHaveCount(2);
  await expect(page.locator(".diagram-port")).toHaveCount(2);
  await expect(page.locator(".diagram-field")).toHaveCount(1);
  await expect(page.locator(".diagram-edge")).toHaveCount(1);
  await expect(page.locator(".node-title").first()).toHaveText(
    "Left occurrence",
  );
  await expect(page.locator(".node-title").first()).toBeVisible();
  assert.equal(
    await page
      .locator(".node-title")
      .first()
      .evaluate((el) => getComputedStyle(el).fill),
    "rgb(33, 48, 71)",
  );
  assert.equal(
    await page.evaluate(() => {
      return [1, 2, 3, 4, 5, 6].every((schemaVersion) => {
        try {
          window.smoke.canvas.setScene({
            ...window.smoke.response,
            scene: { ...window.smoke.response.scene, schemaVersion },
          });
          return false;
        } catch {
          return true;
        }
      });
    }),
    true,
  );

  // Opaque keys remain ordinary JSON map entries across layout, save and reload.
  for (const key of ["__proto__", "constructor", "toString"]) {
    await page.evaluate((key) => {
      const { canvas, response: original } = window.smoke;
      const response = structuredClone(original);
      response.scene.view.key = key;
      const node = response.scene.nodes[0],
        old = node.id;
      node.id = "__proto__";
      node.notation = "constructor"; // Unknown token must use the standard fallback.
      for (const edge of response.scene.edges) {
        if (edge.source === old) edge.source = node.id;
        if (edge.target === old) edge.target = node.id;
      }
      node.compartments[0].label =
        "Complete compartment heading: " + "Wide caption ".repeat(9);
      response.scene.palette.groups[0].entries[0].icon = "constructor";
      window.savedPresentation = undefined;
      canvas.reset({ schemaVersion: 5, views: {} });
      canvas.views([response.scene.view], key);
      canvas.setScene(response);
    }, key);
    await expect(
      page.locator('.diagram-node[data-symbol="__proto__"]'),
    ).toHaveCount(1);
    const body = page.locator(
      '.diagram-node[data-symbol="__proto__"] > .node-body',
    );
    const heading = page.locator(
      '.diagram-node[data-symbol="__proto__"] .compartment-label',
    );
    const rect = await body.boundingBox(),
      text = await heading.boundingBox();
    assert.ok(
      rect && text && text.x + text.width <= rect.x + rect.width + 1,
      "full compartment heading must fit",
    );
    await page.mouse.move(rect.x + 5, rect.y + 5);
    await page.mouse.down();
    await page.mouse.move(rect.x + 35, rect.y + 25, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(
      (key) => Object.hasOwn(window.savedPresentation?.views ?? {}, key),
      key,
    );
    assert.equal(
      await page.evaluate(
        (key) =>
          Object.hasOwn(
            window.savedPresentation.views[key].positions,
            "__proto__",
          ),
        key,
      ),
      true,
    );
    await page.evaluate(() => {
      const p = JSON.parse(JSON.stringify(window.savedPresentation));
      window.smoke.canvas.setPresentation(p);
    });
    await expect(body).toBeVisible();
  }
  // Restore the ordinary smoke fixture before capturing evidence.
  await page.evaluate(() => {
    const { canvas, response } = window.smoke;
    canvas.reset({ schemaVersion: 5, views: {} });
    canvas.views([response.scene.view], response.scene.view.key);
    canvas.setScene(response);
  });
  await expect(page.locator(".diagram-node")).toHaveCount(2);
  assert.deepEqual(errors, []);
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({
    path: process.env.HARNESS_SCREENSHOT ?? "docs/evidence/m1-canvas.png",
  });
  console.log(
    "PASS: v7 canvas renders 2 nodes, 2 ports, 1 row, 1 edge; v1/v2/v3/v4/v5/v6 refused; opaque view/symbol keys, long headings, save/reload; no page errors.",
  );
} finally {
  await browser?.close();
  await server.close();
}
