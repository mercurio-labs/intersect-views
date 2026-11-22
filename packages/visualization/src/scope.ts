import {
  validateScope,
  type Scope,
  type ScopeOp,
  type ViewDocument,
} from "./protocol.ts";
/** Client-owned ordered exploration, serializable as an ordinary view document. */
export class Exploration {
  private value: Scope;
  constructor(scope: Scope = { schemaVersion: 1, ops: [] }) {
    validateScope(scope);
    this.value = structuredClone(scope);
  }
  get scope(): Scope {
    return structuredClone(this.value);
  }
  append(operation: ScopeOp) {
    const next = this.scope;
    next.ops.push(structuredClone(operation));
    validateScope(next);
    this.value = next;
  }
  undo() {
    this.value.ops.pop();
  }
  document(key: string, name: string, ruleSet: string): ViewDocument {
    return { schemaVersion: 1, key, name, ruleSet, scope: this.scope };
  }
}
