import { validateProjection } from "./rendering.ts";
import {
  object,
  text,
  list,
  binding,
  integer,
  validateSceneEnvelope,
} from "./validation.ts";
import { label, labelRule } from "./graph-validation.ts";
import type { LaneGraphScene, LaneTargetResponse } from "./lane-protocol.ts";
function axis(value: unknown) {
  const a = object(value, ["direction", "semantic"]);
  if (
    a.semantic !== true ||
    !["horizontal", "vertical"].includes(a.direction as string)
  )
    throw Error("Invalid semantic lane axis");
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function validateLaneScene(
  value: unknown,
): asserts value is LaneGraphScene {
  const s = object(value, [
    "schemaVersion",
    "form",
    "ruleSet",
    "revision",
    "view",
    "palette",
    "problems",
    "axis",
    "lanes",
    "steps",
    "spans",
    "order",
  ]);
  if (s.schemaVersion !== 7 || s.form !== "laneGraph")
    throw Error("Unsupported lane version/form");
  text(s.ruleSet, true);
  integer(s.revision);
  validateSceneEnvelope(s);
  axis(s.axis);
  list(s.problems).forEach((x) => text(x));
  const lanes = list(s.lanes),
    steps = list(s.steps),
    spans = list(s.spans),
    order = list(s.order);
  if (
    lanes.length > 128 ||
    steps.length > 500 ||
    spans.length > 500 ||
    order.length !== steps.length
  )
    throw Error("Lane count limit/cardinality");
  const ids = new Set<string>(),
    keys = new Set<string>(),
    containers = new Set<string>();
  const add = (id: unknown, _?: boolean) => {
    text(id, true);
    if (ids.has(id)) throw Error("Duplicate lane identity");
    ids.add(id);
  };
  const uniqueKey = (b: any) => {
    binding(b);
    if (keys.has(b.key)) throw Error("Duplicate lane element");
    keys.add(b.key);
  };
  const actions = new Set(
    (s.palette as LaneGraphScene["palette"]).groups
      .flatMap((g) => g.entries)
      .filter((t) => t.gesture === "action")
      .map((t) => t.id),
  );
  let parts = 0;
  const lm = new Map<
    string,
    { index: number; container: string; binding: any }
  >();
  lanes.forEach((value, index) => {
    const l = object(value, ["id", "rule", "label", "binding", "container"]);
    add(l.id);
    text(l.rule, true);
    text(l.container, true);
    uniqueKey(l.binding);
    const b = l.binding as any;
    if (!same(b.context, [l.container]) || b.key === l.container)
      throw Error("Lane context mismatch");
    containers.add(l.container);
    parts += label(l.label, b, add, actions);
    lm.set(l.id as string, { index, container: l.container, binding: b });
  });
  if (containers.size > 32) throw Error("Lane containers limit");
  const sm = new Map<string, number>();
  steps.forEach((value, index) => {
    const step = object(value, [
      "id",
      "rule",
      "label",
      "binding",
      "lane",
      "rank",
      "unordered",
      "predecessors",
    ]);
    add(step.id);
    text(step.rule, true);
    text(step.lane, true);
    uniqueKey(step.binding);
    integer(step.rank);
    const lane = lm.get(step.lane),
      b = step.binding as any;
    if (
      !lane ||
      !same(b.context, lane.binding.context) ||
      b.key === lane.container ||
      (step.rank as number) >= steps.length ||
      typeof step.unordered !== "boolean"
    )
      throw Error("Invalid lane step");
    parts += label(step.label, b, add, actions);
    sm.set(step.id as string, index);
  });
  if (parts > 20000) throw Error("Lane label parts limit");
  const typed = steps as LaneGraphScene["steps"],
    incoming = steps.map(() => 0),
    outgoing = steps.map(() => [] as number[]);
  let arcs = 0;
  typed.forEach((step, i) => {
    const seen = new Set<string>();
    for (const id of list(step.predecessors)) {
      text(id, true);
      const p = sm.get(id);
      if (
        p === undefined ||
        p === i ||
        seen.has(id) ||
        !same(typed[p].binding.context, step.binding.context)
      )
        throw Error("Invalid lane predecessor");
      seen.add(id);
      incoming[i]++;
      outgoing[p].push(i);
      arcs++;
    }
  });
  if (arcs > 4000) throw Error("Lane arcs limit");
  const ready = new Set(incoming.flatMap((n, i) => (n === 0 ? [i] : []))),
    unordered = steps.map(() => false);
  let rank = 0;
  while (ready.size) {
    if (ready.size > 1) for (const i of ready) unordered[i] = true;
    const i = Math.min(...ready);
    ready.delete(i);
    if (order[rank] !== typed[i].id || typed[i].rank !== rank)
      throw Error("Invalid stable lane order/rank");
    rank++;
    for (const j of outgoing[i]) if (--incoming[j] === 0) ready.add(j);
  }
  if (
    rank !== steps.length ||
    typed.some((s, i) => s.unordered !== unordered[i])
  )
    throw Error("Lane cycle/unordered marker");
  const owners = new Set<string>();
  for (const value of spans) {
    const span = object(value, ["id", "step", "end", "lanes"]);
    add(span.id);
    text(span.step, true);
    text(span.end, true);
    const a = sm.get(span.step),
      b = sm.get(span.end),
      bands = list(span.lanes);
    if (
      a === undefined ||
      b === undefined ||
      owners.has(span.step) ||
      typed[b].rank <= typed[a].rank ||
      !same(typed[a].binding.context, typed[b].binding.context) ||
      !bands.length ||
      !bands.includes(typed[a].lane)
    )
      throw Error("Invalid span endpoints");
    owners.add(span.step);
    let previous: number | undefined;
    for (const id of bands) {
      text(id, true);
      const lane = lm.get(id);
      if (
        !lane ||
        !same(lane.binding.context, typed[a].binding.context) ||
        (previous !== undefined && lane.index !== previous + 1)
      )
        throw Error("Noncontiguous lane span");
      previous = lane.index;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(s)).length > 8 * 1024 * 1024)
    throw Error("Lane encoded scene limit");
}
export function validateLaneRules(value: unknown) {
  const s = object(value, [
    "schemaVersion",
    "projection",
    "form",
    "id",
    "label",
    "language",
    "laneGraph",
  ]);
  if (s.schemaVersion !== 8 || s.form !== "laneGraph")
    throw Error("Unsupported lane rules");
  validateProjection(s.projection, false);
  for (const name of [s.id, s.label, s.language]) text(name, true);
  const r = object(
      s.laneGraph,
      ["container", "lane", "step", "axis"],
      ["edit"],
    ),
    c = object(r.container, ["match", "lanes", "steps"]),
    l = object(r.lane, ["id", "label"]),
    t = object(r.step, ["id", "label", "lane", "after", "end", "across"]);
  for (const name of [
    ...Object.values(c),
    l.id,
    t.id,
    t.lane,
    t.after,
    t.end,
    t.across,
  ])
    text(name, true);
  if (l.id === t.id) throw Error("Duplicate lane rule ID");
  labelRule(l.label);
  labelRule(t.label);
  axis(r.axis);
  if (r.edit !== undefined) {
    const e = object(r.edit, ["tool", "command", "accepts"]);
    Object.values(e).forEach((x) => text(x, true));
  }
}
export function validateLaneTargets(
  value: unknown,
): asserts value is LaneTargetResponse {
  const r = object(value, [
    "revision",
    "viewKey",
    "toolId",
    "step",
    "lane",
    "before",
    "end",
    "enabled",
    "reason",
  ]);
  integer(r.revision);
  for (const x of [r.viewKey, r.toolId, r.step, r.lane]) text(x, true);
  for (const x of [r.before, r.end])
    if (x !== null) {
      text(x, true);
      if (x === r.step) throw Error("Self lane target");
    }
  text(r.reason);
  if (typeof r.enabled !== "boolean" || (!r.enabled && !r.reason))
    throw Error("Disabled lane target requires reason");
}
