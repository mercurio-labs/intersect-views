import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateRenderingRegistry,validateRenderingResolution,migrateRulesV6,previewRulesV7} from "../src/rendering.ts";
import {validateRuleSet} from "../src/protocol.ts";
const load=(name:string)=>JSON.parse(readFileSync(new URL(`../../../crates/intersect-views/tests/fixtures/${name}.json`,import.meta.url),"utf8"));
const fixture=load("rendering-v1-m14");
for(const group of ["accepted","rejected"])for(const c of fixture[group])test(`rendering ${group}: ${c.name}`,()=>{
 const check=()=>c.kind==="registry"?validateRenderingRegistry(c.value,[fixture.rules]):validateRenderingResolution(c.value);
 if(group==="accepted")check();else assert.throws(check);
});
test("v6 rules require explicit migration and retain their input bytes",()=>{
 const old=load("rule-set-v6"),bytes=JSON.stringify(old);assert.throws(()=>validateRuleSet(old));const migrated=migrateRulesV6(old);validateRuleSet(migrated);assert.equal(migrated.schemaVersion,8);assert.equal(JSON.stringify(old),bytes);assert.throws(()=>migrateRulesV6(migrated));
});

 test("v7 routing migration is detached and requires a package compatibility review",()=>{
 const old=load("rule-set-v7"),bytes=JSON.stringify(old);assert.throws(()=>validateRuleSet(old));
 const preview=previewRulesV7(old);validateRuleSet(preview.candidate);
 assert.deepEqual(preview.candidate.form==="graph"?preview.candidate.routing:null,{algorithm:"orthogonal",clearance:8,stubLength:18,trunks:"none"});
 assert.equal(preview.packageCompatibilityReviewRequired,true);assert.equal(JSON.stringify(old),bytes);
 assert.throws(()=>previewRulesV7(preview.candidate));
 });
