import { ViewCanvas } from "../../packages/visualization/src/view-canvas.ts";
import { WorkerHost } from "../../packages/visualization/src/worker-host.ts";
import {
  sha256,
  PRESENTATION_CAPABILITIES,
  type PresentationInput,
} from "../../packages/visualization/src/presentation-package.ts";
import {
  parsePresentation,
  type SceneResponse,
  type View,
  type Presentation,
  type Binding,
} from "../../packages/visualization/src/protocol.ts";
import Worker from "./symbols.worker?worker";
import library from "../views/symbols/properties.symbols.json?raw";
import rulesText from "../views/symbols/properties.viewrules.json?raw";
import palette from "../views/symbols/symbols.palette.json?raw";
const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T,
  key = "intersect.symbol-properties.v5";
const status = (s: unknown) => {
  $("status").textContent = String(s);
};
let generation = 0,
  protectedRule = false;
let failed: unknown;
let active:
  | {
      host: WorkerHost;
      canvas: ViewCanvas;
      scene: SceneResponse;
      source: string;
      presentation: Presentation;
      input: PresentationInput;
      root: HTMLElement;
    }
  | undefined;
function select(binding: Binding, reveal: boolean) {
  $("binding").textContent = JSON.stringify(binding, null, 2);
  if (reveal && active) {
    const area = $<HTMLTextAreaElement>("source"),
      at = (p: { line: number; character: number }) =>
        active!.source
          .split("\n")
          .slice(0, p.line)
          .reduce((n, s) => n + s.length + 1, 0) + p.character;
    area.focus();
    area.setSelectionRange(at(binding.range.start), at(binding.range.end));
  }
}
async function load() {
  const ticket = ++generation,
    host = new WorkerHost(new Worker());
  let candidate: typeof active;
  status("Checking actual source dependency and presentation package…");
  try {
    const init = await host.request<{
        language: { namespace: string; fingerprint: string };
      }>("initialize", { protocolVersion: 2 }),
      rules = JSON.parse(rulesText);
    if (protectedRule)
      rules.symbols[0].graphic.parameters.fill = {
        kind: "constant",
        value: "#c4d5e6",
      };
    const resources = [
      { id: "symbols", content: library },
      { id: "rules", content: JSON.stringify(rules) },
      { id: "palette", content: palette },
    ];
    const input: PresentationInput = {
      root: "harness.properties@1",
      manifests: [
        {
          schemaVersion: 1,
          id: "harness.properties",
          version: "1",
          language: init.language.namespace,
          languageFingerprint: init.language.fingerprint,
          requires: PRESENTATION_CAPABILITIES,
          dependencies: [],
          resources: await Promise.all(
            resources.map(async (r, i) => ({
              id: r.id,
              kind: (["symbolLibrary", "ruleSet", "palette"] as const)[i],
              sha256: await sha256(r.content),
            })),
          ),
        },
      ],
      resources,
    };
    await host.request("views/preparePresentation", input);
    const doc = {
        schemaVersion: 1,
        key: "properties",
        name: "Repeated inherited symbols",
        ruleSet: rules.id,
        scope: { schemaVersion: 1, ops: [] },
      },
      analysis = await host.request<{ clean: boolean; diagnostics: unknown[] }>(
        "workspace/analyze",
        {
          revision: 1,
          sources: [{ uri: "symbols.view.json", text: JSON.stringify(doc) }],
        },
      );
    if (!analysis.clean) throw Error(JSON.stringify(analysis.diagnostics));
    const catalog = await host.request<{ views: View[] }>("views/catalog", {
        revision: 1,
      }),
      view = catalog.views.find((v) => v.key === doc.key);
    if (!view) throw Error("No native fixture view");
    const scene = await host.request<SceneResponse>("views/scene", {
        revision: 1,
        viewKey: view.key,
        scope: {
          schemaVersion: 1,
          ops: view.owners
            .filter((o) => ["Alpha", "Beta"].includes(o.label))
            .map((o) => ({ op: "addSeed", element: o.key })),
        },
      }),
      source = (
        await host.request<{ text: string }>("intersect/source", {
          revision: 1,
          uri: "library:/symbols.harness",
        })
      ).text;
    const bytes = localStorage.getItem(key),
      presentation = bytes
        ? parsePresentation(bytes)
        : { schemaVersion: 5 as const, views: {} },
      root = document.createElement("div");
    root.style.height = "100%";
    const writable = () => !$<HTMLInputElement>("readonly-store").checked;
    const canvas = new ViewCanvas(root, {
      view() {},
      select,
      async command() {
        throw Error("Read-only fixture has no semantic editing provider");
      },
      presentation(value) {
        if (active?.canvas !== canvas) return;
        if (!writable()) throw Error("Presentation store is read only");
        active.presentation = value;
        localStorage.setItem(key, JSON.stringify(value));
      },
      save() {
        if (!writable()) throw Error("Presentation store is read only");
        localStorage.setItem(key, JSON.stringify(active!.presentation));
      },
      presentationWritable: writable,
      palette() {},
      undo() {
        status("Source undo stays independent of style undo");
      },
    });
    candidate = { host, canvas, scene, source, presentation, input, root };
    canvas.setPresentation(presentation);
    canvas.views(catalog.views, view.key);
    canvas.setScene(scene);
    root.style.visibility = "hidden";
    root.style.position = "absolute";
    root.style.inset = "0";
    $("canvas").append(root);
    await canvas.whenReady();
    if (ticket !== generation) throw Error("Package superseded");
    active?.canvas.destroy();
    active?.host.destroy();
    active = candidate;
    candidate = undefined;
    root.style.visibility = "";
    root.style.position = "";
    root.style.inset = "";
    $("canvas").replaceChildren(root);
    $<HTMLTextAreaElement>("source").value = source;
    status("Ready · select a symbol and open Symbol properties");
  } catch (error) {
    failed = candidate?.scene;
    candidate?.canvas.destroy();
    candidate?.root.remove();
    host.destroy();
    if (ticket === generation) status(`Candidate refused: ${String(error)}`);
  }
}
$("reload").onclick = () => void load();
$("reset").onclick = () => {
  localStorage.removeItem(key);
  void load();
};
$("protect").onclick = () => {
  protectedRule = !protectedRule;
  localStorage.removeItem(key);
  void load();
};
$("readonly-store").onchange = () => {
  active?.canvas.setStale();
  void load();
};
Object.assign(window, {
  symbols: {
    get active() {
      return active;
    },
    load,
    get protectedRule() {
      return protectedRule;
    },
    get failed() {
      return failed;
    },
  },
});
void load();
