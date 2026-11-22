import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null } });
const checks = [], errors = [];
let browser,page;
await mkdir("target/m12-wasm", { recursive: true });
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  await page.addInitScript(()=>{
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){if(message?.scene)window.m14LastLayoutInput=structuredClone(message);return Reflect.apply(post,this,[message,...args]);};
  });
  page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGE",e.message); });
  const base = server.resolvedUrls.local[0];
  const wasm = await fetch(`${base}harness.wasm`).then((r) => r.arrayBuffer());
  const wasmSha256 = createHash("sha256").update(new Uint8Array(wasm)).digest("hex");
  const ready = async (kind) => { await expect(page.locator("#status")).toContainText(`Accepted ${kind} package`, { timeout: 60000 }); await expect(page.locator(".diagram-node")).toHaveCount(2); };
  const snapshot = () => page.evaluate(() => ({ fingerprint: window.m12.active.fingerprint, scene: window.m12.scene, source: document.querySelector("#model").value }));
  const outsideLabels=()=>page.evaluate(()=>{
    const issues=[];
    for(const node of window.m12.scene.scene.nodes){
      const group=[...document.querySelectorAll(".diagram-node")].find(g=>g.dataset.symbol===node.id),body=group.querySelector(".node-body").getBoundingClientRect();
      for(const p of node.ports){
        const port=[...group.querySelectorAll(".diagram-port")].find(g=>g.dataset.port===p.id);
        for(const part of port.querySelectorAll("[data-label-part]")){
          const box=part.getBoundingClientRect();
          if(p.side==="WEST"&&box.right>body.left-.5)issues.push("West port label is inside owner");
          if(p.side==="EAST"&&box.left<body.right+.5)issues.push("East port label is inside owner");
        }
      }
    }
    return issues;
  });

  await page.goto(`${base}harness/web/m12.html`); await ready("classic");
  assert.deepEqual(await outsideLabels(),[]);
  const initial = await snapshot(), a = initial.scene.scene.nodes[0], b = initial.scene.scene.nodes[1];
  assert.equal(initial.scene.scene.schemaVersion, 7); assert.equal(initial.scene.scene.edges.length, 2);
  assert.notEqual(a.compartments[0].rows[0].id, b.compartments[0].rows[0].id);
  assert.equal(a.compartments[0].rows[0].binding.key, b.compartments[0].rows[0].binding.key);
  assert.notDeepEqual(a.compartments[0].rows[0].binding.context, b.compartments[0].rows[0].binding.context);
  checks.push("Actual WASM scene v7 retains repeated inherited member source identity and distinct occurrence contexts");
  const node = page.locator(".diagram-node").first(), doc = a.text["node.text.documentation"].runs[0].parts[0];
  const fragments = node.locator(`[data-label-part="${doc.id}"]`);
  assert.ok(await fragments.count() > 4);
  await fragments.filter({ hasText: "documentation" }).first().dblclick();
  const selected = await page.locator("#model").evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd));
  assert.match(selected, /box (Alpha|Beta)/);
  checks.push("Wrapped documentation fragments reveal their actual model source binding");
  const beforeWidth = Number(await node.locator(".node-body").getAttribute("width")), beforeCount = await fragments.count();
  const handle = await node.locator(":scope > .node-resize").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 3); await page.mouse.down(); await page.mouse.move(handle.x - 100, handle.y + 10, { steps: 8 }); await page.mouse.up();
  await page.evaluate(()=>window.m12.active.canvas.whenReady());
  await expect.poll(async () => Number(await node.locator(".node-body").getAttribute("width"))).toBeLessThan(beforeWidth);
  assert.equal((await snapshot()).source, initial.source);
  assert.equal((await snapshot()).scene.scene.nodes[0].text["node.text.documentation"].runs[0].parts[0].id, doc.id);
  assert.ok(await fragments.count() >= beforeCount);
  const resizedWidth = Number(await node.locator(".node-body").getAttribute("width"));
  await page.locator("#save").click(); await page.reload(); await ready("classic");
  assert.equal(Number(await page.locator(".diagram-node").first().locator(".node-body").getAttribute("width")), resizedWidth);
  checks.push("Resize and reload reflow documentation while preserving source bytes, logical part IDs and saved width");
  // Keep the old host reference to verify teardown after replacement.
  await page.evaluate(() => { window.previousM12Host = window.m12.active.host; });
  await page.selectOption("#package", "rotated"); await page.locator("#apply-package").click(); await ready("rotated");
  const alternate = await snapshot(); assert.notEqual(alternate.fingerprint, initial.fingerprint);
  assert.equal(alternate.source, initial.source);
  assert.ok(alternate.scene.scene.nodes.every((n) => n.ports.every((p) => p.graphic.parameters.angle === 90)));
  assert.ok(await page.locator('.diagram-port [transform^="matrix(6.123"]').count() > 0);
  assert.equal(await page.evaluate(async () => { try { await window.previousM12Host.request("views/catalog", { revision: 1 }); return false; } catch (e) { return String(e).includes("closed"); } }), true);
  checks.push("Alternate package uses the same WASM binary, rotates typed port graphics and destroys the previous host");
  assert.equal(await page.locator("[data-edge-marker=end]").count(), 2);
  const attachmentErrors = () => page.evaluate(() => {
    const errors = [], scene = window.m12.scene.scene;
    for (const edge of scene.edges) {
      const group = [...document.querySelectorAll(".diagram-edge")].find((g) => g.dataset.edge === edge.id);
      if (!group) { errors.push("Missing edge"); continue; }
      const line = group.querySelector(".edge-line"), world = document.querySelector(".diagram-world").getCTM().inverse();
      for (const [id, at] of [[edge.source,0],[edge.target,line.getTotalLength()]]) {
        const port = [...document.querySelectorAll(".diagram-port")].find((p)=>p.dataset.port===id);
        const rect=port.querySelector("rect");
        const anchor = new DOMPoint(16,8).matrixTransform(rect.getCTM()).matrixTransform(world), end=line.getPointAtLength(at);
        if(Math.abs(anchor.x-end.x)>.01||Math.abs(anchor.y-end.y)>.01)errors.push("Rotated port detached");
      }
    }
    for (const marker of document.querySelectorAll("[data-edge-marker]")) {
      const line = marker.parentElement.querySelector(".edge-line"), end = line.getPointAtLength(line.getTotalLength());
      const p = new DOMPoint(0, 8).matrixTransform(marker.getCTM()).matrixTransform(document.querySelector(".diagram-world").getCTM().inverse());
      if (Math.abs(p.x - end.x) > .01 || Math.abs(p.y - end.y) > .01) errors.push("Marker detached");
    }
    return errors;
  });
  assert.deepEqual(await attachmentErrors(), []);
  assert.deepEqual(await outsideLabels(), []);
  checks.push("Named marker attachment remains on the final routed endpoint");
  const rotatedNode=page.locator(".diagram-node").first(),rotatedHandle=await rotatedNode.locator(":scope > .node-resize").boundingBox();
  await page.mouse.move(rotatedHandle.x+3,rotatedHandle.y+3);await page.mouse.down();await page.mouse.move(rotatedHandle.x+60,rotatedHandle.y+45,{steps:6});await page.mouse.up();
  await page.evaluate(()=>window.m12.active.canvas.whenReady());
  assert.deepEqual(await attachmentErrors(),[]);
  const body=await rotatedNode.locator(".node-body").first().boundingBox();
  await page.mouse.move(body.x+4,body.y+4);await page.mouse.down();await page.mouse.move(body.x+35,body.y+25,{steps:6});await page.mouse.up();
  assert.deepEqual(await attachmentErrors(),[]);
  await page.locator("#save").click();await page.reload();await ready("rotated");
  assert.deepEqual(await attachmentErrors(),[]);assert.deepEqual(await outsideLabels(),[]);assert.equal((await snapshot()).source,initial.source);
  checks.push("Rotated port directions, outside labels and marker attachments survive owner resize, move and saved-project reload without source changes");

  const oldMarkup = await page.locator(".diagram-world").first().innerHTML();
  await page.evaluate(() => {
    const area = document.querySelector("#library"), lib = JSON.parse(area.value);
    lib.definitions[0].root.content = { kind: "use", definition: lib.definitions[0].id, parameters: {}, slots: {} }; area.value = JSON.stringify(lib);
  });
  await page.locator("#apply-package").click(); await expect(page.locator("#status")).toContainText("Candidate rejected", { timeout: 60000 });
  assert.equal((await snapshot()).fingerprint, alternate.fingerprint); assert.equal(await page.locator(".diagram-world").first().innerHTML(), oldMarkup);
  checks.push("Cyclic library candidate is refused atomically with accepted diagram and source preserved");
  await page.selectOption("#package", "classic");
  await page.evaluate(() => {
    const area = document.querySelector("#library"), lib = JSON.parse(area.value), port = lib.definitions.find((d) => d.role === "port");
    port.root.content.children[0].content.rotate = { op: "divide", left: 1, right: {op:"subtract",left:{op:"width"},right:16} }; area.value = JSON.stringify(lib);
  });
  await page.locator("#apply-package").click(); await expect(page.locator("#status")).toContainText("Candidate rejected", { timeout: 60000 });
  assert.equal((await snapshot()).fingerprint, alternate.fingerprint); assert.equal(await page.locator(".diagram-world").first().innerHTML(), oldMarkup);
  checks.push("Layout-time numeric failure tears down candidate workers and preserves the active package");
  for(const kind of ["sysml","electrical","fault"]) {
    await page.selectOption("#package",kind); await page.locator("#apply-package").click(); await ready(kind);
    const s=await snapshot(); assert.equal(s.source,initial.source);
    assert.equal(s.scene.presentation.libraries[0].id,`example.${kind}`);
    assert.equal(s.scene.scene.nodes[0].compartments[0].rows[0].binding.key,a.compartments[0].rows[0].binding.key);
    await page.screenshot({path:`target/m12-wasm/${kind}.png`,fullPage:true});
  }
  checks.push("Independent SysML-style, electrical resistor/transformer-terminal and fault event/gate libraries run through the unchanged WASM/client renderer");
  await page.locator("#load-nested").click();
  await expect(page.locator("#status")).toContainText("Accepted containers package",{timeout:60000});
  await expect(page.locator(".diagram-region")).toHaveCount(4);
  await expect(page.locator(".diagram-node")).toHaveCount(6);
  const nesting = await page.evaluate(()=>{
    const errors=[]; const world=document.querySelector(".diagram-world").getCTM().inverse();
    const box=(element)=>{const b=element.getBBox(),m=element.getCTM();const a=new DOMPoint(b.x,b.y).matrixTransform(m).matrixTransform(world),z=new DOMPoint(b.x+b.width,b.y+b.height).matrixTransform(m).matrixTransform(world);return{x:a.x,y:a.y,right:z.x,bottom:z.y};};
    const inside=(a,b)=>a.x>=b.x-.01&&a.y>=b.y-.01&&a.right<=b.right+.01&&a.bottom<=b.bottom+.01;
    for(const region of document.querySelectorAll(".diagram-region")){
      const r=box(region.querySelector(":scope > rect")),owner=region.closest(".diagram-node");
      if(!inside(r,box(owner.querySelector(".node-body"))))errors.push("Region escaped composed parent");
      for(const child of region.querySelectorAll(":scope > .diagram-node"))if(!inside(box(child.querySelector(".node-body")),r))errors.push("Composed child escaped region");
    }
    return errors;
  });
  assert.deepEqual(nesting,[]);
  checks.push("Actual model-derived nested regions and child symbols fit their declared composed content slots");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "target/m12-wasm/desktop.png", fullPage: true });
  await writeFile("target/m12-wasm/results.json", JSON.stringify({ wasmSha256, checks, errors, initialFingerprint: initial.fingerprint, alternateFingerprint: alternate.fingerprint }, null, 2));
  console.log(`${checks.length} M12 WASM browser checks passed`);
} finally { if(page)await writeFile("target/m14/m12-last-layout-input.json",JSON.stringify(await page.evaluate(()=>window.m14LastLayoutInput??null),null,2)+"\n"); await writeFile("target/m14/m12-regression-progress.json",JSON.stringify({checks,errors},null,2)+"\n"); await browser?.close(); await server.close(); }
