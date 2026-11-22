import { object, text, list, binding, slot, integer } from "./validation.ts";
import type { LabelTargetResponse } from "./protocol.ts";
export function labelString(value: unknown) {
  text(value);
  if (new TextEncoder().encode(value).length > 4096 || /[\r\n\t]/.test(value))
    throw new Error("Graph label text limit/unsupported multiline text");
}
export function label(
  value: unknown,
  owner: unknown,
  add: (v: unknown, e: boolean) => void,
  actions: Set<string>,
): number {
  const l = object(value, ["parts"]),
    parts = list(l.parts);
  if (parts.length > 32) throw new Error("Graph label parts limit");
  let size = 0;
  for (const value of parts) {
    const p = object(value, ["id", "text", "binding", "editTool"]);
    add(p.id, false);
    labelString(p.text);
    size += new TextEncoder().encode(p.text as string).length;
    if (p.binding !== null) {
      binding(p.binding);
      if (
        JSON.stringify((p.binding as { context: unknown }).context) !==
        JSON.stringify((owner as { context: unknown }).context)
      )
        throw new Error("Label binding context mismatch");
    }
    if (p.editTool !== null) {
      text(p.editTool, true);
      if (p.binding === null || !actions.has(p.editTool))
        throw new Error("Unbound or missing label action");
    }
  }
  if (size > 4096) throw new Error("Graph label text limit");
  return parts.length;
}
export function labelRule(value: unknown): { tool: string; command: string }[] {
  if (
    typeof value === "string" ||
    (value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (Object.hasOwn(value, "text")||Object.hasOwn(value,"sourceText")))
  ) {
    slot(value);
    if (typeof value !== "string" && Object.hasOwn(value as object,"text"))
      labelString((value as { text: unknown }).text);
    return [];
  }
  const r = object(value, ["parts"]),
    parts = list(r.parts),
    ids = new Set<string>(),
    edits: { tool: string; command: string }[] = [];
  if (parts.length > 32) throw new Error("Graph label parts limit");
  for (const value of parts) {
    const p = object(value, ["id", "subject", "text"], ["when", "edit"]);
    text(p.id, true);
    if (p.id.startsWith("__") || ids.has(p.id))
      throw new Error("Duplicate/reserved label part ID");
    ids.add(p.id);
    slot(p.text);
    if(typeof p.text==="object"&&p.text!==null&&Object.hasOwn(p.text,"sourceText")&&p.edit!==undefined)throw Error("Stored source text is a read-only display slot");
    if (typeof p.text !== "string" && Object.hasOwn(p.text as object,"text"))
      labelString((p.text as { text: unknown }).text);
    const s = object(p.subject, ["kind"], ["select"]);
    if (s.kind === "select") {
      object(s, ["kind", "select"]);
      text(s.select, true);
    } else if (s.kind === "self" || s.kind === "none") object(s, ["kind"]);
    else throw new Error("Unknown label subject");
    if (p.when !== undefined) text(p.when, true);
    if (
      s.kind === "none" &&
      (typeof p.text === "string" || !Object.hasOwn(p.text as object,"text") || p.edit !== undefined)
    )
      throw new Error("Unbound parts require literal text and no edit");
    if (p.edit !== undefined) {
      const e = object(p.edit, ["tool", "command", "accepts"]);
      for (const v of Object.values(e)) text(v, true);
      edits.push(e as { tool: string; command: string });
    }
  }
  return edits;
}
export function validateLabelTargets(
  value: unknown,
): asserts value is LabelTargetResponse {
  const v = object(value, [
    "revision",
    "viewKey",
    "toolId",
    "part",
    "enabled",
    "reason",
  ]);
  integer(v.revision);
  for (const k of ["viewKey", "toolId", "part"]) text(v[k], true);
  text(v.reason);
  if (typeof v.enabled !== "boolean" || (!v.enabled && !v.reason))
    throw new Error("Disabled label action requires a reason");
}
