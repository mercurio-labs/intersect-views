/** Exact-byte resource admission for an already prepared language. No fetch/I/O. */
import { graphicArray, graphicId, graphicObject } from "./graphics-contract.ts";
export interface PresentationInput { root: string; manifests: PresentationManifest[]; resources: PresentationResource[] }
export interface PresentationManifest {
  schemaVersion: 1; id: string; version: string; language: string;
  languageFingerprint: string; requires: string[];
  dependencies: { id: string; version: string; sha256: string }[];
  resources: { id: string; kind: ResourceKind; sha256: string }[];
}
export type ResourceKind = "symbolLibrary" | "ruleSet" | "palette" | "notation" | "renderingRegistry";
export interface PresentationResource { id: string; content: string }
export interface ResolvedPresentation { fingerprint: string; manifests: PresentationManifest[]; resources: { reference: PresentationManifest["resources"][number]; resource: PresentationResource }[] }
export const PRESENTATION_CAPABILITIES = ["graphics.composition.v1", "graphics.text.v1", "graphics.anchors.v1", "rules.graph.v6", "rules.graph.v7", "views.rendering.v1", "rules.graph.v8", "views.routing.v1", "views.labelPlacement.v1", "views.symbolProperties.v1"];
const encoder = new TextEncoder();
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw Error("Non-JSON canonical value");
  return result;
}
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function resolvePresentation(input: unknown, language: string, languageFingerprint: string): Promise<ResolvedPresentation> {
  if (!/^[a-f0-9]{64}$/.test(languageFingerprint)) throw Error("Invalid prepared language fingerprint");
  const v = graphicObject(input, ["root", "manifests", "resources"]); graphicId(v.root);
  if (encoder.encode(JSON.stringify(v)).length > 2 * 1024 * 1024) throw Error("Presentation input exceeds 2 MiB");
  const manifests = new Map<string, PresentationManifest>(), resources = new Map<string, PresentationResource>();
  for (const value of graphicArray(v.manifests, 64)) {
    const m = graphicObject(value, ["schemaVersion", "id", "version", "language", "languageFingerprint", "requires", "dependencies", "resources"]);
    graphicId(m.id); graphicId(m.version); graphicId(m.language);
    if (m.id.includes("@") || m.version.includes("@")) throw Error("Ambiguous package identity separator");
    if (m.schemaVersion !== 1 || m.language !== language || m.languageFingerprint !== languageFingerprint) throw Error("Presentation language/version/fingerprint mismatch");
    const requires = graphicArray(m.requires, 64);
    if (new Set(requires).size !== requires.length || requires.some((s) => !PRESENTATION_CAPABILITIES.includes(s as string))) throw Error("Unsupported/duplicate presentation capability");
    for (const dep of graphicArray(m.dependencies, 64)) {
      const d = graphicObject(dep, ["id", "version", "sha256"]);
      if (typeof d.id === "string" && d.id.includes("@") || typeof d.version === "string" && d.version.includes("@")) throw Error("Ambiguous package identity separator");
      graphicId(d.id); graphicId(d.version);
      if (typeof d.sha256 !== "string") throw Error("Invalid dependency hash");
    }
    for (const res of graphicArray(m.resources, 64)) {
      const r = graphicObject(res, ["id", "kind", "sha256"]); graphicId(r.id);
      if (!["symbolLibrary", "ruleSet", "palette", "notation", "renderingRegistry"].includes(r.kind as string) || typeof r.sha256 !== "string") throw Error("Invalid resource reference");
    }
    if ((m.resources as {kind:string}[]).some(r=>r.kind==="renderingRegistry") && !requires.includes("views.rendering.v1")) throw Error("Rendering registry requires views.rendering.v1");
    if((m.resources as {kind:string}[]).some(r=>r.kind==="ruleSet") && ["rules.graph.v8","views.routing.v1","views.labelPlacement.v1"].some(c=>!requires.includes(c)))throw Error("M14 graph rule resources require rules.graph.v8, views.routing.v1 and views.labelPlacement.v1");
    const key = `${m.id}@${m.version}`;
    if (manifests.has(key)) throw Error("Duplicate presentation manifest");
    manifests.set(key, value as PresentationManifest);
  }
  if (!manifests.size) throw Error("Missing presentation manifest");
  for (const value of graphicArray(v.resources, 64)) {
    const r = graphicObject(value, ["id", "content"]); graphicId(r.id);
    if (typeof r.content !== "string" || resources.has(r.id)) throw Error("Duplicate/invalid presentation resource");
    resources.set(r.id, value as PresentationResource);
  }
  const result: ResolvedPresentation = { fingerprint: "", manifests: [], resources: [] };
  const visiting = new Set<string>(), seen = new Set<string>(), resourceSeen = new Map<string, string>();
  const visit = async (key: string): Promise<void> => {
    if (visiting.has(key)) throw Error("Presentation dependency cycle");
    if (seen.has(key)) return;
    const m = manifests.get(key);
    if (!m) throw Error(`Missing presentation manifest ${key}`);
    visiting.add(key);
    const dependencies = new Set<string>();
    for (const dep of m.dependencies) {
      const key = `${dep.id}@${dep.version}`, target = manifests.get(key);
      if (dependencies.has(key)) throw Error("Duplicate presentation dependency");
      dependencies.add(key);
      if (!target || await sha256(canonicalJson(target)) !== dep.sha256) throw Error("Missing dependency/hash mismatch");
      await visit(key);
    }
    const local = new Set<string>();
    for (const ref of m.resources) {
      const resource = resources.get(ref.id);
      if (!resource || local.has(ref.id)) throw Error("Missing/duplicate resource reference");
      local.add(ref.id);
      const digest = await sha256(resource.content);
      if (digest !== ref.sha256) throw Error(`Presentation resource hash mismatch: ${ref.id}`);
      const signature = `${ref.kind}:${digest}`;
      if (resourceSeen.has(ref.id)) { if (resourceSeen.get(ref.id) !== signature) throw Error("Conflicting resource kind/hash"); }
      else { resourceSeen.set(ref.id, signature); result.resources.push({ reference: ref, resource }); }
    }
    visiting.delete(key); seen.add(key); result.manifests.push(m);
  };
  await visit(v.root);
  if (seen.size !== manifests.size || resourceSeen.size !== resources.size) throw Error("Unreferenced presentation input");
  result.fingerprint = await sha256(canonicalJson({ language: languageFingerprint, manifests: result.manifests, resources: result.resources.map(({ reference }) => reference) }));
  return result;
}
