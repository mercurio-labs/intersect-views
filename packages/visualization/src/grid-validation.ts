import { validateProjection } from "./rendering.ts";
import {
  object,
  text,
  list,
  integer,
  binding,
  validateSceneEnvelope,
} from "./validation.ts";
import type { GridScene, GridTargetResponse, GridRuleSet } from "./protocol.ts";
const fail = (s: string): never => {
  throw new Error(s);
};
const bytes = (s: string) => new TextEncoder().encode(s).length;
function label(v: unknown) {
  text(v);
  if (bytes(v) > 4096) fail("Grid label limit");
}
// Binding property order has no wire meaning; arrays retain their order.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function validateGridTargets(
  value: unknown,
): asserts value is GridTargetResponse {
  const v = object(value, [
    "revision",
    "viewKey",
    "toolId",
    "row",
    "column",
    "member",
    "enabled",
    "reason",
  ]);
  integer(v.revision);
  for (const k of ["viewKey", "toolId", "row", "column"]) text(v[k], true);
  if (v.member !== null) text(v.member, true);
  text(v.reason);
  if (typeof v.enabled !== "boolean" || (!v.enabled && !v.reason))
    fail("Invalid grid target reason");
}
export function validateGridScene(value: unknown): asserts value is GridScene {
  commonGrid(value);
}

function commonGrid(value: unknown): asserts value is GridScene {
  const s = object(value, [
    "schemaVersion",
    "form",
    "ruleSet",
    "revision",
    "view",
    "palette",
    "problems",
    "grid",
  ]);
  if (s.form !== "grid") fail("Invalid grid form");
  const { grid } = s;
  validateSceneEnvelope(s);
  const g = object(grid, ["kind", "rows", "columns", "cells"]);
  if (g.kind !== "table" && g.kind !== "matrix") fail("Unknown grid kind");
  const ids = new Set<string>();
  const add = (v: unknown) => {
    text(v, true);
    if (ids.has(v)) fail("Duplicate grid identity");
    ids.add(v);
    return v;
  };
  const axes = (values: unknown, max: number) => {
    const a = list(values),
      keys = new Set<string>();
    if (a.length > max) fail("Grid axis limit");
    return a.map((v) => {
      const r = object(v, ["id", "label", "binding"]);
      add(r.id);
      label(r.label);
      binding(r.binding);
      const b = r.binding as { key: string; context: string[] };
      if (b.context.length || keys.has(b.key))
        fail("Duplicate/contextual axis");
      keys.add(b.key);
      return r;
    });
  };
  const rows = axes(g.rows, 500),
    rowMap = new Map(rows.map((r) => [r.id, r])),
    cols =
      g.kind === "matrix"
        ? axes(g.columns, 128)
        : list(g.columns).map((v) => {
            const c = object(v, ["id", "label", "scalar", "many"]);
            add(c.id);
            label(c.label);
            if (
              !["string", "integer", "boolean", "reference"].includes(
                c.scalar as string,
              ) ||
              typeof c.many !== "boolean"
            )
              fail("Invalid projection type");
            return c;
          });
  if (g.kind === "table" && (!cols.length || cols.length > 30))
    fail("Table column limit");
  const colMap = new Map(cols.map((c) => [c.id, c]));
  let totalItems = 0,
    totalMembers = 0;
  function atom(value: unknown): string {
    const v = object(value, ["kind"], ["value", "label", "binding", "items"]);
    switch (v.kind) {
      case "string":
        object(value, ["kind", "value"]);
        text(v.value);
        if (bytes(v.value) > 65536) fail("Grid scalar string limit");
        return "string";
      case "integer":
        object(value, ["kind", "value"]);
        text(v.value);
        if (
          !/^(0|-?[1-9]\d*)$/.test(v.value) ||
          BigInt(v.value) < -9223372036854775808n ||
          BigInt(v.value) > 9223372036854775807n
        )
          fail("Invalid int64");
        return "integer";
      case "boolean":
        object(value, ["kind", "value"]);
        if (typeof v.value !== "boolean") fail("Invalid Boolean");
        return "boolean";
      case "reference":
        object(value, ["kind", "label", "binding"]);
        label(v.label);
        binding(v.binding);
        return "reference";
      case "list":
        object(value, ["kind", "items"]);
        const items = list(v.items);
        totalItems += items.length;
        if (
          !items.length ||
          totalItems > 5000 ||
          items.some((i) => (i as { kind: string }).kind === "list")
        )
          fail("Invalid grid list");
        const kinds = items.map(atom);
        if (new Set(kinds).size !== 1) fail("Mixed grid list");
        return kinds[0];
      default:
        return fail("Invalid grid value");
    }
  }
  const cells = list(g.cells),
    pairs = new Set<string>();
  if (cells.length > 5000) fail("Grid cells limit");
  for (const item of cells) {
    const c = object(item, [
      "id",
      "row",
      "column",
      "origin",
      "value",
      "binding",
      "members",
    ]);
    add(c.id);
    const row = rowMap.get(c.row),
      column = colMap.get(c.column);
    if (!row || !column) throw new Error("Dangling cell");
    const pair = JSON.stringify([c.row, c.column]);
    if (pairs.has(pair)) fail("Duplicate coordinate");
    pairs.add(pair);
    binding(c.binding);
    const scalar = atom(c.value),
      v = c.value as { kind: string; value: unknown };
    const members = list(c.members),
      keys = new Set<string>();
    totalMembers += members.length;
    if (totalMembers > 5000) fail("Grid members limit");
    for (const item of members) {
      const m = object(item, ["id", "label", "binding"]);
      add(m.id);
      label(m.label);
      binding(m.binding);
      const key = (m.binding as { key: string }).key;
      if (keys.has(key)) fail("Duplicate member");
      keys.add(key);
    }
    if (g.kind === "table") {
      if (
        c.origin !== "query" ||
        members.length ||
        !same(c.binding, row.binding) ||
        scalar !== column.scalar ||
        (v.kind === "list") !== column.many
      )
        fail("Invalid query provenance/type");
    } else if (c.origin === "derived") {
      if (
        members.length ||
        v.kind !== "boolean" ||
        v.value !== true ||
        !same(c.binding, row.binding)
      )
        fail("Invalid derived provenance");
    } else if (
      c.origin !== "relation" ||
      !members.length ||
      v.kind !== "integer" ||
      v.value !== String(members.length) ||
      !same(c.binding, (members[0] as { binding: unknown }).binding)
    )
      fail("Invalid relation provenance");
  }
  if (bytes(JSON.stringify(value)) > 8 * 1024 * 1024)
    fail("Grid encoded scene limit");
}
// Keep the envelope check and full sparse validation together.
export { commonGrid as validateSparseGrid };
export function validateGridRules(
  value: unknown,
): asserts value is GridRuleSet {
  const r = object(value, [
    "schemaVersion",
    "projection",
    "id",
    "label",
    "language",
    "form",
    "grid",
  ]);
  if (r.schemaVersion !== 8 || r.form !== "grid")
    fail("Invalid grid rule version/form");
  validateProjection(r.projection, false);
  for (const k of ["id", "label", "language"]) text(r[k], true);
  const g = object(
    r.grid,
    ["kind"],
    ["query", "rowLabel", "columns", "rows", "cells"],
  );
  const tools = new Set(["select"]);
  if (g.kind === "table") {
    object(g, ["kind", "query", "rowLabel", "columns"]);
    const names = query(g.query),
      used = new Set<string>();
    text(g.rowLabel, true);
    used.add(g.rowLabel);
    const ids = new Set<string>(),
      cs = list(g.columns);
    if (!cs.length || cs.length > 30) fail("Table columns limit");
    for (const v of cs) {
      const c = object(v, ["id", "label", "value"]);
      text(c.id, true);
      text(c.label);
      text(c.value, true);
      if (ids.has(c.id) || used.has(c.value)) fail("Duplicate projection");
      ids.add(c.id);
      used.add(c.value);
    }
    if (names.size !== used.size || [...names].some((n) => !used.has(n)))
      fail("Unused projection");
  } else if (g.kind === "matrix") {
    object(g, ["kind", "rows", "columns", "cells"]);
    for (const v of [g.rows, g.columns]) {
      const a = object(v, ["query", "label"]),
        names = query(a.query);
      text(a.label, true);
      if (names.size !== 1 || !names.has(a.label))
        fail("Invalid axis projection");
    }
    const c = object(g.cells, ["related"], ["members", "edit"]);
    text(c.related, true);
    if (c.members !== undefined) {
      const m = object(c.members, ["select", "column", "label"]);
      for (const v of Object.values(m)) text(v, true);
    }
    if (c.edit !== undefined) {
      if (c.members === undefined) fail("Editing requires members");
      const e = object(c.edit, [], ["create", "delete"]);
      if (!Object.keys(e).length) fail("Empty edit");
      for (const k of ["create", "delete"]) {
        if (e[k] === undefined) continue;
        const a = object(
          e[k],
          k === "create"
            ? ["tool", "command", "rowAccepts", "columnAccepts"]
            : ["tool", "command", "accepts"],
        );
        for (const v of Object.values(a)) text(v, true);
        if (tools.has(a.tool as string)) fail("Duplicate grid tool");
        tools.add(a.tool as string);
      }
    }
  } else fail("Invalid grid rule kind");
}
function query(value: unknown): Set<string> {
  const q = object(value, ["from", "select"], ["filter", "order_by"]);
  text(q.from, true);
  const selects = list(q.select);
  if (!selects.length || selects.length > 31) fail("Query projection limit");
  let nodes = 0;
  function expr(v: unknown) {
    if (++nodes > 512) fail("Query nodes limit");
    const e = object(v, ["op"], ["path", "value"]);
    if (e.op === "field" || e.op === "count") {
      object(v, ["op", "path"]);
      text(e.path, true);
    } else if (e.op === "literal") object(v, ["op", "value"]);
    else fail("Unsupported query expression");
  }
  function pred(v: unknown, depth = 0) {
    if (++nodes > 512 || depth > 24) fail("Query predicate limit");
    const p = object(
      v,
      ["op"],
      [
        "expression",
        "left",
        "comparison",
        "right",
        "predicates",
        "predicate",
        "path",
      ],
    );
    switch (p.op) {
      case "is_null":
        object(v, ["op", "expression"]);
        expr(p.expression);
        break;
      case "compare":
        object(v, ["op", "left", "comparison", "right"]);
        if (
          !["eq", "ne", "lt", "le", "gt", "ge"].includes(p.comparison as string)
        )
          fail("Invalid comparison");
        expr(p.left);
        expr(p.right);
        break;
      case "and":
      case "or":
        object(v, ["op", "predicates"]);
        for (const a of list(p.predicates)) pred(a, depth + 1);
        break;
      case "not":
        object(v, ["op", "predicate"]);
        pred(p.predicate, depth + 1);
        break;
      case "any":
      case "all":
        object(v, ["op", "path", "predicate"]);
        text(p.path, true);
        pred(p.predicate, depth + 1);
        break;
      default:
        fail("Invalid predicate");
    }
  }
  const names = new Set<string>();
  for (const v of selects) {
    const c = object(v, ["name", "expression"]);
    text(c.name, true);
    if (c.name === "__element" || names.has(c.name))
      fail("Reserved/duplicate query column");
    names.add(c.name);
    expr(c.expression);
  }
  if (q.filter !== undefined && q.filter !== null) pred(q.filter);
  if (q.order_by !== undefined) {
    const os = list(q.order_by);
    if (os.length > 8) fail("Query ordering limit");
    for (const v of os) {
      const o = object(v, ["expression"], ["descending"]);
      expr(o.expression);
      if (o.descending !== undefined && typeof o.descending !== "boolean")
        fail("Invalid descending");
    }
  }
  return names;
}
