import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {createServer} from "vite";
import {chromium,expect} from "@playwright/test";
const server=await createServer({server:{port:0,strictPort:false,hmr:false,watch:null}}),receipt={checks:[],errors:[]};let browser,page;
await mkdir("target/m14/structure-browser",{recursive:true});
try {
  await server.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1800,height:1100}});page.on("pageerror",e=>receipt.errors.push(e.message));
  receipt.wasmSha256=createHash("sha256").update(new Uint8Array(await fetch(`${server.resolvedUrls.local[0]}harness.wasm`).then(r=>r.arrayBuffer()))).digest("hex");
  await page.goto(`${server.resolvedUrls.local[0]}harness/web/m14.html`);
  const ready=async kind=>{await page.waitForFunction(()=>/Accepted|Projection refused/.test(document.querySelector("#status").textContent),{timeout:60000});const status=await page.locator("#status").textContent();assert.equal(status,`Accepted ${kind} projection`,status);await page.evaluate(()=>window.m14.active.canvas.whenReady());};
  const snapshot=()=>page.evaluate(()=>({scene:window.m14.active.scene,layout:window.m14.active.canvas.graph.layout,source:document.querySelector("#source").value}));
  await ready("nested");const nested=await snapshot();assert.equal(nested.scene.scene.schemaVersion,7);assert.ok(Object.values(nested.layout.routing.paths).some(p=>p.gates.length>0));
  receipt.checks.push("Actual native/WASM nested structural model routes through explicit measured container gates");
  const root=nested.scene.scene.nodes[0],blocker=root.regions.items.find(r=>r.label.parts.some(p=>p.text.includes("Blockers")));assert.ok(blocker);
  const local=nested.layout.regions[blocker.id],parent=nested.layout.nodes[root.id],clearance=nested.scene.scene.routing.clearance;
  const box={x:parent.x+local.x-clearance,y:parent.y+local.y-clearance,width:local.width+clearance*2,height:local.height+clearance*2};
  for(const path of Object.values(nested.layout.routing.paths)){
    const a=path.points[0],lead=path.points[1];assert.ok(Math.abs(Math.abs(lead.x-a.x)-Math.abs(lead.y-a.y))<1e-6);
    for(let i=2;i<path.points.length-1;i++){
      const a=path.points[i-1],b=path.points[i];
      const horizontal=a.y===b.y&&a.y>box.y&&a.y<box.y+box.height&&Math.max(a.x,b.x)>box.x&&Math.min(a.x,b.x)<box.x+box.width;
      const vertical=a.x===b.x&&a.x>box.x&&a.x<box.x+box.width&&Math.max(a.y,b.y)>box.y&&Math.min(a.y,b.y)<box.y+box.height;
      assert.equal(horizontal||vertical,false,"Routed core intersects the intervening measured container");
    }
  }
  receipt.checks.push("A measured transformed port pair routes around an authored intervening obstacle while preserving its actual terminal normals");
  await page.locator("#collapse").click();await ready("nested");
  await expect.poll(async()=>((await snapshot()).scene.scene.endpointProxies.length)).toBeGreaterThan(0);const collapsed=await snapshot();
  assert.equal(collapsed.source,nested.source);assert.deepEqual(collapsed.scene.scene.edges.map(e=>[e.id,e.source,e.target]),nested.scene.scene.edges.map(e=>[e.id,e.source,e.target]));
  const proxy=collapsed.scene.scene.endpointProxies[0];await page.locator(`[data-endpoint-proxy="${proxy.id}"]`).click();assert.deepEqual(JSON.parse(await page.locator("#binding").textContent()),proxy.binding);
  receipt.checks.push("Collapse preserves every logical edge/endpoint and boundary proxy selection reveals its exact original source binding");
  await page.locator("#expand").click();await ready("nested");await expect.poll(async()=>((await snapshot()).scene.scene.endpointProxies.length)).toBe(0);
  const expanded=await snapshot();assert.deepEqual(expanded.scene.scene.edges,nested.scene.scene.edges);
  receipt.checks.push("Expand restores original source-backed endpoint occurrences without rebinding");
  await page.selectOption("#projection","tree");await ready("tree");
  const tree=await snapshot();assert.ok(tree.layout.routing.sharedSegments.length>0);const segment=tree.layout.routing.sharedSegments.find(s=>s.members.length>1);assert.ok(segment);
  const shared=page.locator(`.diagram-shared-segment[data-shared-segment="${tree.layout.routing.sharedSegments.indexOf(segment)}"]`);await shared.focus();await page.keyboard.press("Enter");
  const dialog=page.getByRole("dialog",{name:"Choose a branch"});await expect(dialog).toBeVisible();await expect(dialog.locator("button")).toHaveCount(segment.members.length+1);
  await dialog.locator("button").nth(1).focus();await page.keyboard.press("Enter");await expect(dialog).toHaveCount(0);
  const chosen=tree.scene.scene.edges.find(e=>e.id===segment.members[1]);assert.deepEqual(JSON.parse(await page.locator("#binding").textContent()),chosen.binding);
  receipt.checks.push("An authored shared tree trunk opens a keyboard chooser and selects the exact chosen branch binding");
  await page.locator(`[data-symbol="${tree.scene.scene.nodes[0].id}"] .node-body`).first().click({button:"right",position:{x:8,y:8}});
  await page.getByRole("menuitem",{name:"Hide root",exact:true}).click();
  await expect.poll(async()=>((await snapshot()).scene.scene.nodes.length)).toBe(0);
  const hidden=await snapshot();assert.equal(hidden.source,tree.source);assert.equal(hidden.scene.scene.edges.length,0);
  assert.ok(hidden.scene.scene.problems.includes(`Hidden 1 root(s) and ${tree.scene.scene.edges.length} incident edge(s)`));
  await page.locator("#expand").click();await ready("tree");await expect.poll(async()=>((await snapshot()).scene.scene.nodes.length)).toBe(tree.scene.scene.nodes.length);
  assert.deepEqual((await snapshot()).scene.scene.edges,tree.scene.scene.edges);
  receipt.checks.push("Explicit Hide reports the exact hidden relationship count; re-adding the root restores every original endpoint and binding");
  assert.deepEqual(receipt.errors,[]);await page.screenshot({path:"target/m14/structure-browser/tree.png",fullPage:true});receipt.status="passed";
}catch(error){receipt.status="failed";receipt.failure=String(error);if(page)await page.screenshot({path:"target/m14/structure-browser/failure.png",fullPage:true});throw error;}
finally {await writeFile("target/m14/structure-browser/receipt.json",JSON.stringify(receipt,null,2)+"\n");await browser?.close();await server.close();}
