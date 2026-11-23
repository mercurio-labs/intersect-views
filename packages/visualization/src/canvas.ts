import { autoLayouts, type AutoLayout } from "./layout-options.ts";
import { logicalId } from "./logical-id.ts";
import { PlacementEditor } from "./placement-editor.ts";
import { PresentationHistory } from "./presentation-state.ts";
import { ROOT_ROUTE_FRAME,type LabelPlacement } from "./routing-contract.ts";
import { projectRoute } from "./routing.ts";
import { routeFrame, validateRoutingResult } from "./routing.ts";
import { builtinBody } from "./builtin-graphics.ts";
import { own, put } from "./records.ts";
import { GraphicDefinitions } from "./graphics-contract.ts";
import { drawGraphic, contentBoxes,edgeLabelLayout,edgeMarkerLayout,legacyMarkerLayout } from "./graph-graphics.ts";
import type { GraphicDrawing } from "./graphics-layout.ts";
import { graphPresentation } from "./protocol.ts";
import {
  labelText,
  type Label,
  type LabelPart,
  type Region,
} from "./protocol.ts";
import { color, validateNotation, type NotationProfile } from "./notation.ts";
import "./canvas.css";
import { validateSceneResponse } from "./protocol";
/** Intersect visualization client.
 * SVG/ELK adapter. It consumes presentation DTOs and emits intents, never source. */
import LayoutWorker from "./layout.worker.js?worker";
import {
  defaultNotation,
  type Binding,
  type Geometry,
  type Layout,
  type Node,
  type Palette,
  type Point,
  type Presentation,
  type GraphSceneResponse as SceneResponse,
  type Tool,
  type View,
  type ScopeOp,
  type GridTargetResponse,
  type LabelTargetResponse,
} from "./protocol";

const esc = (value: string | Label) =>
  (typeof value === "string" ? value : labelText(value)).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const glyph: Record<string, string> = {
  pointer: "↖",
  maximize: "⛶",
  layout: "▦",
  box: "◇",
  port: "▣",
  connection: "⤳",
};
export interface Callbacks {
  laneTargets?(
    tool: Tool,
    step: string,
    lane: string,
    before: string | null,
    end: string | null,
  ): Promise<import("./protocol.ts").LaneTargetResponse | null>;
  copy?(text: string): Promise<void>;
  labelTargets?(tool: Tool, part: string): Promise<LabelTargetResponse | null>;
  targets?(tool: Tool, source?: string): Promise<string[]>;
  gridTargets?(
    tool: Tool,
    row: string,
    column: string,
    member?: string,
  ): Promise<GridTargetResponse | null>;
  scope?(operation: ScopeOp): void;
  view(key: string): void;
  select(binding: Binding, reveal: boolean): void;
  command(
    tool: Tool,
    owner: string,
    args: Record<string, string>,
  ): Promise<void>;
  presentation(value: Presentation): void;
  save(): void;
  palette(path: string): void;
  undo(): void;
  redo?(): void;
}
export class DiagramCanvas {
  private readonly layoutPicker: HTMLSelectElement;
  private readonly viewLayouts = new Map<string, AutoLayout>();
  private pendingArrangement?: { sequence: number; choice: AutoLayout };
  private readyState: "pending" | "ready" | Error = "pending";
  private readyWaiters: { resolve(): void; reject(error: Error): void }[] = [];
  whenReady(): Promise<void> {
    if (this.readyState === "ready") return Promise.resolve();
    if (this.readyState instanceof Error) return Promise.reject(this.readyState);
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }
  private settled(error?: Error) {
    this.readyState = error ?? "ready";
    for (const waiter of this.readyWaiters.splice(0)) error ? waiter.reject(error) : waiter.resolve();
  }
  destroy() {
    this.settled(new Error("Canvas destroyed"));
    this.sequence++; this.targetSequence++;
    this.worker.onmessage = null; this.worker.onerror = null;
    this.worker.terminate(); this.resize.disconnect();
    this.root.replaceChildren();
  }
  private worker = new LayoutWorker();
  private notation: NotationProfile = defaultNotation;
  private response?: SceneResponse;
  private layout?: Layout;
  private presentation: Presentation = { schemaVersion:4, views: {} };
  private editor?:PlacementEditor;
  private placementBase?: import("./protocol.ts").GraphPresentation;
  private selectedEdge?:string;
  private selectedBlock?:string;
  private placementIndex=0;
  private histories=new Map<string,PresentationHistory>();
  private placementDrag?:{pointer:number;start:Point;points?:Point[];placement?:LabelPlacement;matrix?:number[];path?:Point[];origin?:Point};
  private sequence = 0;
  private stale = true;
  private busy = false;
  private tool?: Tool;
  private targetIds = new Set<string>();
  private targetSequence = 0;
  private selected?: string;
  private selectedPart?: string;
  private labelEnabled = false;
  private bindings = new Map<string, Binding>();
  private parts = new Map<
    string,
    {
      part: LabelPart;
      owner: string;
      binding: Binding;
      slot: string;
    }
  >();
  private regions = new Map<string, Region>();
  private viewList: View[] = [];
  private graph: SVGSVGElement;
  private message: HTMLElement;
  private controls: HTMLElement;
  private paletteElement: HTMLElement;
  private viewport = { x: 0, y: 0, zoom: 1 };
  private absolute = new Map<string, Geometry>();
  private portOwners = new Map<string, string>();
  private drag?: { id?: string; start: Point; origin: Point; moved: boolean };
  private resize: ResizeObserver;
  private clickBinding?: Binding;
  private needsFit = true;
  private connection?: {
    source: string;
    start: Point;
    current: Point;
    pointer: number;
  };
  private placing?: {
    before: Set<string>;
    point: Point;
    owner?: string;
    border: boolean;
  };
  private portDrag?: { id: string; owner: string; moved: boolean };
  private resizeDrag?: {
    id: string;
    start: Point;
    width: number;
    height: number;
  };

  constructor(
    private root: HTMLElement,
    private callbacks: Callbacks,
  ) {
    root.classList.add("diagram-workbench");
    root.innerHTML = `<div class="diagram-heading"><span class="diagram-badge">VIEW</span><select aria-label="Diagram view"></select><select aria-label="Auto layout" disabled>${autoLayouts.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("")}</select><span class="diagram-kind"></span><button class="diagram-button" data-reveal-view title="Reveal view declaration">↗ Source</button><button class="diagram-button" data-save-layout>Save layout</button></div><div class="diagram-status" role="status"></div><div class="diagram-body"><aside class="diagram-palette" aria-label="Diagram palette"></aside><div class="diagram-viewport" tabindex="0" aria-label="Diagram canvas"><svg role="img" aria-label="Model diagram"><defs><pattern id="diagram-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" class="grid-dot"/></pattern><marker id="general-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z" class="general-arrow"/></marker><marker id="diagram-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11" fill="none" stroke="context-stroke"/></marker><marker id="diagram-triangle" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z" fill="var(--bg,white)" stroke="context-stroke"/></marker></defs><rect width="100%" height="100%" fill="url(#diagram-grid)"/><g class="diagram-world"></g></svg><div class="diagram-hint">Drag symbols to arrange · drag background to pan · scroll to zoom</div><div class="diagram-zoom"><button aria-label="Zoom out">−</button><span>100%</span><button aria-label="Zoom in">+</button><button aria-label="Fit diagram">⛶</button></div></div></div><form class="diagram-command" hidden></form>`;
    this.graph = root.querySelector("svg")!;
    this.layoutPicker = root.querySelector('[aria-label="Auto layout"]')!;
    this.layoutPicker.onchange = () => {
      const choice = autoLayouts.find(({ id }) => id === this.layoutPicker.value);
      if (choice) this.arrange(true, choice.id);
    };
    const placementTools=document.createElement("div");placementTools.className="diagram-placement-tools";
    placementTools.innerHTML=`<button data-placement="route">Edit route</button><button data-placement="label">Move label</button><button data-placement="reset">Reset placement</button><button data-placement="accept">Accept placement</button><button data-placement="cancel">Cancel placement</button><button data-placement="undo">Undo placement</button><button data-placement="redo">Redo placement</button>`;
    root.querySelector(".diagram-heading")!.after(placementTools);
    placementTools.onclick=e=>{
      const action=(e.target as Element).closest<HTMLButtonElement>("[data-placement]")?.dataset.placement;
      try { this.placementAction(action); }catch(error){this.status(error instanceof Error?error.message:String(error));}
    };
    const details = document.createElement("div");
    details.className = "diagram-details";
    details.hidden = true;
    root.querySelector(".diagram-heading")!.after(details);
    details.addEventListener("click", (e) => {
      const index = (e.target as Element).closest<HTMLButtonElement>(
        "[data-detail]",
      )?.dataset.detail;
      if (index !== undefined && this.response)
        this.callbacks.select(
          this.response.scene.view.details[Number(index)].binding,
          true,
        );
    });
    this.message = root.querySelector(".diagram-status")!;
    this.controls = root.querySelector(".diagram-command")!;
    this.paletteElement = root.querySelector(".diagram-palette")!;
    root
      .querySelector("select")!
      .addEventListener("change", (e) =>
        callbacks.view((e.target as HTMLSelectElement).value),
      );
    root.querySelector("[data-reveal-view]")!.addEventListener("click", () => {
      if (this.response && !this.stale)
        callbacks.select(this.response.scene.view.binding, true);
    });
    root
      .querySelector("[data-save-layout]")!
      .addEventListener("click", () => callbacks.save());
    this.paletteElement.addEventListener("change", (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.matches("[data-palette-file]")) callbacks.palette(el.value);
    });
    this.paletteElement.addEventListener("click", (e) => {
      const id = (e.target as Element).closest<HTMLButtonElement>("[data-tool]")
        ?.dataset.tool;
      if (id) this.activate(id);
    });
    this.paletteElement.addEventListener("dragstart", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-tool]",
      );
      const tool = this.findTool(button?.dataset.tool);
      if (
        !button ||
        button.disabled ||
        !tool ||
        tool.gesture !== "place" ||
        this.placement(tool) === "connection"
      ) {
        e.preventDefault();
        return;
      }
      e.dataTransfer?.setData("application/x-intersect-tool", tool.id);
      e.dataTransfer?.setData("text/plain", tool.label);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      this.tool = tool;
      void this.updateTargets();
    });
    this.graph.addEventListener("dragover", (e) => {
      if (
        !e.dataTransfer?.types.includes("application/x-intersect-tool") ||
        this.stale ||
        this.busy
      )
        return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      this.dropFeedback(e.clientX, e.clientY);
    });
    this.graph.addEventListener("dragleave", () => this.clearFeedback());
    this.graph.addEventListener("drop", (e) => {
      e.preventDefault();
      this.clearFeedback();
      const tool = this.findTool(
        e.dataTransfer?.getData("application/x-intersect-tool"),
      );
      if (
        !tool ||
        this.stale ||
        this.busy ||
        !this.response?.capabilities.some(
          (c) => c.toolId === tool.id && c.enabled,
        )
      )
        return;
      this.tool = tool;
      if (this.controls.hidden) this.renderTools();
      void this.updateTargets().then(() => this.place(e.clientX, e.clientY));
    });
    this.worker.onmessage = ({ data }) => {
      if (data.id !== this.sequence) return;
      const arrangement = this.pendingArrangement?.sequence === this.sequence
        ? this.pendingArrangement
        : undefined;
      this.pendingArrangement = undefined;
      const fail = (error: Error, message: string, keepFrame = !!arrangement) => {
        this.settled(error);
        this.stale = !keepFrame;
        if (keepFrame) this.readyState = "ready";
        this.renderTools();
        this.status(message);
      };
      if (data.error) {
        fail(new Error(data.error), `Layout failed: ${data.error}`);
        return;
      }
      const candidate=data.result as Layout;
      try {
        validateRoutingResult(candidate.routing);
        const c=candidate.routing.context;
        if(!this.response || c.generation!==this.sequence || c.scopeIdentity!==`layout:${this.sequence}` || c.revision!==this.response.scene.revision || c.viewKey!==this.response.scene.view.key || c.packageFingerprint!==this.response.presentation.fingerprint)throw Error("Stale routing context");
        if(Object.keys(candidate.routing.paths).length!==this.response.scene.edges.length || this.response.scene.edges.some(e=>!Object.hasOwn(candidate.routing!.paths,e.id)))throw Error("Incomplete routing frame");
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)), "Routing result refused");
        return;
      }
      const previous = this.layout;
      this.layout = candidate;
      this.stale = false;
      try {
        this.draw();
      } catch (error) {
        this.layout = previous;
        const failure = error instanceof Error ? error : new Error(String(error));
        // A partial draw can have changed the hit maps. Keep interactions
        // disabled until a complete frame redraws them.
        fail(failure, `Drawing failed: ${failure.message}`, false);
        return;
      }
      if (arrangement) {
        this.viewLayouts.set(candidate.viewKey, arrangement.choice);
        const saved = this.state();
        if (saved) saved.positions = {};
        this.fit(false);
        this.persist();
        this.status(this.response!.scene.problems.join(" · "));
      }
      this.renderTools();
      this.settled();
      this.renderPlacementTools();
      this.finishPlacement();
      if (!own(this.presentation.views, this.response!.scene.view.key))
        this.fit(false);
    };
    this.worker.onerror = () => {
      this.pendingArrangement = undefined;
      this.settled(new Error("Layout worker failed"));
      this.stale = true; this.renderTools();
      this.status("The layout worker failed. Reopen this view to retry.");
    };
    this.graph.addEventListener("pointerdown", (e) => this.pointerDown(e));
    this.graph.addEventListener("pointermove", (e) => this.pointerMove(e));
    this.graph.addEventListener("pointerup", (e) => this.pointerUp(e));
    this.graph.addEventListener("pointercancel", () => {
      this.cancelGesture();
    });
    this.graph.addEventListener("dblclick", (e) => {
      if(this.stale)return;
      const shared=(e.target as Element).closest<SVGElement>("[data-shared-segment]");if(shared){e.preventDefault();this.chooseBranch(Number(shared.dataset.sharedSegment),shared);return;}
      const b = this.bindingAt(e.target) ?? this.clickBinding;
      if (b) this.callbacks.select(b, true);
    });
    this.graph.addEventListener("contextmenu", (event) => {
      const regionElement = (event.target as Element).closest<SVGElement>(
        "[data-region]",
      );
      const nearestSymbol = (event.target as Element).closest<SVGElement>(
        "[data-symbol]",
      );
      const region =
        regionElement &&
        (!nearestSymbol || nearestSymbol.contains(regionElement))
          ? this.regions.get(regionElement.dataset.region!)
          : undefined;
      const symbol = (event.target as Element).closest<SVGElement>(
        "[data-symbol]",
      )?.dataset.symbol;
      const node = this.node(symbol);
      if (
        (!node && !region) ||
        !this.callbacks.scope ||
        this.stale ||
        this.busy
      )
        return;
      event.preventDefault();
      root.querySelector(".diagram-scope-menu")?.remove();
      const menu = document.createElement("div");
      const menuGeneration = this.sequence;
      menu.className = "diagram-scope-menu";
      menu.setAttribute("role", "menu");
      Object.assign(menu.style, {
        position: "fixed",
        left: `${event.clientX}px`,
        top: `${event.clientY}px`,
        zIndex: "100",
        background: "var(--bg, white)",
        border: "1px solid #64748b",
        padding: "8px",
        display: "grid",
        gap: "6px",
      });
      const action = (label: string, operation: ScopeOp) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.setAttribute("role", "menuitem");
        button.onclick = () => {
          menu.remove();
          if (!this.stale && menuGeneration === this.sequence) this.callbacks.scope?.(operation);
        };
        menu.append(button);
      };
      if (region) {
        action("Collapse region", {
          op: "collapse",
          element: region.binding.key,
          context: [...region.binding.context],
        });
        const reveal = document.createElement("button");
        reveal.textContent = "Reveal region source";
        reveal.onclick = () => {
          menu.remove();
          if (!this.stale && menuGeneration === this.sequence) this.callbacks.select(region.binding, true);
        };
        menu.append(reveal);
      } else if (node) {
        for (const relation of node.expand)
          action(`Expand: ${relation.label}`, {
            op: "expand",
            element: node.binding.key,
            relation: relation.id,
            hops: 1,
          });
        action("Hide root", { op: "hide", element: node.binding.key });
        action("Collapse occurrence", {
          op: "collapse",
          element: node.binding.key,
          context: [...node.binding.context],
        });
        action("Remove seed", { op: "removeSeed", element: node.binding.key });
      }
      const close = document.createElement("button");
      close.textContent = "Close";
      close.onclick = () => menu.remove();
      menu.append(close);
      root.append(menu);
    });
    this.graph.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = this.graph.getBoundingClientRect();
        this.zoom(Math.exp(-e.deltaY * 0.0015), {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        });
      },
      { passive: false },
    );
    root
      .querySelector('[aria-label="Zoom out"]')!
      .addEventListener("click", () => this.zoom(0.8));
    root
      .querySelector('[aria-label="Zoom in"]')!
      .addEventListener("click", () => this.zoom(1.25));
    root
      .querySelector('[aria-label="Fit diagram"]')!
      .addEventListener("click", () => this.fit());
    root
      .querySelector(".diagram-viewport")!
      .addEventListener("keydown", (e) => {
        const event = e as KeyboardEvent;
        if(this.editor&&this.placementKey(event))return;
        const shared=(event.target as Element).closest<SVGElement>("[data-shared-segment]");
        if(shared&&["Enter"," "].includes(event.key)){event.preventDefault();if(!this.stale)this.chooseBranch(Number(shared.dataset.sharedSegment),shared);return;}
        if (event.key === "Escape") {
          this.cancelGesture();
          this.tool = undefined;
          this.renderTools();
        }
        if(this.stale)return;
        if (
          (event.ctrlKey || event.metaKey) &&
          ["z", "y"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          if (event.key.toLowerCase() === "y" || event.shiftKey)
            callbacks.redo?.();
          else callbacks.undo();
        }

        const partId = (event.target as Element).closest<SVGElement>(
          "[data-label-part]",
        )?.dataset.labelPart;
        if (partId && ["Enter", " ", "F2"].includes(event.key)) {
          event.preventDefault();
          const selected = this.parts.get(partId);
          if (selected?.part.binding) {
            this.selectedPart = partId;
            this.callbacks.select(selected.part.binding, event.key === "Enter");
            if (event.key === "F2" && selected.part.editTool)
              this.activate(selected.part.editTool);
          }
          return;
        }
        if (event.key === "Enter" && this.selected) {
          const b = [...this.bindings.values()].find(
            (b) => b.elementId === this.selected,
          );
          if (b) callbacks.select(b, true);
        }
      });
    this.controls.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.controls.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-cancel]")) {
        this.tool = undefined;
        this.renderTools();
      }
    });
    this.resize = new ResizeObserver(() => {
      if (this.needsFit) this.fit(false);
      else this.transform();
    });
    this.resize.observe(this.graph);
    this.status(
      "Analyze model sources and open a view document to explore diagrams.",
    );
  }
  reset(presentation: Presentation) {
    this.discardPlacement();this.histories.clear();
    this.sequence++;
    this.cancelGesture();
    this.placing = undefined;
    this.response = undefined;
    this.layout = undefined;
    this.presentation = presentation;
    this.viewLayouts.clear();
    this.pendingArrangement = undefined;
    this.layoutPicker.disabled = true;
    this.tool = undefined;
    this.selected = undefined;
    this.viewList = [];
    this.views([]);
    this.graph.querySelector(".diagram-world")!.replaceChildren();
    this.paletteElement.replaceChildren();
    this.controls.hidden = true;
    this.status("Waiting for a clean model and its view usages…");
  }
  views(views: View[], current?: string) {
    this.viewList = views;
    this.root.querySelector("select")!.innerHTML = views.length
      ? views
          .map(
            (v) =>
              `<option value="${esc(v.key)}" ${v.key === current ? "selected" : ""}>${esc(v.name)}</option>`,
          )
          .join("")
      : "<option>No view documents</option>";
    if (!views.length) {
      this.requestView("");
      this.status("No view documents. Add a project .view.json document.");
    }
  }
  requestView(key: string) {
    if (this.response?.scene.view.key === key) return;
    this.sequence++;
    this.discardPlacement();
    this.cancelGesture();
    this.placing = undefined;
    this.response = undefined;
    this.layout = undefined;
    this.pendingArrangement = undefined;
    this.layoutPicker.disabled = true;
    this.tool = undefined;
    this.graph.querySelector(".diagram-world")!.replaceChildren();
    this.paletteElement.replaceChildren();
    this.controls.hidden = true;
    this.root.querySelector<HTMLElement>(".diagram-details")!.hidden = true;
    this.status("Loading view…");
  }
  /** Application/tree-drop entry point; exploration never edits model source. */
  setNotation(profile: NotationProfile) {
    validateNotation(profile);
    this.checkNotation(profile, this.response?.scene.nodes ?? []);
    this.notation = structuredClone(profile);
    this.renderTools();
    this.arrange(false);
  }
  private checkNotation(profile: NotationProfile, nodes: Node[]) {
    for (const n of nodes) {
      const shape =
        {
          ...(own(profile.shapes, n.notation) ??
            own(defaultNotation.shapes, n.notation) ??
            defaultNotation.shapes.usage),
          ...own(profile.styleClasses, n.styleClass)?.node,
        }.shape ?? "rounded";
      if (n.regions?.items.length && !["rectangle", "rounded"].includes(shape))
        throw new Error(
          "graph.notation.regions: partition owners require rectangle or rounded shapes",
        );
      this.checkNotation(profile, n.children);
      for (const r of n.regions?.items ?? [])
        this.checkNotation(profile, r.children);
    }
  }
  addSeed(element: string) {
    this.callbacks.scope?.({ op: "addSeed", element });
  }
  setScene(response: SceneResponse) {
    this.discardPlacement();
    if(this.response?.presentation.fingerprint!==response.presentation.fingerprint)this.histories.clear();
    this.targetSequence++;
    this.targetIds.clear();
    validateSceneResponse(response);
    const saved = graphPresentation(this.presentation, response.scene.view.key);
    if (saved && (saved.packageFingerprint !== response.presentation.fingerprint || saved.projection !== response.scene.ruleSet))
      throw Error("Saved layout package or projection changed; export or reset its layout");
    this.checkNotation(this.notation, response.scene.nodes);
    this.selectedPart = undefined;
    const changed = this.response?.scene.view.key !== response.scene.view.key;
    this.response = response;
    this.stale = false;
    this.tool = undefined;
    if (changed) {
      this.viewport = {
        ...(graphPresentation(this.presentation, response.scene.view.key)
          ?.viewport ?? {
          x: 0,
          y: 0,
          zoom: 1,
        }),
      };
      this.layout = undefined;
      this.needsFit = !own(this.presentation.views, response.scene.view.key);
    }
    this.root.querySelector(".diagram-kind")!.textContent =
      response.scene.view.kind;
    const details = this.root.querySelector<HTMLElement>(".diagram-details")!;
    details.hidden = !response.scene.view.details.length;
    details.innerHTML = response.scene.view.details
      .map(
        (d, i) =>
          `<button data-detail="${i}" title="Reveal declaration">${esc(d.label)} ↗</button>`,
      )
      .join("");
    this.views(this.viewList, response.scene.view.key);
    this.renderTools();
    this.status(response.scene.problems.join(" · "));
    this.arrange(false);
  }
  setStale() {
    this.discardPlacement();
    this.targetSequence++;
    this.targetIds.clear();
    this.paintTargets();
    this.pendingArrangement = undefined;
    this.stale = true;
    this.selectedPart = undefined;
    this.labelEnabled = false;
    this.cancelGesture();
    this.sequence++;
    this.renderTools();
    if (this.response)
      this.status(
        "Source changed · showing the last accepted model. Modeling tools resume after clean analysis.",
      );
  }
  setPresentation(value: Presentation) {
    this.discardPlacement();this.histories.clear();
    this.presentation = value;
    if (this.response) {
      const saved = graphPresentation(value, this.response.scene.view.key);
      if (saved) this.viewport = { ...saved.viewport };
      this.arrange(false);
    }
  }
  status(text: string) {
    this.message.textContent = text;
    this.message.hidden = !text;
  }
  setPaletteFiles(paths: string[], selected = "") {
    this.palettePaths = paths;
    this.palettePath = selected;
    this.renderTools();
  }
  private palettePaths: string[] = [];
  private palettePath = "";
  highlight(id: string | null) {
    this.selected = id ?? undefined;
    for (const el of this.graph.querySelectorAll<SVGElement>("[data-binding]"))
      el.classList.toggle(
        "diagram-selected",
        this.bindings.get(el.dataset.binding!)?.elementId === id,
      );
    for(const el of this.graph.querySelectorAll<SVGElement>("[data-shared-segment]")){
      const shared=this.layout?.routing?.sharedSegments[Number(el.dataset.sharedSegment)];
      el.classList.toggle("diagram-selected",!!shared?.members.some(member=>{
        const edge=this.response?.scene.edges.find(e=>e.id===member);
        return edge?.binding.elementId===id&&(!this.selectedEdge||this.selectedEdge===member);
      }));
    }
  }
  private state() {
    const key = this.response?.scene.view.key;
    if (!key) return;
    const saved = graphPresentation(this.presentation, key);
    if (saved) return saved;
    const created = {
      packageFingerprint: this.response!.presentation.fingerprint,
      projection: this.response!.scene.ruleSet,
      form: "graph" as const,
      positions: {} as Record<string, Geometry>,
      routeConstraints: {},
      labelPlacements: {},
      viewport: { ...this.viewport },
    };
    put(this.presentation.views, key, created);
    return created;
  }
  private persist() {
    const s = this.state();
    if (s) {
      s.viewport = { ...this.viewport };
      this.callbacks.presentation(structuredClone(this.presentation));
    }
  }
  private transform() {
    this.graph
      .querySelector(".diagram-world")!
      .setAttribute(
        "transform",
        `translate(${this.viewport.x},${this.viewport.y}) scale(${this.viewport.zoom})`,
      );
    this.root.querySelector(".diagram-zoom span")!.textContent =
      `${Math.round(this.viewport.zoom * 100)}%`;
  }
  private zoom(factor: number, at?: Point) {
    const r = this.graph.getBoundingClientRect(),
      p = at ?? { x: r.width / 2, y: r.height / 2 },
      z = Math.max(0.05, Math.min(4, this.viewport.zoom * factor));
    const ratio = z / this.viewport.zoom;
    this.viewport.x = p.x - (p.x - this.viewport.x) * ratio;
    this.viewport.y = p.y - (p.y - this.viewport.y) * ratio;
    this.viewport.zoom = z;
    this.transform();
    this.persist();
  }
  private fit(save = true) {
    if (!this.layout) return;
    const roots = this.response!.scene.nodes.map(
      (n) => this.layout!.nodes[n.id],
    ).filter(Boolean);
    if (!roots.length) return;
    const bounds=this.layout.routing?.extents;
    if(bounds)roots.push(bounds);
    const x = Math.min(...roots.map((g) => g.x)),
      y = Math.min(...roots.map((g) => g.y)),
      w = Math.max(...roots.map((g) => g.x + g.width)) - x,
      h = Math.max(...roots.map((g) => g.y + g.height)) - y,
      r = this.graph.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) return;
    const z = Math.max(
      0.05,
      Math.min(1.2, (r.width - 70) / w, (r.height - 70) / h),
    );
    this.viewport = {
      x: (r.width - w * z) / 2 - x * z,
      y: (r.height - h * z) / 2 - y * z,
      zoom: z,
    };
    this.needsFit = false;
    this.transform();
    if (save) this.persist();
  }
  private currentLayout(viewKey: string): AutoLayout {
    return this.viewLayouts.get(viewKey) ?? "layered";
  }
  private arrange(clear = true, choice?: AutoLayout) {
    if (!this.response || (clear && (this.stale || this.busy || this.editor))) return;
    if (this.readyWaiters.length) this.settled(new Error("Layout superseded"));
    this.readyState = "pending";
    const scene = this.response.scene;
    const autoLayout = choice ?? this.currentLayout(scene.view.key);
    const id = ++this.sequence;
    let presentation = this.previewPresentation();
    this.pendingArrangement = clear ? { sequence: id, choice: autoLayout } : undefined;
    if (clear) {
      presentation = structuredClone(presentation);
      const saved = graphPresentation(presentation, scene.view.key);
      if (saved) saved.positions = {};
      this.status("Arranging diagram…");
    }
    this.stale = true;
    this.targetSequence++;
    this.targetIds.clear();
    this.paintTargets();
    this.renderTools();
    this.worker.postMessage({
      id,
      scene,
      context: this.response.presentation,
      notation: this.notation,
      presentation,
      autoLayout,
    });
  }
  private renderTools() {
    this.renderPlacementTools();
    const response = this.response;
    this.layoutPicker.disabled = !response || this.busy || this.stale || !!this.editor;
    this.layoutPicker.value = response
      ? this.pendingArrangement?.choice ?? this.currentLayout(response.scene.view.key)
      : "layered";
    if (!response) return;
    this.paletteElement.innerHTML = `<label class="palette-heading">PALETTE<select data-palette-file aria-label="Palette definition"><option value="">Standard structure</option>${this.palettePaths.map((path) => `<option value="${esc(path)}" ${path === this.palettePath ? "selected" : ""}>${esc(path)}</option>`).join("")}</select></label>${response.scene.palette.groups
      .map(
        (g) =>
          `<section><h4>${esc(g.label)}</h4>${g.entries
            .map((t) => {
              const cap = response.capabilities.find((c) => c.toolId === t.id),
                disabled =
                  this.busy ||
                  !cap?.enabled ||
                  (this.stale && !t.command.startsWith("presentation."));
              return `<button type="button" data-tool="${esc(t.id)}" draggable="${!disabled && t.gesture === "place" && this.placement(t) !== "connection"}" class="palette-tool ${this.tool?.id === t.id ? "active" : ""}" ${disabled ? "disabled" : ""} title="${esc(cap?.reason || t.label)}"><span class="palette-glyph" aria-hidden="true">${esc(own(this.notation.icons, t.icon) ?? own(glyph, t.icon) ?? "◇")}</span>${esc(t.label)}</button>`;
            })
            .join("")}</section>`,
      )
      .join("")}`;
    this.controls.hidden = !this.tool;
    if (this.tool) {
      this.controls.innerHTML = `<strong>${esc(this.tool.label)}</strong><label>Owner<select name="owner">${response.scene.view.owners.map((o) => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join("")}</select></label>${(this.tool.inputs ?? []).map((i) => `<label>${esc(i.label)}<input name="arg:${esc(i.id)}" aria-label="${esc(i.label)}" value="${esc(i.default)}" required maxlength="128" autocomplete="off"/></label>`).join("")}<button type="submit" ${this.stale || this.busy ? "disabled" : ""}>Create</button><button type="button" data-cancel>Cancel</button><span>Drag from the palette or click the canvas to place. Drag a connection between parts or ports.</span>`;
    }
    if (this.tool?.gesture === "action") {
      const target = this.selectedPart
        ? this.parts.get(this.selectedPart)
        : undefined;
      this.controls.innerHTML = `<strong>${esc(this.tool.label)}</strong><span>${esc(target?.part.text || "Choose an editable label part")}</span>${(this.tool.inputs ?? []).map((i) => `<label>${esc(i.label)}<input name="arg:${esc(i.id)}" aria-label="${esc(i.label)}" value="${esc(i.default)}" maxlength="4096"/></label>`).join("")}<button type="submit" ${!this.labelEnabled || this.stale || this.busy ? "disabled" : ""}>Apply</button><button type="button" data-cancel>Cancel</button>`;
    }
    this.root.classList.toggle(
      "placing",
      !!this.tool && this.tool.gesture !== "action",
    );
    if (!this.tool) {
      this.targetSequence++;
      this.targetIds.clear();
    }
    this.paintTargets();
    const hint = this.root.querySelector<HTMLElement>(".diagram-hint")!;
    hint.textContent = this.tool
      ? this.placement(this.tool) === "connection"
        ? "Drag from a part or port to another endpoint · Escape cancels"
        : this.placement(this.tool) === "border"
          ? "Drop on a part border · Escape cancels"
          : "Drop on the canvas or inside a part · Escape cancels"
      : "Drag symbols to arrange · drag ports along borders · drag background to pan · scroll to zoom";
  }
  private activate(id: string) {
    const tool = this.response?.scene.palette.groups
      .flatMap((g) => g.entries)
      .find((t) => t.id === id);
    if (!tool) return;
    if (tool.command === "presentation.fit") {
      this.fit();
      return;
    }
    if (tool.command === "presentation.layout") {
      this.arrange();
      return;
    }
    if (tool.gesture === "select") {
      this.tool = undefined;
      void this.updateTargets();
      this.renderTools();
      return;
    }
    this.cancelGesture();
    this.tool = tool;
    this.labelEnabled = false;
    this.renderTools();
    if (tool.gesture === "action") void this.updateLabelTarget();
    else void this.updateTargets();
    this.controls.querySelector("input")?.focus();
  }
  private async submit() {
    if (!this.tool || this.stale || this.busy) return;
    const form = new FormData(this.controls as HTMLFormElement),
      args: Record<string, string> = {};
    for (const [key, value] of form)
      if (key.startsWith("arg:")) args[key.slice(4)] = String(value);
    const tool = this.tool;
    const label =
      tool.gesture === "action" && this.selectedPart
        ? this.parts.get(this.selectedPart)
        : undefined;
    if (tool.gesture === "action" && (!label || !this.labelEnabled)) return;
    const owner = label?.binding.key ?? String(form.get("owner") ?? "");
    if (label) args.part = label.part.id;
    this.busy = true;
    this.renderTools();
    try {
      await this.callbacks.command(tool, owner, args);
      this.tool = undefined;
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
      this.renderTools();
    }
  }
  private bindingAt(target: EventTarget | null) {
    if(this.stale)return undefined;
    const part = (target as Element)?.closest<SVGElement>("[data-label-part]")
      ?.dataset.labelPart;
    if (part) return this.parts.get(part)?.part.binding ?? undefined;
    const el = (target as Element)?.closest<SVGElement>("[data-binding]");
    return el ? this.bindings.get(el.dataset.binding!) : undefined;
  }
  private pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (this.busy || this.stale) return;
    if(this.editor){this.placementPointer(e);return;}
    this.selectedEdge=(e.target as Element).closest<SVGElement>("[data-edge]")?.dataset.edge;
    this.selectedBlock=(e.target as Element).closest<SVGElement>("[data-bound-label-block]")?.dataset.boundLabelBlock;
    this.renderPlacementTools();
    const shared=(e.target as Element).closest<SVGElement>("[data-shared-segment]");
    if(shared){this.chooseBranch(Number(shared.dataset.sharedSegment),shared);return;}
    const part = (e.target as Element).closest<SVGElement>("[data-label-part]")
      ?.dataset.labelPart;
    const region = (e.target as Element).closest<SVGElement>("[data-region]");
    if (part) {
      this.selectedPart = part;
      if (this.tool?.gesture === "action") {
        this.labelEnabled = false;
        this.renderTools();
        void this.updateLabelTarget();
      }
      const b = this.parts.get(part)?.part.binding;
      if (b) {
        this.clickBinding = b;
        this.highlight(b.elementId);
        this.callbacks.select(b, false);
      }
      return;
    }
    if (
      region &&
      !(e.target as Element)
        .closest("[data-symbol]")
        ?.isSameNode(region.closest("[data-symbol]"))
    ) {
      /* a child node remains draggable */
    } else if (region) {
      const r = this.regions.get(region.dataset.region!);
      if (r) {
        this.clickBinding = r.binding;
        this.callbacks.select(r.binding, false);
      }
      return;
    }
    const world = this.worldPoint(e.clientX, e.clientY);
    const endpoint = this.endpointAt(e.clientX, e.clientY);
    if (this.tool?.gesture === "action") return;
    if (this.tool && !this.stale) {
      if (this.placement(this.tool) === "connection") {
        if (!endpoint) {
          this.status("Start the connection on a part or port.");
          return;
        }
        if (!this.legal(endpoint)) {
          this.status("This source does not pass the applicability predicate.");
          return;
        }
        this.connection = {
          source: endpoint,
          start: this.anchor(endpoint, world),
          current: world,
          pointer: e.pointerId,
        };
        this.graph.setPointerCapture(e.pointerId);
        this.previewConnection();
        void this.updateTargets(endpoint);
      } else void this.place(e.clientX, e.clientY);
      return;
    }
    const handle = (e.target as Element).closest<SVGElement>("[data-resize]");
    if (handle && this.layout) {
      const id = handle.dataset.resize!,
        g = this.layout.nodes[id];
      this.resizeDrag = { id, start: world, width: g.width, height: g.height };
      this.graph.setPointerCapture(e.pointerId);
      return;
    }
    const port = (e.target as Element).closest<SVGElement>("[data-port]")
      ?.dataset.port;
    if (port) {
      this.portDrag = {
        id: port,
        owner: this.portOwners.get(port)!,
        moved: false,
      };
      this.graph.setPointerCapture(e.pointerId);
    }
    const binding = this.bindingAt(e.target);
    // Pointer capture retargets the subsequent double-click to the SVG root.
    this.clickBinding = binding;
    if (binding) {
      this.highlight(binding.elementId);
      this.callbacks.select(binding, false);
    }
    if (port) return;

    const symbol = (e.target as Element).closest<SVGElement>("[data-symbol]")
      ?.dataset.symbol;
    const g = symbol ? this.layout?.nodes[symbol] : undefined;
    this.drag = {
      id: g ? symbol : undefined,
      start: { x: e.clientX, y: e.clientY },
      origin: g
        ? { x: g.x, y: g.y }
        : { x: this.viewport.x, y: this.viewport.y },
      moved: false,
    };
    this.graph.setPointerCapture(e.pointerId);
    this.root.querySelector<HTMLElement>(".diagram-viewport")!.focus();
  }
  private pointerMove(e: PointerEvent) {
    if(this.placementDrag){this.movePlacement(e);return;}
    const point = this.worldPoint(e.clientX, e.clientY);
    if (this.connection) {
      const endpoint = this.endpointAt(e.clientX, e.clientY);
      this.connection.current = endpoint ? this.anchor(endpoint, point) : point;
      this.previewConnection();
      this.dropFeedback(e.clientX, e.clientY);
      return;
    }
    if (this.portDrag) {
      const owner = this.absolute.get(this.portDrag.owner);
      if (owner) {
        const p = this.borderPoint(point, owner);
        put(this.state()!.positions, this.portDrag.id, {
          x: p.x,
          y: p.y,
          width: 12,
          height: 12,
        });
        this.portDrag.moved = true;
        this.arrange(false);
      }
      return;
    }
    if (this.resizeDrag && this.layout) {
      const drag = this.resizeDrag,
        g = this.layout.nodes[drag.id];
      const min = this.layout.minimum[drag.id] ?? { width: 150, height: 70 };
      const region = this.regionParent(drag.id),
        bounds = region ? this.layout.regions[region.id] : undefined;
      g.width = Math.min(
        bounds ? bounds.width - 40 : Infinity,
        Math.max(min.width, drag.width + point.x - drag.start.x),
      );
      g.height = Math.min(
        bounds ? bounds.height - 62 : Infinity,
        Math.max(min.height, drag.height + point.y - drag.start.y),
      );
      const node = this.node(drag.id);
      if (node) this.retile(node, g);
      put(this.state()!.positions,drag.id,{...g});
      this.arrange(false);
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const dx = e.clientX - drag.start.x,
      dy = e.clientY - drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !drag.moved) return;
    drag.moved = true;
    if (drag.id && this.layout) {
      const g = this.layout.nodes[drag.id];
      g.x = drag.origin.x + dx / this.viewport.zoom;
      g.y = drag.origin.y + dy / this.viewport.zoom;
      const region = this.regionParent(drag.id),
        bounds = region ? this.layout.regions[region.id] : undefined;
      if (bounds) {
        g.x = Math.max(20, Math.min(bounds.width - g.width - 20, g.x));
        g.y = Math.max(42, Math.min(bounds.height - g.height - 20, g.y));
      }
      put(this.state()!.positions,drag.id,{...g});
      this.arrange(false);
    } else {
      this.viewport.x = drag.origin.x + dx;
      this.viewport.y = drag.origin.y + dy;
      this.transform();
    }
  }
  private pointerUp(e: PointerEvent) {
    if(this.placementDrag){this.placementDrag=undefined;if(this.graph.hasPointerCapture(e.pointerId))this.graph.releasePointerCapture(e.pointerId);return;}
    if (this.graph.hasPointerCapture(e.pointerId))
      this.graph.releasePointerCapture(e.pointerId);
    if (this.connection) {
      const source = this.connection.source,
        target = this.endpointAt(e.clientX, e.clientY);
      this.connection = undefined;
      this.previewConnection();
      this.clearFeedback();
      if (target && target !== source && this.legal(target))
        void this.connect(source, target);
      else if (target && !this.legal(target)) {
        this.status("This target does not pass the applicability predicate.");
        void this.updateTargets();
      } else this.status("Choose a different part or port as the target.");
      return;
    }
    if (this.portDrag) {
      const moved = this.portDrag.moved;
      this.portDrag = undefined;
      if (moved) this.persist();
      return;
    }
    if (this.resizeDrag && this.layout) {
      // Pointer movement already saved the latest requested allocation. A worker
      // reply may still describe an earlier frame and cannot replace that intent.
      this.resizeDrag = undefined;
      // Keep untouched root placements stable when recomposing partition bounds.
      const state = this.state();
      if (state && this.response)
        for (const root of this.response.scene.nodes) {
          if (!own(state.positions, root.id))
            put(state.positions, root.id, { ...this.layout.nodes[root.id] });
        }
      this.persist();
      this.arrange(false);
      return;
    }
    const drag = this.drag;
    this.drag = undefined;
    if (this.graph.hasPointerCapture(e.pointerId))
      this.graph.releasePointerCapture(e.pointerId);
    if (drag?.moved) {
      this.persist();
    }
  }
  private draw() {
    if (!this.response || !this.layout) return;
    const definitions = new GraphicDefinitions(this.response.presentation.libraries);
    const labelPlacements=graphPresentation(this.previewPresentation(),this.response.scene.view.key)?.labelPlacements??{};
    const textContext = document.createElement("canvas").getContext("2d");
    const measureGraphic = (s: string, size: number, weight: number, italic: boolean) => {
      if (textContext) textContext.font = `${italic ? "italic " : ""}${weight} ${size}px system-ui`;
      return textContext?.measureText(s).width ?? s.length * size * .65;
    };
    let graphicalParts = 0, graphicalCommands = 0;
    const register = (drawing: GraphicDrawing) => {
      graphicalParts += drawing.parts; graphicalCommands += drawing.commands;
      if (graphicalParts > 50_000 || graphicalCommands > 65_536) throw Error("Scene graphical rendering budget exceeded");
      for (const f of drawing.fragments) this.parts.set(f.part.id, { part: f.part, owner: f.owner, binding: f.binding, slot: f.slot });
      return drawing.markup;
    };
    this.bindings.clear();
    this.parts.clear();
    this.regions.clear();
    this.absolute.clear();
    this.portOwners.clear();
    this.connectionDirections.clear();
    const bind = (b: Binding) => {
      const id = `b${this.bindings.size}`;
      this.bindings.set(id, b);
      return `data-binding="${id}"`;
    };
    const label = (
      value: Label,
      owner: string,
      binding: Binding,
      slot: string,
      x: number,
      y: number,
      center = false,
      cls = "",
    ): string => {
      const blockId=logicalId("label",[owner,slot]),placement=own(labelPlacements,blockId);
      if(slot==="edge.label"){
        const frame=this.layout!.routing!.labelFrames[blockId];
        if(frame){
          const drawing=edgeLabelLayout({id:owner,binding,label:value},measureGraphic);
          for(const f of drawing.fragments)this.parts.set(f.part.id,{part:f.part,owner:f.owner,binding:f.binding,slot:f.slot});
          return `<g class="${cls}" data-bound-label-block="${blockId}" transform="translate(${frame.box.x},${frame.box.y})">${drawing.markup}</g>`;
        }
      }else if(placement){if(placement.kind!=="owner")throw Error("Invalid owner label placement");x+=placement.dx;y+=placement.dy;}
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      if (ctx) ctx.font = "600 14px system-ui";
      const widths = value.parts.map((p) =>
        Math.max(6, ctx?.measureText(p.text).width ?? p.text.length * 9),
      );
      let left = center ? x - widths.reduce((a, b) => a + b, 0) / 2 : x;
      return `<g class="${cls}" data-bound-label-block="${blockId}">${value.parts
        .map((p, i) => {
          this.parts.set(p.id, {
            part: p,
            owner,
            binding,
            slot,
          });
          const markup = `<g class="diagram-label-part" data-label-part="${esc(p.id)}" ${p.binding ? bind(p.binding) : ""} ${p.binding ? `tabindex="0" role="button" aria-label="${esc(p.text || slot)}"` : ""}><rect class="label-hit" x="${left}" y="${y - 14}" width="${widths[i]}" height="19"/><text xml:space="preserve" x="${left}" y="${y}">${esc(p.text)}</text></g>`;
          left += widths[i];
          return markup;
        })
        .join("")}</g>`;
    };
    const render = (n: Node, offset: Point): string => {
      const g = this.layout!.nodes[n.id];
      if (!g) return "";
      // The worker has measured, packed and routed this complete frame. Paint
      // must not move its children or resize bodies after attachment was solved.
      const drawing=n.graphic?drawGraphic(definitions,n.graphic,n,g.width,measureGraphic,contentBoxes(n,this.layout!),g.height,labelPlacements):undefined;
      const a = { ...g, x: g.x + offset.x, y: g.y + offset.y };
      this.absolute.set(n.id, a);
      const style = {
        ...(own(this.notation.shapes, n.notation) ??
          own(defaultNotation.shapes, n.notation) ??
          defaultNotation.shapes.usage),
        ...own(this.notation.styleClasses, n.styleClass)?.node,
      };
      const body = drawing ? "" : builtinBody(style,g.width,g.height,n.id);
      let y = 66;
      const compartments = n.compartments
        .map((c) => {
          let html = `<path class="compartment-rule" d="M0 ${y - 12} H${g.width}"/><text class="compartment-label" x="14" y="${y + 2}">${esc(c.label)}</text>`;
          y += 23;
          for (const row of c.rows) {
            html += `<g class="diagram-field" ${bind(row.binding)}><rect x="1" y="${y - 14}" width="${g.width - 2}" height="20"/>${label(row.label, row.id, row.binding, "row.label", 14, y)}<title>${esc(row.label)}</title></g>`;
            y += 20;
          }
          return html;
        })
        .join("");
      const ports = n.ports
        .map((p, i) => {
          const old = this.layout!.ports[p.id];
          let point = old
            ? { ...old }
            : { x: a.x + g.width, y: a.y + 65 + i * 28 };
          // ELK stores absolute port centers. Translate them with their owning node.
          const base = this.portBase.get(p.id);
          if (base)
            point = {
              x: base.x + (a.x - base.ownerX),
              y: base.y + (a.y - base.ownerY),
            };
          else {
            this.portBase.set(p.id, { ...point, ownerX: a.x, ownerY: a.y });
          }
          const saved = own(
            graphPresentation(this.presentation, this.response!.scene.view.key)
              ?.positions,
            p.id,
          );
          if (saved) {
            const local = this.borderPoint(
              { x: a.x + saved.x, y: a.y + saved.y },
              a,
            );
            point = { x: a.x + local.x, y: a.y + local.y };
          }
          this.absolute.set(p.id, { ...point, width: 0, height: 0 });
          this.portOwners.set(p.id, n.id);
          const x = point.x - a.x,
            y = point.y - a.y,
            west = x < g.width / 2;
          if (p.graphic) {
            const drawing = drawGraphic(definitions, p.graphic, p, 16, measureGraphic,{},undefined,labelPlacements);
            const definition = definitions.definition(p.graphic.definition), anchor = definition.connectionAnchor ? drawing.anchors[definition.connectionAnchor] : { x: drawing.width / 2, y: drawing.height / 2 };
            if("dx" in anchor && "dy" in anchor) this.connectionDirections.set(p.id,{x:anchor.dx as number,y:anchor.dy as number});
            return `<g class="diagram-port" data-port="${esc(p.id)}" ${bind(p.binding)} transform="translate(${x - anchor.x},${y - anchor.y})">${register(drawing)}<title>${esc(labelText(p.label))}</title></g>`;
          }
          return `<g class="diagram-port" data-port="${esc(p.id)}" ${bind(p.binding)}><rect x="${x - 6}" y="${y - 6}" width="12" height="12"/>${label(p.label, p.id, p.binding, "port.label", west ? x + 12 : x - 12 - labelText(p.label).length * 8, y - 10)}<title>${esc(p.label)}</title></g>`;
        })
        .join("");
      const regionMarkup = (n.regions?.items ?? [])
        .map((r) => {
          this.regions.set(r.id, r);
          const g = this.layout!.regions[r.id];
          if (!g) return "";
          const parent = { x: a.x + g.x, y: a.y + g.y };
          this.absolute.set(r.id,{...g,...parent});
          return `<g class="diagram-region" data-region="${esc(r.id)}" transform="translate(${g.x},${g.y})" ${bind(r.binding)}><rect width="${g.width}" height="${g.height}" style="fill:${color(style.fill)};stroke:${color(style.stroke)}"/><path class="compartment-rule" d="M0 30 H${g.width}"/>${label(r.label, r.id, r.binding, "region.label", 12, 21, false, "region-label")}${r.children.map((c) => render(c, parent)).join("")}</g>`;
        })
        .join("");
      return `<g class="diagram-node fill-${esc(style.fill)}" data-symbol="${esc(n.id)}" transform="translate(${g.x},${g.y})" ${bind(n.binding)}>${drawing ? register(drawing) : body + label(n.subtitle, n.id, n.binding, "node.subtitle", g.width / 2, 20, true, "node-subtitle") + label(n.title, n.id, n.binding, "node.title", g.width / 2, 40, true, "node-title") + compartments}${n.children.map((c) => render(c, a)).join("")}${regionMarkup}${ports}<rect class="node-resize" data-resize="${esc(n.id)}" x="${g.width - 5}" y="${g.height - 5}" width="9" height="9"/><title>${esc(labelText(n.title))} · Double click to reveal source</title></g>`;
    };
    // A new layout invalidates the initial absolute-port cache.
    if (this.portLayout !== this.layout) {
      this.portBase.clear();
      this.portLayout = this.layout;
    }
    const nodes = this.response.scene.nodes
      .map((n) => render(n, { x: 0, y: 0 }))
      .join("");
    const proxies=this.response.scene.endpointProxies.map(proxy=>{
      const at=this.layout!.ports[proxy.id];if(!at)throw Error("Missing routed proxy position");
      this.absolute.set(proxy.id,{...at,width:0,height:0});
      return `<g class="diagram-proxy" data-endpoint-proxy="${esc(proxy.id)}" ${bind(proxy.binding)} tabindex="0" role="button" aria-label="Collapsed endpoint ${esc(labelText(proxy.label)||proxy.binding.key)}"><path d="M${at.x-6} ${at.y} L${at.x} ${at.y-6} L${at.x+6} ${at.y} L${at.x} ${at.y+6} Z"/><title>${esc(labelText(proxy.label)||proxy.binding.key)} · hidden endpoint</title></g>`;
    }).join("");
    const edges = this.response.scene.edges
      .map((edge) => {
        const points=this.layout!.edges[edge.id];
        if(!points || points.length<2)throw Error("Missing worker route");
        const a=points[0],b=points.at(-1)!,frame=routeFrame(points,.5),mid=frame.x;
        const edgeStyle = {
          line: "solid",
          stroke: "neutral",
          startMarker: "none",
          endMarker: edge.notation === "specialization" ? "triangle" : "none",
          ...own(this.notation.edges, edge.notation),
          ...own(this.notation.styleClasses, edge.styleClass)?.edge,
        };
        const sharedDecoration=(side:"start"|"end")=>{
          const at=side==="start"?a:b,index=this.layout!.routing!.sharedSegments.findIndex(segment=>segment.members.includes(edge.id)&&((segment.from.x===at.x&&segment.from.y===at.y)||(segment.to.x===at.x&&segment.to.y===at.y)));
          return index<0?"":` data-shared-segment="${index}" tabindex="0" role="button" aria-label="Choose one of ${this.layout!.routing!.sharedSegments[index].members.length} branches"`;
        };
        const legacyMarker=(side:"start"|"end",value:string)=>{
          if(edge[side==="start"?"startMarker":"endMarker"]||value==="none")return "";
          const at=side==="start"?a:b,other=side==="start"?points[1]:points.at(-2)!,length=Math.hypot(at.x-other.x,at.y-other.y),near={x:at.x+(other.x-at.x)/length*.001,y:at.y+(other.y-at.y)/length*.001},from=side==="start"?at:near,to=side==="start"?near:at;
          const marker=legacyMarkerLayout(points,side),box=marker.box;
          return `<g data-legacy-edge-marker="${side}"${sharedDecoration(side)}><rect transform="matrix(${marker.matrix.join(" ")})" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" style="fill:transparent;stroke:none;pointer-events:all"/><path d="M${from.x} ${from.y} L${to.x} ${to.y}" style="fill:none;stroke:${color(edgeStyle.stroke)};stroke-width:1.4" marker-${side}="url(#diagram-${value})"/></g>`;
        };
        const customMarker = (side: "start" | "end") => {
          const marker=edgeMarkerLayout(definitions,edge,side,points,measureGraphic,labelPlacements);if(!marker)return "";
          return `<g data-edge-marker="${side}"${sharedDecoration(side)} transform="matrix(${marker.matrix.join(" ")})">${register(marker.drawing)}</g>`;
        };
        const route=points.map((p,i)=>`${i?"L":"M"}${p.x} ${p.y}`).join(" ");
        const unshared=this.layout!.routing!.paths[edge.id].segments.filter(s=>!this.layout!.routing!.sharedSegments.some(g=>g.members.includes(edge.id)&&g.from.x===s.from.x&&g.from.y===s.from.y&&g.to.x===s.to.x&&g.to.y===s.to.y)).map(s=>`M${s.from.x} ${s.from.y} L${s.to.x} ${s.to.y}`).join(" ");
        return `<g class="diagram-edge" data-edge="${esc(edge.id)}" ${bind(edge.binding)}><path class="edge-hit" d="${route}"/><path class="edge-line" d="${unshared}" style="stroke:${color(edgeStyle.stroke)};stroke-dasharray:${edgeStyle.line === "dashed" ? "8 5" : edgeStyle.line === "dotted" ? "2 4" : "none"}" />${legacyMarker("start",edgeStyle.startMarker)}${legacyMarker("end",edgeStyle.endMarker)}${customMarker("start")}${customMarker("end")}${label(edge.label, edge.id, edge.binding, "edge.label", frame.x + 6, frame.y - 7)}<title>${esc(labelText(edge.label) || edge.notation)}</title></g>`;
      })
      .join("");
    const shared=this.layout.routing!.sharedSegments.map((segment,index)=>{
      const edge=this.response!.scene.edges.find(e=>e.id===segment.members[0])!;
      const style={line:"solid",stroke:"neutral",...own(this.notation.edges,edge.notation),...own(this.notation.styleClasses,edge.styleClass)?.edge};
      const path=`M${segment.from.x} ${segment.from.y} L${segment.to.x} ${segment.to.y}`;
      return `<g class="diagram-shared-segment" data-shared-segment="${index}" tabindex="0" role="button" aria-label="Choose one of ${segment.members.length} branches"><path class="edge-line" d="${path}" style="stroke:${color(style.stroke)};stroke-dasharray:${style.line === "dashed" ? "8 5" : style.line === "dotted" ? "2 4" : "none"}"/><path class="edge-hit" d="${path}"/></g>`;
    }).join("");
    // Connections sit above containers, whose fill would otherwise hide them.
    if (nodes.length + edges.length > 16 * 1024 * 1024) throw Error("Graphical markup budget exceeded");
    const viewport=this.root.querySelector<HTMLElement>(".diagram-viewport")!,restoreFocus=!!this.editor&&viewport.contains(document.activeElement);
    this.graph.querySelector(".diagram-world")!.innerHTML = nodes + edges + shared + proxies + this.placementMarkup();
    if(restoreFocus)viewport.focus();
    this.transform();
    this.highlight(this.selected ?? null);
    this.paintTargets();
  }
  private chooseBranch(index:number,origin:SVGElement) {
    const segment=this.layout?.routing?.sharedSegments[index];if(!segment||!this.response||this.stale)return;
    this.root.querySelector(".diagram-branch-picker")?.remove();
    const generation=this.sequence,response=this.response;
    this.selectedEdge=undefined;this.selectedBlock=undefined;this.selectedPart=undefined;this.clickBinding=undefined;this.labelEnabled=false;this.tool=undefined;this.cancelGesture();this.renderTools();
    const dialog=document.createElement("div");dialog.className="diagram-branch-picker";dialog.role="dialog";
    dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-label","Choose a branch");
    const heading=document.createElement("strong");heading.textContent="Choose a branch";dialog.append(heading);
    const close=()=>{dialog.remove();origin.focus();};
    for(const id of segment.members){
      const edge=this.response.scene.edges.find(e=>e.id===id);if(!edge)throw Error("Missing shared branch");
      const button=document.createElement("button");
      button.textContent=`${labelText(edge.label)||edge.binding.key} · ${edge.binding.context.join(" / ")||"root"} · ${edge.id}`;
      button.onclick=()=>{if(!this.stale&&this.sequence===generation&&this.response===response){this.selectedEdge=edge.id;this.clickBinding=edge.binding;this.highlight(edge.binding.elementId);this.callbacks.select(edge.binding,false);this.renderPlacementTools();}close();};dialog.append(button);
    }
    const cancel=document.createElement("button");cancel.textContent="Cancel";cancel.onclick=close;dialog.append(cancel);
    dialog.onkeydown=e=>{if(e.key==="Escape"){e.preventDefault();close();}if(e.key==="Tab"){const buttons=[...dialog.querySelectorAll("button")],current=buttons.indexOf(document.activeElement as HTMLButtonElement);e.preventDefault();buttons[(current+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}};
    this.root.append(dialog);dialog.querySelector("button")!.focus();
  }
  private previewPresentation():Presentation {
    if(!this.editor||!this.response)return this.presentation;
    const result=structuredClone(this.presentation),key=this.response.scene.view.key,view=graphPresentation(result,key)??this.placementBase;
    if(!view)throw Error("Missing placement view");put(result.views,key,this.editor.preview(view));return result;
  }
  private placementView(){
    if(!this.response)return undefined;
    const saved=graphPresentation(this.presentation,this.response.scene.view.key);if(saved)return saved;
    return this.placementBase??={form:"graph",packageFingerprint:this.response.presentation.fingerprint,projection:this.response.scene.ruleSet,positions:{},routeConstraints:{},labelPlacements:{},viewport:{...this.viewport}};
  }
  private history(view=this.placementView()) {
    const key=this.response?.scene.view.key;if(!view||!key)throw Error("No active placement view");
    let history=this.histories.get(key);if(!history){history=new PresentationHistory(view);this.histories.set(key,history);}return history;
  }
  private discardPlacement(){this.editor?.cancel();this.editor=undefined;this.placementBase=undefined;this.placementDrag=undefined;}
  private placementAction(action?:string) {
    const view=this.placementView();if(!view)return;
    if(action==="cancel"){this.discardPlacement();this.cancelGesture();this.arrange(false);return;}
    if(action==="undo"||action==="redo"){
      this.discardPlacement();const history=this.history();action==="undo"?history.undo(view):history.redo(view);this.persist();this.arrange(false);return;
    }
    if(action==="accept"){
      if(this.stale||this.readyState!=="ready")throw Error("Accept a placement only after its preview succeeds");
      this.editor?.accept(view,this.history(view));put(this.presentation.views,this.response!.scene.view.key,view);this.editor=undefined;this.placementBase=undefined;this.persist();this.arrange(false);return;
    }
    if(action==="reset"&&this.editor){this.editor.reset(view);this.arrange(false);return;}
    if(this.stale||this.readyState!=="ready")return;
    this.discardPlacement();this.placementBase=graphPresentation(this.presentation,this.response!.scene.view.key)?undefined:view;this.tool=undefined;
    if(action==="route"&&this.selectedEdge){
      const path=own(this.layout?.routing?.paths,this.selectedEdge);if(!path)throw Error("Selected edge is unavailable");
      this.editor=new PlacementEditor(view,{kind:"route",id:this.selectedEdge,frame:path.frame});this.placementIndex=0;
    }else if(action==="label"&&this.selectedBlock){
      const frame=own(this.layout?.routing?.labelFrames,this.selectedBlock);if(!frame)throw Error("Selected text block is unavailable");
      this.editor=new PlacementEditor(view,{kind:"label",id:this.selectedBlock,frame:frame.kind});
    }
    this.draw();this.renderPlacementTools();this.root.querySelector<HTMLElement>(".diagram-viewport")!.focus();
    if(this.editor)this.status(`${this.editor.mode.kind==="route"?"Edit route: choose a bend or segment handle":"Move label"} · arrows move 1, Shift 10 · Enter accepts · Escape cancels`);
  }
  private renderPlacementTools(){
    const ready=!this.stale&&this.readyState==="ready",editing=!!this.editor,history=this.response?this.histories.get(this.response.scene.view.key):undefined;
    for(const button of this.root.querySelectorAll<HTMLButtonElement>("[data-placement]")){
      const action=button.dataset.placement;
      button.disabled=action==="cancel"?!editing:action==="accept"?!editing||!ready:action==="reset"?!editing:action==="route"?!ready||!this.selectedEdge:action==="label"?!ready||!this.selectedBlock:action==="undo"?!history?.canUndo:action==="redo"?!history?.canRedo:false;
    }
  }
  private routeOrigin(frame:string):Point {
    if(frame===ROOT_ROUTE_FRAME)return {x:0,y:0};const at=this.absolute.get(frame);if(!at)throw Error("Manual route frame is unavailable; expand or reset its route");return at;
  }
  private placementMarkup():string {
    if(!this.editor||!this.layout?.routing)return "";
    const mode=this.editor.mode;
    if(mode.kind==="label"){
      const frame=own(this.layout.routing.labelFrames,mode.id);if(!frame)return "";const b=frame.box;
      return `<rect data-placement-label="${esc(mode.id)}" class="placement-label-handle" x="${b.x-3}" y="${b.y-3}" width="${Math.max(8,b.width+6)}" height="${Math.max(8,b.height+6)}" tabindex="0" role="button" aria-label="Move this bound text block"/>`;
    }
    const origin=this.routeOrigin(mode.frame),points=this.editor.route?.waypoints??[],path=this.layout.routing.paths[mode.id];
    const handles=points.map((p,i)=>`<circle data-route-waypoint="${i}" class="placement-route-handle" cx="${p.x+origin.x}" cy="${p.y+origin.y}" r="6" tabindex="0" role="button" aria-label="Manual bend ${i+1}"/>`).join("");
    const segments=path.segments.slice(1,-1).map((s,i)=>`<rect data-route-add="${i+1}" class="placement-segment-handle" x="${(s.from.x+s.to.x)/2-4}" y="${(s.from.y+s.to.y)/2-4}" width="8" height="8" tabindex="0" role="button" aria-label="Move route segment ${i+1}"/>`).join("");
    return segments+handles;
  }
  private currentLabelPlacement():LabelPlacement {
    const editor=this.editor!;
    if(editor.label)return editor.label;
    if(editor.mode.kind!=="label")throw Error("Label mode is unavailable");
    if(editor.mode.frame==="owner")return {kind:"owner",dx:0,dy:0};
    const frame=this.layout!.routing!.labelFrames[editor.mode.id],[tx,ty,,,x,y]=frame.frame,dx=frame.box.x-x,dy=frame.box.y+14-y;
    return {kind:"route",fraction:.5,tangentOffset:dx*tx+dy*ty,normalOffset:-dx*ty+dy*tx};
  }
  private placementPointer(event:PointerEvent) {
    const editor=this.editor,view=this.placementView();if(!editor||!view)return;
    const start=this.worldPoint(event.clientX,event.clientY),mode=editor.mode;
    if(mode.kind==="route"){
      const vertex=(event.target as Element).closest<SVGElement>("[data-route-waypoint]"),segment=(event.target as Element).closest<SVGElement>("[data-route-add]");
      if(!vertex&&!segment)return;
      const points=editor.route?.waypoints??[];
      if(vertex)this.placementIndex=Number(vertex.dataset.routeWaypoint);
      else {
        const path=this.layout!.routing!.paths[mode.id],s=path.segments[Number(segment!.dataset.routeAdd)],at={x:(s.from.x+s.to.x)/2,y:(s.from.y+s.to.y)/2},origin=this.routeOrigin(mode.frame),fraction=projectRoute(path.points,at).fraction;
        const index=points.findIndex(p=>projectRoute(path.points,{x:p.x+origin.x,y:p.y+origin.y}).fraction>fraction);this.placementIndex=index<0?points.length:index;points.splice(this.placementIndex,0,{x:at.x-origin.x,y:at.y-origin.y});
      }
      editor.setRoute(view,points);this.placementDrag={pointer:event.pointerId,start,points};
    }else {
      if(!(event.target as Element).closest("[data-placement-label]"))return;
      const frame=this.layout!.routing!.labelFrames[mode.id],placement=this.currentLabelPlacement();
      this.placementDrag={pointer:event.pointerId,start,placement,matrix:frame.frame,path:mode.frame==="route"?this.layout!.routing!.paths[frame.owner].points:undefined,origin:{x:frame.box.x,y:frame.box.y+14}};
    }
    this.graph.setPointerCapture(event.pointerId);this.arrange(false);
  }
  private movePlacement(event:PointerEvent){
    const drag=this.placementDrag,editor=this.editor,view=this.placementView();if(!drag||!editor||!view)return;
    const p=this.worldPoint(event.clientX,event.clientY),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
    try {
      if(editor.mode.kind==="route"&&drag.points){const points=structuredClone(drag.points);points[this.placementIndex].x+=dx;points[this.placementIndex].y+=dy;editor.setRoute(view,points);}
      else if(drag.placement?.kind==="owner"&&drag.matrix){const [a,b,c,d]=drag.matrix,det=a*d-b*c;editor.setLabel(view,{kind:"owner",dx:drag.placement.dx+(d*dx-c*dy)/det,dy:drag.placement.dy+(-b*dx+a*dy)/det});}
      else if(drag.path&&drag.origin)editor.setLabel(view,{kind:"route",...projectRoute(drag.path,{x:drag.origin.x+dx,y:drag.origin.y+dy})});
      this.arrange(false);
    }catch(error){this.status(error instanceof Error?error.message:String(error));}
  }
  private placementKey(event:KeyboardEvent):boolean {
    if(!this.editor)return false;
    const action=(name:string)=>{event.preventDefault();this.placementAction(name);};
    try {
      if(event.key==="Escape"){action("cancel");return true;}
      if((event.ctrlKey||event.metaKey)&&["z","y"].includes(event.key.toLowerCase())){action(event.key.toLowerCase()==="y"||event.shiftKey?"redo":"undo");return true;}
      if(event.key==="Enter"){
        const handle=(event.target as Element).closest<SVGElement>("[data-route-add]");
        if(handle&&this.editor.mode.kind==="route"){
          event.preventDefault();const path=this.layout!.routing!.paths[this.editor.mode.id],segment=path.segments[Number(handle.dataset.routeAdd)],origin=this.routeOrigin(this.editor.mode.frame),points=this.editor.route?.waypoints??[];
          const at={x:(segment.from.x+segment.to.x)/2,y:(segment.from.y+segment.to.y)/2},fraction=projectRoute(path.points,at).fraction,index=points.findIndex(p=>projectRoute(path.points,{x:p.x+origin.x,y:p.y+origin.y}).fraction>fraction);
          this.placementIndex=index<0?points.length:index;points.splice(this.placementIndex,0,{x:at.x-origin.x,y:at.y-origin.y});this.editor.setRoute(this.placementView()!,points);this.arrange(false);return true;
        }
        action("accept");return true;
      }
      const editor=this.editor,view=this.placementView()!,step=event.shiftKey?10:1,dx=event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0,dy=event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0;
      if(editor.mode.kind==="route"){
        const focused=(event.target as Element).closest<SVGElement>("[data-route-waypoint]");if(focused)this.placementIndex=Number(focused.dataset.routeWaypoint);
        const points=editor.route?.waypoints??[];
        if(event.key==="Delete"){points.splice(this.placementIndex,1);event.preventDefault();editor.setRoute(view,points);this.arrange(false);return true;}
        if(dx||dy){event.preventDefault();if(!points[this.placementIndex])throw Error("Choose a segment handle to add a manual bend first");points[this.placementIndex].x+=dx;points[this.placementIndex].y+=dy;editor.setRoute(view,points);this.arrange(false);return true;}
      }else if(dx||dy){
        event.preventDefault();const p=this.currentLabelPlacement();
        editor.setLabel(view,p.kind==="owner"?{kind:"owner",dx:p.dx+dx,dy:p.dy+dy}:{...p,tangentOffset:p.tangentOffset+dx,normalOffset:p.normalOffset+dy});this.arrange(false);return true;
      }
    }catch(error){event.preventDefault();this.status(error instanceof Error?error.message:String(error));return true;}
    return false;
  }
  private portBase = new Map<
    string,
    Point & { ownerX: number; ownerY: number }
  >();
  private portLayout?: Layout;
  private connectionDirections = new Map<string, Point>();

  private findTool(id?: string) {
    return this.response?.scene.palette.groups
      .flatMap((g) => g.entries)
      .find((t) => t.id === id);
  }
  private placement(tool: Tool) {
    return tool.parameters?.placement ?? "node";
  }
  private worldPoint(x: number, y: number): Point {
    const r = this.graph.getBoundingClientRect();
    return {
      x: (x - r.left - this.viewport.x) / this.viewport.zoom,
      y: (y - r.top - this.viewport.y) / this.viewport.zoom,
    };
  }
  private elementAt(x: number, y: number) {
    // Edge hit targets sit above nodes; let gestures still reach their endpoints.
    for (const element of document.elementsFromPoint(x, y)) {
      const endpoint = element.closest<SVGElement>(
        "[data-port], [data-symbol]",
      );
      if (endpoint && this.graph.contains(endpoint)) return endpoint;
    }
    return undefined;
  }
  private endpointAt(x: number, y: number) {
    const el = this.elementAt(x, y);
    return el && this.graph.contains(el)
      ? (el.dataset.port ?? el.dataset.symbol)
      : undefined;
  }
  private nodeAt(x: number, y: number) {
    const el = this.elementAt(x, y)?.closest<SVGElement>("[data-symbol]");
    return el && this.graph.contains(el) ? el.dataset.symbol : undefined;
  }
  private regionParent(
    id: string,
    nodes = this.response?.scene.nodes ?? [],
  ): Region | undefined {
    for (const n of nodes) {
      for (const r of n.regions?.items ?? []) {
        if (r.children.some((c) => c.id === id)) return r;
        const nested = this.regionParent(id, r.children);
        if (nested) return nested;
      }
      const child = this.regionParent(id, n.children);
      if (child) return child;
    }
    return undefined;
  }
  private retile(n: Node, g: Geometry) {
    if (!this.layout || !n.regions?.items.length) return;
    const rs = n.regions.items,
      row = n.regions.direction === "row",
      top = this.layout.regions[rs[0].id].y;
    const minimum = rs.map((r) => ({
      width: Math.max(
        205,
        labelText(r.label).length * 9 + 28,
        ...r.children.map((c) => {
          const g = this.layout!.nodes[c.id];
          return g.x + g.width + 20;
        }),
      ),
      height: Math.max(
        90,
        ...r.children.map((c) => {
          const g = this.layout!.nodes[c.id];
          return g.y + g.height + 20;
        }),
      ),
    }));
    const extra =
      (row
        ? g.width - 56 - minimum.reduce((sum, r) => sum + r.width, 0)
        : g.height - top - 28 - minimum.reduce((sum, r) => sum + r.height, 0)) /
      rs.length;
    let cursor = 0;
    rs.forEach((r, i) => {
      const width = row ? minimum[i].width + Math.max(0, extra) : g.width - 56,
        height = row
          ? g.height - top - 28
          : minimum[i].height + Math.max(0, extra);
      this.layout!.regions[r.id] = {
        x: 28 + (row ? cursor : 0),
        y: top + (row ? 0 : cursor),
        width,
        height,
      };
      cursor += row ? width : height;
    });
  }
  private node(
    id?: string,
    nodes = this.response?.scene.nodes ?? [],
  ): Node | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const child = this.node(id, node.children);
      if (child) return child;
      for (const r of node.regions?.items ?? []) {
        const found = this.node(id, r.children);
        if (found) return found;
      }
    }
  }
  private borderPoint(point: Point, g: Geometry): Point {
    const x = Math.max(0, Math.min(g.width, point.x - g.x));
    const y = Math.max(0, Math.min(g.height, point.y - g.y));
    const distances = [x, g.width - x, y, g.height - y];
    const side = distances.indexOf(Math.min(...distances));
    return {
      x: side === 0 ? 0 : side === 1 ? g.width : x,
      y: side === 2 ? 0 : side === 3 ? g.height : y,
    };
  }
  private anchor(id: string, toward: Point): Point {
    const g = this.absolute.get(id);
    if (!g) return toward;
    if (!g.width && !g.height) return { x: g.x, y: g.y };
    const dx = toward.x - g.x - g.width / 2,
      dy = toward.y - g.y - g.height / 2;
    const scale =
      1 /
      Math.max(Math.abs(dx) / (g.width / 2), Math.abs(dy) / (g.height / 2), 1);
    return {
      x: g.x + g.width / 2 + dx * scale,
      y: g.y + g.height / 2 + dy * scale,
    };
  }
  private clearFeedback() {
    this.graph
      .querySelectorAll(".diagram-drop-target")
      .forEach((el) => el.classList.remove("diagram-drop-target"));
  }
  private dropFeedback(x: number, y: number) {
    this.clearFeedback();
    const id = this.endpointAt(x, y);
    if (id && this.legal(id))
      this.elementAt(x, y)?.classList.add("diagram-drop-target");
  }
  private previewConnection() {
    this.graph.querySelector(".connection-preview")?.remove();
    if (!this.connection) return;
    const { start: a, current: b } = this.connection;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.classList.add("connection-preview");
    line.setAttribute(
      "d",
      `M${a.x} ${a.y} H${(a.x + b.x) / 2} V${b.y} H${b.x}`,
    );
    this.graph.querySelector(".diagram-world")!.append(line);
  }
  private cancelGesture() {
    if(this.placementDrag&&this.graph.hasPointerCapture(this.placementDrag.pointer))this.graph.releasePointerCapture(this.placementDrag.pointer);
    this.placementDrag=undefined;
    if (
      this.connection &&
      this.graph.hasPointerCapture(this.connection.pointer)
    )
      this.graph.releasePointerCapture(this.connection.pointer);
    this.connection = undefined;
    this.drag = undefined;
    this.portDrag = undefined;
    this.resizeDrag = undefined;
    this.previewConnection();
    this.clearFeedback();
  }
  private arguments(tool: Tool) {
    const args: Record<string, string> = {};
    for (const input of tool.inputs ?? []) {
      const field = [
        ...this.controls.querySelectorAll<HTMLInputElement>("input"),
      ].find((el) => el.name === `arg:${input.id}`);
      args[input.id] = field?.value ?? input.default ?? "";
    }
    return args;
  }
  private selectedOwner() {
    return (
      this.controls.querySelector<HTMLSelectElement>('[name="owner"]')?.value ??
      this.response?.scene.view.owners[0]?.key ??
      ""
    );
  }
  private async place(x: number, y: number) {
    if (
      document.elementFromPoint(x, y)?.closest("[data-region]") &&
      !document.elementFromPoint(x, y)?.closest(".diagram-region [data-symbol]")
    ) {
      this.status(
        "Creating or reparenting a member through a region header is unsupported; edit source to populate the Group.",
      );
      return;
    }
    const tool = this.tool;
    if (!tool || this.stale || this.busy || !this.response) return;
    const id = this.nodeAt(x, y),
      node = this.node(id),
      border = this.placement(tool) === "border";
    if (border && !node) {
      this.status("Drop a port on a part border.");
      return;
    }
    if (node && !this.legal(node.id)) {
      this.status("This owner does not pass the applicability predicate.");
      return;
    }
    if (node?.binding.readOnly) {
      this.status("This owner is read-only.");
      return;
    }
    const owner = node?.binding.key ?? this.selectedOwner();
    if (!owner) {
      this.status("Choose a writable owner first.");
      return;
    }
    const before = new Set(this.absolute.keys()),
      point = this.worldPoint(x, y);
    this.placing = { before, point, owner: id, border };
    await this.execute(tool, owner, this.arguments(tool));
  }
  private bindingForEndpoint(id: string): Binding | undefined {
    const node = this.node(id);
    if (node) return node.binding;
    const owner = this.node(this.portOwners.get(id));
    return owner?.ports.find((p) => p.id === id)?.binding;
  }
  private async connect(source: string, target: string) {
    const tool = this.tool,
      a = this.bindingForEndpoint(source),
      b = this.bindingForEndpoint(target);
    if (!tool || !a || !b || this.stale || this.busy) return;
    const common = a.context.filter(
      (key, i) =>
        b.context[i] === key &&
        a.context.slice(0, i).every((k, j) => b.context[j] === k),
    );
    const owner =
      [...common].reverse().find((key, reversedIndex) =>
        Object.keys(this.layout?.nodes ?? {}).some((id) => {
          const n = this.node(id);
          return (
            n?.binding.key === key &&
            JSON.stringify(n.binding.context) ===
              JSON.stringify(common.slice(0, common.length - 1 - reversedIndex))
          );
        }),
      ) ?? this.selectedOwner();
    await this.execute(tool, owner, {
      ...this.arguments(tool),
      source,
      target,
    });
  }
  private async execute(
    tool: Tool,
    owner: string,
    args: Record<string, string>,
  ) {
    if (this.busy || this.stale) return;
    // A new child can enlarge its ancestors. Let layout recompute automatic
    // sibling positions before routing around the larger container.
    const addingChild = Boolean(this.placing?.owner && !this.placing.border);
    const state = addingChild ? undefined : this.state();
    if (state && this.layout)
      for (const [id, g] of Object.entries(this.layout.nodes))
        put(state.positions, id, { ...g });
    this.busy = true;
    this.renderTools();
    try {
      await this.callbacks.command(tool, owner, args);
      this.tool = undefined;
    } catch (error) {
      this.placing = undefined;
      this.status(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
      this.renderTools();
      void this.updateTargets();
    }
  }
  private legal(id: string) {
    return !this.callbacks.targets || this.targetIds.has(id);
  }
  private paintTargets() {
    for (const el of this.graph.querySelectorAll<SVGElement>(
      "[data-symbol],[data-port]",
    ))
      el.classList.toggle(
        "diagram-legal-target",
        !!this.tool &&
          !this.stale &&
          this.targetIds.has(el.dataset.symbol ?? el.dataset.port ?? ""),
      );
  }
  private async updateTargets(source?: string) {
    const seq = ++this.targetSequence,
      tool = this.tool;
    this.targetIds.clear();
    this.paintTargets();
    if (
      !tool ||
      tool.gesture === "action" ||
      !this.callbacks.targets ||
      this.stale
    )
      return;
    try {
      const ids = await this.callbacks.targets(tool, source);
      if (
        seq !== this.targetSequence ||
        tool.id !== this.tool?.id ||
        this.stale
      )
        return;
      this.targetIds = new Set(ids);
      this.paintTargets();
    } catch (error) {
      if (seq === this.targetSequence) this.status(String(error));
    }
  }
  private async updateLabelTarget() {
    const seq = ++this.targetSequence,
      tool = this.tool,
      part = this.selectedPart;
    this.labelEnabled = false;
    const update = () => {
      const button = this.controls.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (button)
        button.disabled = !this.labelEnabled || this.stale || this.busy;
    };
    update();
    if (!tool || !part || this.stale || !this.callbacks.labelTargets) return;
    try {
      const result = await this.callbacks.labelTargets(tool, part);
      if (
        seq !== this.targetSequence ||
        this.tool?.id !== tool.id ||
        this.selectedPart !== part ||
        this.stale
      )
        return;
      this.labelEnabled = !!result?.enabled;
      if (result && !result.enabled) this.status(result.reason);
      update();
    } catch (error) {
      if (seq === this.targetSequence) this.status(String(error));
    }
  }
  private finishPlacement() {
    const placement = this.placing;
    if (!placement || !this.layout) return;
    const id = [...this.absolute.keys()].find(
      (id) =>
        !placement.before.has(id) &&
        (placement.border ? this.portOwners.has(id) : !!this.layout!.nodes[id]),
    );
    if (!id) {
      this.placing = undefined;
      return;
    }
    const parent = placement.owner
      ? this.absolute.get(placement.owner)
      : undefined;
    const state = this.state();
    if (!state) return;
    if (placement.border && parent) {
      put(state.positions, id, {
        ...this.borderPoint(placement.point, parent),
        width: 12,
        height: 12,
      });
    } else {
      const g = {...this.layout.nodes[id]};
      const owner = placement.owner ? this.node(placement.owner) : undefined;
      const contentTop = owner
        ? 64 +
          owner.compartments.reduce((n, c) => n + 20 + c.rows.length * 20, 0)
        : 0;
      const x = placement.point.x - (parent?.x ?? 0),
        y = placement.point.y - (parent?.y ?? 0);
      // Heading drops append in the automatic layout. Retain that layout if
      // a requested child position would cover a sibling or the heading.
      const siblings = (owner?.children ?? [])
        .filter((n) => n.id !== id)
        .map((n) => this.layout!.nodes[n.id])
        .filter(Boolean);
      const overlaps = (x: number, y: number) =>
        siblings.some(
          (other) =>
            x < other.x + other.width &&
            x + g.width > other.x &&
            y < other.y + other.height &&
            y + g.height > other.y,
        );
      if (!parent || (y >= contentTop && !overlaps(x, y))) {
        g.x = parent ? Math.max(28, x) : x;
        g.y = parent ? Math.max(contentTop, y) : y;
      }
      // Persisted sibling positions can differ from ELK's new automatic layout.
      if (parent && overlaps(g.x, g.y)) {
        g.x = Math.max(28, ...siblings.map((n) => n.x + n.width + 28));
        g.y = contentTop;
      }
      put(state.positions, id, { ...g });
      let child = id,
        container = owner;
      while (container) {
        const current = {...this.layout.nodes[container.id]},
          childGeometry = own(state.positions,child)??this.layout.nodes[child];
        current.width = Math.max(
          current.width,
          childGeometry.x + childGeometry.width + 28,
        );
        current.height = Math.max(
          current.height,
          childGeometry.y + childGeometry.height + 38,
        );
        put(state.positions, container.id, { ...current });
        child = container.id;
        const findParent = (nodes: Node[]): Node | undefined => {
          for (const n of nodes) {
            if (n.children.some((c) => c.id === child)) return n;
            const parent = findParent(n.children);
            if (parent) return parent;
          }
          return undefined;
        };
        container = findParent(this.response!.scene.nodes);
      }
    }
    this.placing = undefined;
    this.persist();
    this.arrange(false);
  }
}
