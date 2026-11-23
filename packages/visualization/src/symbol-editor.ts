/** Detached display transactions. No semantic host commands or source history. */
import type { GraphPresentation, SavedPosition } from "./protocol.ts";
import { validatePresentation } from "./validation.ts";
import { graphicColor, type GraphicValue } from "./graphics-contract.ts";
import type {
  PropertyTarget,
  SymbolOverrides,
} from "./symbol-properties-contract.ts";
import { own, put } from "./records.ts";

type Allocation = Pick<SavedPosition, "width" | "height">;
export interface SymbolState {
  symbolOverrides: SymbolOverrides;
  allocations: Record<string, Allocation>;
}
export interface PropertyRow {
  key: string;
  targets: PropertyTarget[];
  missing: string[];
  mixed: boolean;
  editable: boolean;
  reason: string;
}
function checkValue(t: PropertyTarget, value: GraphicValue) {
  const e = t.descriptor.editor;
  const valid =
    e.kind === "color"
      ? typeof value === "string" && graphicColor(value)
      : e.kind === "bool"
        ? typeof value === "boolean"
        : e.kind === "number"
          ? typeof value === "number" &&
            Number.isFinite(value) &&
            value >= e.minimum &&
            value <= e.maximum
          : typeof value === "string" && !!t.choices?.includes(value);
  if (!valid)
    throw Error(
      `Property ${t.descriptor.label} violates its editor type or bounds`,
    );
}
export class SymbolEdit {
  readonly draft: GraphPresentation;
  readonly rows: PropertyRow[];
  readonly selection: readonly string[];
  private active = true;
  readonly original: GraphPresentation;
  constructor(
    original: GraphPresentation,
    selection: string[],
    targets: PropertyTarget[],
  ) {
    this.original = original;
    if (
      !selection.length ||
      selection.length > 256 ||
      new Set(selection).size !== selection.length
    )
      throw Error("Select 1–256 explicit occurrences");
    this.selection = [...selection];
    this.draft = structuredClone(original);
    const selected = new Set(selection),
      byTarget = new Map<string, Map<string, PropertyTarget>>(),
      keys = new Set<string>();
    for (const t of targets)
      if (selected.has(t.target)) {
        let props = byTarget.get(t.target);
        if (!props) {
          props = new Map();
          byTarget.set(t.target, props);
        }
        if (props.has(t.key))
          throw Error("Duplicate qualified property target");
        props.set(t.key, t);
        keys.add(t.key);
      }
    if (keys.size > 1024)
      throw Error(
        "Selection property budget exceeded; select fewer occurrences",
      );
    this.rows = [...keys].map((key) => {
      const matching = selection.map((id) => byTarget.get(id)?.get(key)),
        present = matching.filter((t): t is PropertyTarget => !!t),
        missing = selection.filter((_, i) => !matching[i]),
        reason = missing.length
          ? `Unavailable on ${missing.join(", ")}`
          : (present.find((t) => !t.editable)?.reason ?? "");
      return {
        key,
        targets: present,
        missing,
        mixed: present.some((t) => t.current !== present[0].current),
        editable: !reason,
        reason,
      };
    });
  }
  private check() {
    if (!this.active) throw Error("Symbol editor context is stale");
  }
  invalidate() {
    this.active = false;
  }
  set(key: string, value: GraphicValue) {
    this.check();
    const row = this.rows.find((r) => r.key === key);
    if (!row?.editable)
      throw Error(row?.reason ?? "Property unavailable in this selection");
    for (const t of row.targets) checkValue(t, value);
    const next = structuredClone(this.draft);
    for (const id of this.selection) {
      const props = own(next.symbolOverrides, id) ?? {};
      put(next.symbolOverrides, id, props);
      put(props, key, value);
    }
    this.accept(next);
  }
  resetProperty(key: string) {
    this.check();
    if (!this.rows.some((r) => r.key === key))
      throw Error("Property unavailable");
    const next = structuredClone(this.draft);
    for (const id of this.selection) {
      const props = own(next.symbolOverrides, id);
      if (props) {
        delete props[key];
        if (!Object.keys(props).length) delete next.symbolOverrides[id];
      }
    }
    this.accept(next);
  }
  reset(scope: "selection" | "view") {
    this.check();
    const next = structuredClone(this.draft);
    if (scope === "view") next.symbolOverrides = {};
    else for (const id of this.selection) delete next.symbolOverrides[id];
    this.accept(next);
  }
  size(
    id: string,
    width: number | undefined,
    height: number | undefined,
    minimum: { width: number; height: number },
  ) {
    this.check();
    if (!this.selection.includes(id))
      throw Error("Size target is outside the explicit selection");
    const next = structuredClone(this.draft),
      position = own(next.positions, id);
    if (!position) throw Error("Size target has no measured position");
    if (width === undefined && height === undefined) {
      delete position.width;
      delete position.height;
    } else {
      if (
        width === undefined ||
        height === undefined ||
        width < minimum.width ||
        height < minimum.height
      )
        throw Error("Manual size is below measured content bounds");
      position.width = width;
      position.height = height;
    }
    this.accept(next);
  }
  private accept(next: GraphPresentation) {
    validatePresentation({ schemaVersion: 5, views: { candidate: next } });
    Object.assign(this.draft, next);
  }
  candidate(current: GraphPresentation) {
    this.check();
    if (
      current.packageFingerprint !== this.original.packageFingerprint ||
      current.projection !== this.original.projection
    )
      throw Error("Symbol editor package/projection changed");
    validatePresentation({
      schemaVersion: 5,
      views: { candidate: this.draft },
    });
    return structuredClone(this.draft);
  }
}
interface Entry {
  before: SymbolState;
  after: SymbolState;
}
export class SymbolHistory {
  private entries: Entry[] = [];
  private cursor = 0;
  private fingerprint: string;
  private projection: string;
  constructor(fingerprint: string, projection: string) {
    this.fingerprint = fingerprint;
    this.projection = projection;
  }
  private check(v: GraphPresentation) {
    if (
      v.packageFingerprint !== this.fingerprint ||
      v.projection !== this.projection
    )
      throw Error("Symbol history context changed");
  }
  private snapshot(v: GraphPresentation, ids: string[]): SymbolState {
    return {
      symbolOverrides: structuredClone(v.symbolOverrides),
      allocations: Object.fromEntries(
        ids.map((id) => {
          const p = own(v.positions, id);
          return [
            id,
            p?.width === undefined ? {} : { width: p.width, height: p.height },
          ];
        }),
      ),
    };
  }
  private restore(v: GraphPresentation, s: SymbolState) {
    v.symbolOverrides = structuredClone(s.symbolOverrides);
    for (const [id, size] of Object.entries(s.allocations)) {
      const p = own(v.positions, id);
      if (p) {
        delete p.width;
        delete p.height;
        Object.assign(p, size);
      }
    }
  }
  apply(v: GraphPresentation, next: GraphPresentation) {
    this.check(v);
    this.check(next);
    validatePresentation({ schemaVersion: 5, views: { candidate: next } });
    const ids = [
        ...new Set([
          ...Object.keys(v.positions),
          ...Object.keys(next.positions),
        ]),
      ].filter(
        (id) =>
          own(v.positions, id)?.width !== own(next.positions, id)?.width ||
          own(v.positions, id)?.height !== own(next.positions, id)?.height,
      ),
      before = this.snapshot(v, ids),
      after = this.snapshot(next, ids);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.entries.splice(this.cursor);
    this.entries.push({ before, after });
    if (this.entries.length > 64) this.entries.shift();
    this.cursor = this.entries.length;
    this.restore(v, after);
  }
  undo(v: GraphPresentation) {
    this.check(v);
    if (!this.cursor) return false;
    this.restore(v, this.entries[--this.cursor].before);
    return true;
  }
  redo(v: GraphPresentation) {
    this.check(v);
    if (this.cursor === this.entries.length) return false;
    this.restore(v, this.entries[this.cursor++].after);
    return true;
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.entries.length;
  }
}
