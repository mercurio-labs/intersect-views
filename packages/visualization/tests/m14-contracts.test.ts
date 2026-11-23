import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {validateRoutingPolicy,validateRouteConstraint,validateLabelPlacement} from "../src/routing-contract.ts";
import {validatePresentation,validateScene,validateRuleSet} from "../src/validation.ts";
const checks:Record<string,(v:unknown)=>void>={policy:validateRoutingPolicy,constraint:validateRouteConstraint,placement:validateLabelPlacement,presentation:validatePresentation,scene:validateScene,rules:validateRuleSet};
const cases=JSON.parse(readFileSync(new URL("../../../crates/intersect-views/tests/fixtures/m14-contracts-symbol.json",import.meta.url),"utf8"));
for(const c of cases)test(`M14 shared wire: ${c.name}`,()=>{
  if(c.accepted)checks[c.kind](c.value);else assert.throws(()=>checks[c.kind](c.value));
});
