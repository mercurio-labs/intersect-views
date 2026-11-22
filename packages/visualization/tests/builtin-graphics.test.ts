import test from "node:test";
import assert from "node:assert/strict";
import { builtinBody } from "../src/builtin-graphics.ts";
for(const shape of ["rectangle","rounded","ellipse","diamond"] as const)test(`legacy ${shape} maps to checked built-in composition`,()=>{
 const result=builtinBody({shape,fill:"usage",stroke:"#123456",radius:7},240,100);
 assert.match(result,/data-graphic-part/);assert.match(result,/class="node-body"/);assert.match(result,/stroke:#123456/);
 assert.ok(!result.includes("undefined"));assert.ok(result.includes(shape==="ellipse"?"<ellipse":shape==="diamond"?"<polygon":"<rect"));
});
