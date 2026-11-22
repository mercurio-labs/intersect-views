// Render actual recorded native scenes through the real client/layout worker.
// This diagnoses geometry; actual language-WASM parity is a separate gate.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {createServer} from "vite";
import {chromium} from "@playwright/test";
const native=JSON.parse(await readFile(process.env.M14_NATIVE_RECEIPT,"utf8"));
const notation=JSON.parse(await readFile(process.env.M14_NOTATION,"utf8"));
const encode=value=>JSON.stringify(value).replaceAll("<","\\u003c");
const html=`<!doctype html><html><head><style>:root{--bg:#fff;--panel:#f6f8fb;--text:#213047;--muted:#65718a;--blue:#3568b8;--accent:#bf5a28;--border:#cdd5df}html,body{margin:0;height:100%;font:14px system-ui}#canvas{height:100vh}</style></head><body><div id="canvas"></div><script type="module">
import {DiagramCanvas} from '/packages/visualization/src/canvas.ts';import {measuredRoutingRequest} from '/packages/visualization/src/routing-layout.ts';import '/packages/visualization/src/canvas.css';
const responses=${encode(native.scenes)};const canvas=new DiagramCanvas(document.querySelector('#canvas'),{view(){},select(binding,reveal){window.nativeM14.selected={binding,reveal};},async command(){throw Error('Read-only native scene fixture');},presentation(value){window.nativeM14.saved=value;},save(){},palette(){},undo(){}});
canvas.setNotation(${encode(notation)});window.nativeM14={canvas,responses};
window.nativeM14.show=async name=>{const response=responses[name].Ok??responses[name];canvas.setPresentation({schemaVersion:4,views:{}});canvas.views([response.scene.view],response.scene.view.key);canvas.setScene(response);await canvas.whenReady();const published=JSON.stringify(canvas.layout);canvas.highlight(response.scene.nodes[0]?.binding.elementId??null);if(JSON.stringify(canvas.layout)!==published)throw Error("Painting changed the published worker geometry");const ctx=document.createElement('canvas').getContext('2d');const measure=(s,size,weight,italic)=>{ctx.font=String(italic?'italic ':'')+weight+' '+size+'px system-ui';return ctx.measureText(s).width;};const request=measuredRoutingRequest(response.scene,canvas.layout,canvas.presentation,response.presentation,canvas.layout.routing.context,measure);return {scene:response.scene,layout:canvas.layout,request};};
</script></body></html>`;
const server=await createServer({plugins:[{name:'native-m14-entry',configureServer(server){server.middlewares.use('/m14-native.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});}}],server:{port:0,strictPort:false,hmr:false,watch:null}});
const receipt={status:'running',source:'Recorded accepted scene responses, rendered by the actual generic browser worker; language parity is checked separately',inputPath:process.env.M14_NATIVE_RECEIPT,inputSha256:createHash('sha256').update(await readFile(process.env.M14_NATIVE_RECEIPT)).digest('hex'),checks:[],errors:[]};let browser,page;
await mkdir('target/m14/native-canvas',{recursive:true});
try{await server.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1800,height:1100}});page.on('pageerror',e=>receipt.errors.push(e.message));await page.goto(server.resolvedUrls.local[0]+'m14-native.html');await page.waitForFunction(()=>!!window.nativeM14);
const segmentHits=(a,b,r)=>{
  if(a.x===b.x)return a.x>r.x&&a.x<r.x+r.width&&Math.max(a.y,b.y)>r.y&&Math.min(a.y,b.y)<r.y+r.height;
  if(a.y===b.y)return a.y>r.y&&a.y<r.y+r.height&&Math.max(a.x,b.x)>r.x&&Math.min(a.x,b.x)<r.x+r.width;
  throw Error('Expected cardinal measured terminal in this authored fixture');
};
for(const name of ['actions','states']){
  const result=await page.evaluate(name=>window.nativeM14.show(name),name),{scene,layout,request}=result;
  assert.deepEqual(Object.keys(layout.routing.paths).sort(),scene.edges.map(e=>e.id).sort());
  const endpoints=new Map(request.endpoints.map(e=>[e.id,e])),clearance=scene.routing.clearance;
  for(const edge of scene.edges){
    const path=layout.routing.paths[edge.id],source=endpoints.get(edge.source),target=endpoints.get(edge.target),owners=new Set([source.owner,target.owner,source.id,target.id]),ancestors=new Set([...source.ancestors,...target.ancestors]);
    assert.deepEqual(path.points[0],path.sourceTerminal);assert.deepEqual(path.points.at(-1),path.targetTerminal);
    for(const obstacle of request.obstacles){
      if(obstacle.kind==='boundary'&&(ancestors.has(obstacle.id)||owners.has(obstacle.id)))continue;
      const box={x:obstacle.box.x-clearance,y:obstacle.box.y-clearance,width:obstacle.box.width+2*clearance,height:obstacle.box.height+2*clearance};
      for(let i=0;i<path.segments.length;i++){
        if(owners.has(obstacle.id)&&(i===0||i===path.segments.length-1))continue;
        const segment=path.segments[i];assert.equal(segmentHits(segment.from,segment.to,box),false,`${name}: ${edge.id} intersects ${obstacle.id}`);
      }
    }
    for(const [id,label]of Object.entries(layout.routing.labelFrames))if(label.kind==='route'&&label.owner!==edge.id&&scene.edges.find(e=>e.id===label.owner)?.label.parts.some(p=>p.text.trim())){
      const box={x:label.box.x-clearance,y:label.box.y-clearance,width:label.box.width+2*clearance,height:label.box.height+2*clearance};for(const segment of path.segments)assert.equal(segmentHits(segment.from,segment.to,box),false,`Other route intersects caption ${id}`);
    }
  }
  for(const edge of scene.edges)for(const part of edge.label.parts.filter(p=>p.text.trim()&&p.binding)){
    const hit=page.locator(`[data-label-part="${part.id}"]`).first();await hit.click();const selected=await page.evaluate(()=>window.nativeM14.selected);assert.deepEqual(selected.binding,part.binding);
  }
  await page.screenshot({path:'target/m14/native-canvas/'+name+'.png',fullPage:true});receipt.checks.push(name+' retains every exact logical relationship; every segment clears measured solid/text obstacles and other painted captions, with exact bound-role selection');
}
assert.deepEqual(receipt.errors,[]);receipt.status='passed';
}catch(error){receipt.status='failed';receipt.failure=String(error);if(page)await page.screenshot({path:'target/m14/native-canvas/failure.png',fullPage:true});throw error;}
finally{await writeFile('target/m14/native-canvas/receipt.json',JSON.stringify(receipt,null,2)+'\n');await browser?.close();await server.close();}
