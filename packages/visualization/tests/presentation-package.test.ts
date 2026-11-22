import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePresentation, sha256 } from "../src/presentation-package.ts";
const vectors = JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/presentation-package-v1.json", import.meta.url), "utf8"));
for (const v of vectors.accepted) test(`package accepts ${v.name}`, async () => {
  assert.equal((await resolvePresentation(v.input, vectors.language, vectors.languageFingerprint)).fingerprint, v.fingerprint);
});
for (const v of vectors.rejected) test(`package rejects ${v.name}`, async () => {
  await assert.rejects(resolvePresentation(v.input, vectors.language, vectors.languageFingerprint));
});

async function boundaryInput(count:number,padding=0){
 const resources=await Promise.all(Array.from({length:count},async(_,i)=>({id:`resource-${i}`,content:i?"":"x".repeat(padding)})));
 const refs=await Promise.all(resources.map(async r=>({id:r.id,kind:"symbolLibrary",sha256:await sha256(r.content)})));
 return{root:"limit@1",manifests:[{schemaVersion:1,id:"limit",version:"1",language:vectors.language,languageFingerprint:vectors.languageFingerprint,requires:[],dependencies:[],resources:refs}],resources};
}
test("package resource limit admits 64 and refuses 65",async()=>{
 await resolvePresentation(await boundaryInput(64),vectors.language,vectors.languageFingerprint);
 await assert.rejects(resolvePresentation(await boundaryInput(65),vectors.language,vectors.languageFingerprint),/limit/i);
});
test("package exact 2 MiB byte bound includes manifests and refuses the next byte",async()=>{
 const limit=2*1024*1024,empty=await boundaryInput(1),base=new TextEncoder().encode(JSON.stringify(empty)).length;
 const accepted=await boundaryInput(1,limit-base);
 assert.equal(new TextEncoder().encode(JSON.stringify(accepted)).length,limit);
 await resolvePresentation(accepted,vectors.language,vectors.languageFingerprint);
 await assert.rejects(resolvePresentation(await boundaryInput(1,limit-base+1),vectors.language,vectors.languageFingerprint),/2 MiB/);
});
