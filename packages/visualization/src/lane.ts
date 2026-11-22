import { own, put } from "./records.ts";
/** Lane form: geometry is presentation; rank/lane/span intents are commands. */
import {
  defaultNotation,
  labelText,
  validateSceneResponse,
  type Binding,
  type Label,
  type LabelPart,
  type LaneGraphScene,
  type LaneStep,
  type Presentation,
  type LanePresentation,
  type SceneResponse,
  type Tool,
  type View,
  type NotationProfile,
  type Geometry,
} from "./protocol.ts";
import { color, validateNotation } from "./notation.ts";
import type { Callbacks } from "./canvas.ts";
import {
  laneLayout,
  orderedLanes,
  checkLaneOrder,
  type LaneLayout,
} from "./lane-layout.ts";
import "./lane.css";
const ns = "http://www.w3.org/2000/svg";
const svg = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
export class LaneCanvas {
  private response?: SceneResponse & { scene: LaneGraphScene };
  private layout?: LaneLayout;
  private presentation: Presentation = { schemaVersion:4, views: {} };
  private notation = defaultNotation;
  private stale = true;
  private busy = false;
  private selected?: string;
  private sequence = 0;
  private viewport = { x: 20, y: 20, zoom: 1 };
  private viewsList: View[] = [];
  private message: HTMLElement;
  private graph: SVGSVGElement;
  private world: SVGElement;
  private form: HTMLFormElement;
  private viewSelect: HTMLSelectElement;
  private tools: HTMLElement;
  private selectedBinding?: Binding;
  private selectedPart?: { part: LabelPart; owner: Binding };
  private drag?: {
    step?: LaneStep;
    resize?: boolean;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    pointer: number;
    viewport: { x: number; y: number; zoom: number };
  };
  constructor(
    private root: HTMLElement,
    private callbacks: Callbacks,
  ) {
    root.classList.add("lane-canvas");
    root.innerHTML = `<header><label>View <select aria-label="Diagram view"></select></label><button type="button" data-fit>Fit lanes</button><button type="button" data-save>Save layout</button><span class="lane-axis"></span></header><div class="lane-tools"></div><p class="lane-status" role="status"></p><div class="lane-viewport" tabindex="0" aria-label="Lane graph"><svg><g class="lane-world"></g></svg></div><form class="lane-form" hidden></form>`;
    this.message = root.querySelector(".lane-status")!;
    this.graph = root.querySelector("svg")!;
    this.world = root.querySelector(".lane-world")!;
    this.form = root.querySelector("form")!;
    this.viewSelect = root.querySelector("select")!;
    this.tools = root.querySelector(".lane-tools")!;
    this.viewSelect.addEventListener("change", () =>
      this.callbacks.view(this.viewSelect.value),
    );
    root
      .querySelector("[data-fit]")!
      .addEventListener("click", () => this.fit());
    root
      .querySelector("[data-save]")!
      .addEventListener("click", () => this.callbacks.save());
    this.graph.addEventListener("pointerdown", (e) => this.down(e));
    this.graph.addEventListener("pointermove", (e) => this.move(e));
    this.graph.addEventListener("pointerup", (e) => this.up(e));
    this.graph.addEventListener("pointercancel", () => this.cancel());
    this.graph.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = this.graph.getBoundingClientRect(),
          x = e.clientX - r.left,
          y = e.clientY - r.top,
          zoom = Math.max(
            0.05,
            Math.min(4, this.viewport.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)),
          ),
          ratio = zoom / this.viewport.zoom;
        this.viewport = {
          x: x - (x - this.viewport.x) * ratio,
          y: y - (y - this.viewport.y) * ratio,
          zoom,
        };
        this.transform();
        this.persist();
      },
      { passive: false },
    );
    root.addEventListener("keydown", (e) => {
      if (e.key === "F2" && this.selectedPart?.part.editTool) {
        const t = this.response?.scene.palette.groups
          .flatMap((g) => g.entries)
          .find((t) => t.id === this.selectedPart?.part.editTool);
        if (t) {
          e.preventDefault();
          this.labelAction(t);
        }
      }
      if (e.key === "Escape") {
        this.cancel();
        e.preventDefault();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !(e.target as Element).matches("input,select,textarea")
      ) {
        e.preventDefault();
        e.shiftKey ? this.callbacks.redo?.() : this.callbacks.undo();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "y" &&
        !(e.target as Element).matches("input,select,textarea")
      ) {
        e.preventDefault();
        this.callbacks.redo?.();
      }
    });
  }
  views(views: View[], current: string) {
    this.viewsList = views;
    this.viewSelect.replaceChildren(
      ...views.map((v) => {
        const o = document.createElement("option");
        o.value = v.key;
        o.textContent = v.name;
        return o;
      }),
    );
    this.viewSelect.value = current;
  }
  requestView(key: string) {
    this.viewSelect.value = key;
  }
  status(message: string) {
    this.message.textContent = message;
    this.message.hidden = !message;
  }
  setStale() {
    this.root.setAttribute("aria-busy", "true");
    this.stale = true;
    this.cancel();
    this.renderTools();
  }
  setPresentation(value: Presentation) {
    this.presentation = value;
    if (this.response) {
      const p = this.state();
      this.viewport = { ...p.viewport };
      this.draw();
    }
  }
  setNotation(value: NotationProfile) {
    validateNotation(value);
    this.notation = value;
    if (this.response) this.draw();
  }
  setScene(response: SceneResponse & { scene: LaneGraphScene }) {
    validateSceneResponse(response);
    this.root.dataset.revision = String(response.scene.revision);
    this.root.setAttribute("aria-busy", String(this.busy));
    const changed = this.response?.scene.view.key !== response.scene.view.key;
    this.sequence++;
    this.drag = undefined;
    this.form.hidden = true;
    this.response = response;
    this.stale = false;
    this.selected = undefined;
    this.selectedBinding = undefined;
    this.selectedPart = undefined;
    const state = this.state();
    this.viewport = { ...state.viewport };
    this.views(this.viewsList, response.scene.view.key);
    this.draw();
    this.renderTools();
    this.status(response.scene.problems.join(" · "));
    this.root.querySelector(".lane-axis")!.textContent =
      `${response.scene.axis.direction} semantic axis`;
    if (changed && !own(this.presentation.views, response.scene.view.key))
      this.fit(false);
  }
  private state(): LanePresentation {
    const key = this.response?.scene.view.key;
    if (!key) throw Error("No lane scene");
    const saved = own(this.presentation.views, key);
    if (saved && saved.form !== "laneGraph")
      throw Error("Saved view form changed; export or reset its layout");
    if (saved && (saved.packageFingerprint !== this.response!.presentation.fingerprint || saved.projection !== this.response!.scene.ruleSet))
      throw Error("Saved layout package or projection changed; export or reset its layout");
    return (
      saved ?? {
        form: "laneGraph",
        packageFingerprint: this.response!.presentation.fingerprint,
        projection: this.response!.scene.ruleSet,
        laneOrder: [],
        viewport: { x: 20, y: 20, zoom: 1 },
      }
    );
  }
  private persist() {
    if (!this.response || !this.layout) return;
    put(this.presentation.views, this.response.scene.view.key, {
      form: "laneGraph",
      packageFingerprint: this.response.presentation.fingerprint,
      projection: this.response.scene.ruleSet,
      laneOrder: [...this.layout.laneOrder],
      viewport: { ...this.viewport },
    });
    this.callbacks.presentation(structuredClone(this.presentation));
  }
  private transform() {
    this.world.setAttribute(
      "transform",
      `translate(${this.viewport.x},${this.viewport.y}) scale(${this.viewport.zoom})`,
    );
  }
  private fit(save = true) {
    if (!this.layout) return;
    const r = this.graph.getBoundingClientRect(),
      zoom = Math.max(
        0.05,
        Math.min(
          1,
          (r.width - 40) / this.layout.width,
          (r.height - 40) / this.layout.height,
        ),
      );
    this.viewport = { x: 20, y: 20, zoom };
    this.transform();
    if (save) this.persist();
  }
  private renderTools() {
    this.tools.replaceChildren();
    for (const tool of this.response?.scene.palette.groups.flatMap(
      (g) => g.entries,
    ) ?? []) {
      if (tool.gesture !== "action" || tool.command.startsWith("presentation."))
        continue;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = tool.label;
      b.title =
        this.response?.capabilities.find((c) => c.toolId === tool.id)?.reason ||
        "Select a Step or an editable label";
      b.disabled =
        this.stale ||
        this.busy ||
        (!this.selected && this.selectedPart?.part.editTool !== tool.id) ||
        !this.response?.capabilities.some(
          (c) => c.toolId === tool.id && c.enabled,
        );
      b.addEventListener("click", () => {
        if (this.selectedPart?.part.editTool === tool.id) {
          this.labelAction(tool);
          return;
        }
        const s = this.response?.scene.steps.find(
          (s) => s.id === this.selected,
        );
        if (s) this.propose(s, tool);
      });
      this.tools.append(b);
    }
  }
  private select(
    binding: Binding,
    reveal = false,
    id?: string,
    part?: LabelPart,
    owner?: Binding,
  ) {
    this.selectedPart = part && owner ? { part, owner } : undefined;
    this.selectedBinding = binding;
    if (id) this.selected = id;
    this.callbacks.select(binding, reveal);
    this.highlight(binding.elementId);
    this.renderTools();
  }
  highlight(element: string | null) {
    this.world
      .querySelectorAll<SVGElement>("[data-element]")
      .forEach((e) =>
        e.classList.toggle("selected", e.dataset.element === element),
      );
  }
  private labels(
    value: Label,
    owner: SVGElement,
    x: number,
    y: number,
    onSelect: (b: Binding, reveal: boolean, part: LabelPart) => void,
  ) {
    let offset = x;
    const measure = this.measure();
    for (const part of value.parts) {
      const g = svg("g", { "data-lane-part": part.id });
      const width = Math.max(8, measure(part.text));
      if (part.binding) {
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", part.text || "Empty bound label");
        g.setAttribute("data-element", part.binding.elementId);
        const hit = svg("rect", {
          x: offset,
          y: y - 15,
          width,
          height: 22,
          fill: "transparent",
        });
        g.append(hit);
        g.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          onSelect(part.binding!, false, part);
        });
        g.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          onSelect(part.binding!, true, part);
        });
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(part.binding!, e.key === "Enter", part);
          }
        });
      } else g.addEventListener("pointerdown", (e) => e.stopPropagation());
      const t = svg("text", { x: offset, y });
      t.textContent = part.text;
      g.append(t);
      owner.append(g);
      offset += width;
    }
  }
  private measure() {
    const c = document.createElement("canvas").getContext("2d");
    if (c) c.font = "13px system-ui";
    return (s: string) => c?.measureText(s).width ?? s.length * 8;
  }
  private draw() {
    if (!this.response) return;
    const scene = this.response.scene;
    let order = orderedLanes(scene, this.state().laneOrder);
    try {
      checkLaneOrder(scene, order);
    } catch (error) {
      order = scene.lanes.map((l) => l.id);
      this.status(`Saved lane order is incompatible: ${String(error)}`);
    }
    this.layout = laneLayout(scene, order, this.measure());
    this.world.replaceChildren();
    const layout = this.layout,
      vertical = scene.axis.direction === "vertical";
    for (const lane of scene.lanes) {
      const box = layout.lanes.get(lane.id)!,
        g = svg("g", {
          "data-lane": lane.id,
          "data-element": lane.binding.elementId,
        });
      const band = svg(
        "rect",
        vertical
          ? {
              x: box.x,
              y: box.y,
              width: box.width,
              height: layout.height,
              fill: "var(--lane-band)",
            }
          : {
              x: box.x,
              y: box.y,
              width: layout.width,
              height: box.height,
              fill: "var(--lane-band)",
            },
      );
      g.append(band);
      g.append(svg("rect", { ...box, class: "lane-header" }));
      this.labels(lane.label, g, box.x + 12, box.y + 25, (b, reveal, part) =>
        this.select(b, reveal, undefined, part, lane.binding),
      );
      for (const [offset, delta, glyph] of [
        [0, -1, "←"],
        [22, 1, "→"],
      ] as const) {
        const control = svg("text", {
          x: box.x + 12 + offset,
          y: box.y + 48,
          tabindex: 0,
          role: "button",
          "aria-label": `Move lane ${labelText(lane.label)} ${delta < 0 ? "earlier" : "later"}`,
        });
        control.textContent = glyph;
        const act = () => this.reorder(lane.id, delta);
        control.addEventListener("click", act);
        control.addEventListener("pointerdown", (e) => e.stopPropagation());
        control.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            act();
          }
        });
        g.append(control);
      }
      this.world.append(g);
    }
    const shape = this.notation.shapes.structure ??
      this.notation.shapes.usage ?? {
        shape: "rounded",
        fill: "usage",
        stroke: "neutral",
        radius: 5,
      };
    for (const span of scene.spans) {
      const box = layout.spans.get(span.id)!,
        g = svg("g", { "data-span": span.id });
      g.append(
        svg("rect", {
          ...box,
          class: "lane-span",
          rx: 4,
          fill: color(shape.fill),
          stroke: color(shape.stroke),
        }),
      );
      const handle = svg(
        "rect",
        vertical
          ? { x: box.x + 5, y: box.y + box.height - 9, width: 18, height: 8 }
          : { x: box.x + box.width - 9, y: box.y + 5, width: 8, height: 18 },
      );
      handle.setAttribute("class", "lane-span-handle");
      handle.setAttribute("data-resize-step", span.step);
      handle.setAttribute("aria-label", "Resize span end");
      g.append(handle);
      this.world.append(g);
    }
    for (const s of scene.steps) {
      const target = layout.steps.get(s.id)!;
      for (const id of s.predecessors) {
        const source = layout.steps.get(id)!;
        const a = {
            x: source.x + source.width / 2,
            y: source.y + source.height / 2,
          },
          b = {
            x: target.x + target.width / 2,
            y: target.y + target.height / 2,
          };
        this.world.append(
          svg("path", {
            d: `M${a.x},${a.y} L${b.x},${b.y}`,
            class: "lane-precedence",
          }),
        );
      }
    }
    for (const step of scene.steps) {
      const box = layout.steps.get(step.id)!,
        g = svg("g", {
          "data-step": step.id,
          "data-element": step.binding.elementId,
        });
      g.classList.add("lane-step");
      if (step.unordered) g.classList.add("unordered");
      const body = svg("rect", {
        ...box,
        rx: shape.shape === "rounded" ? (shape.radius ?? 5) : 0,
        fill: color(shape.fill),
        stroke: color(shape.stroke),
        class: "lane-step-body",
        tabindex: 0,
        role: "button",
        "aria-label": `Step ${labelText(step.label)}, rank ${step.rank}${step.unordered ? ", unordered" : ""}`,
      });
      body.addEventListener("click", () => {
        if (!this.drag?.moved) this.select(step.binding, false, step.id);
      });
      body.addEventListener("dblclick", () =>
        this.select(step.binding, true, step.id),
      );
      body.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.select(step.binding, e.key === "Enter", step.id);
        }
      });
      g.append(body);
      this.labels(step.label, g, box.x + 12, box.y + 27, (b, reveal, part) =>
        this.select(b, reveal, step.id, part, step.binding),
      );
      this.world.append(g);
    }
    this.transform();
    if (this.selectedBinding) this.highlight(this.selectedBinding.elementId);
  }
  private reorder(id: string, delta: number) {
    if (!this.response || !this.layout) return;
    const order = [...this.layout.laneOrder],
      at = order.indexOf(id),
      next = at + delta;
    if (next < 0 || next >= order.length) return;
    [order[at], order[next]] = [order[next], order[at]];
    try {
      checkLaneOrder(this.response.scene, order);
      const state = this.state();
      put(this.presentation.views, this.response.scene.view.key, {
        ...state,
        laneOrder: order,
      });
      this.draw();
      this.persist();
    } catch (error) {
      this.status(String(error));
    }
  }
  private point(x: number, y: number) {
    const r = this.graph.getBoundingClientRect();
    return {
      x: (x - r.left - this.viewport.x) / this.viewport.zoom,
      y: (y - r.top - this.viewport.y) / this.viewport.zoom,
    };
  }
  private down(e: PointerEvent) {
    if (e.button !== 0 || this.busy) return;
    const target = e.target as Element;
    if (target.closest("[data-lane-part]")) return;
    const id = target.closest("[data-step]")?.getAttribute("data-step"),
      resize = target.getAttribute("data-resize-step"),
      step = this.response?.scene.steps.find((s) => s.id === (resize ?? id));
    if (step && this.stale) return;
    this.drag = {
      step,
      resize: !!resize,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      pointer: e.pointerId,
      viewport: { ...this.viewport },
    };
    this.graph.setPointerCapture(e.pointerId);
  }
  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) d.moved = true;
    if (!d.moved) return;
    if (!d.step) {
      this.viewport.x = d.viewport.x + e.clientX - d.x;
      this.viewport.y = d.viewport.y + e.clientY - d.y;
      this.transform();
      return;
    }
    this.world.querySelector(".lane-preview")?.remove();
    const p = this.point(e.clientX, e.clientY),
      r = svg("circle", { cx: p.x, cy: p.y, r: 9, class: "lane-preview" });
    this.world.append(r);
    this.status(
      d.resize
        ? "Release to propose a span end"
        : "Release to propose a lane and insertion gap",
    );
  }
  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = undefined;
    this.world.querySelector(".lane-preview")?.remove();
    if (!d) return;
    if (this.graph.hasPointerCapture(e.pointerId))
      this.graph.releasePointerCapture(e.pointerId);
    if (!d.step) {
      if (d.moved) this.persist();
      return;
    }
    if (!d.moved) return;
    const tool = this.tool();
    if (!tool) {
      this.status("No supported lane placement command");
      return;
    }
    const p = this.point(e.clientX, e.clientY),
      vertical = this.response!.scene.axis.direction === "vertical",
      semantic = vertical ? p.y : p.x,
      cross = vertical ? p.x : p.y;
    const same = this.response!.scene.steps.filter(
      (s) =>
        s.binding.context[0] === d.step!.binding.context[0] &&
        s.id !== d.step!.id,
    ).sort((a, b) => a.rank - b.rank);
    const nearest = same.reduce<LaneStep | undefined>(
      (best, s) =>
        Math.abs(
          s.rank - (semantic - this.layout!.header) / this.layout!.slot,
        ) <
        Math.abs(
          (best?.rank ?? Infinity) -
            (semantic - this.layout!.header) / this.layout!.slot,
        )
          ? s
          : best,
      undefined,
    );
    if (d.resize) {
      this.propose(d.step, tool, undefined, undefined, nearest?.id ?? null);
      return;
    }
    const laneId =
      this.layout!.laneOrder[
        Math.max(
          0,
          Math.min(
            this.layout!.laneOrder.length - 1,
            Math.floor((cross - 40) / this.layout!.band),
          ),
        )
      ];
    const before =
      same.find(
        (s) => s.rank >= (semantic - this.layout!.header) / this.layout!.slot,
      )?.id ?? null;
    this.propose(d.step, tool, laneId, before);
  }
  private tool() {
    const labelTools = new Set(
      this.response?.scene.steps
        .flatMap((s) => s.label.parts.map((p) => p.editTool))
        .concat(
          this.response.scene.lanes.flatMap((l) =>
            l.label.parts.map((p) => p.editTool),
          ),
        ),
    );
    return this.response?.scene.palette.groups
      .flatMap((g) => g.entries)
      .find(
        (t) =>
          t.gesture === "action" &&
          (t.parameters.placement === "lane" || !labelTools.has(t.id)) &&
          !t.command.startsWith("presentation.") &&
          this.response?.capabilities.some(
            (c) => c.toolId === t.id && c.enabled,
          ),
      );
  }
  private cancel() {
    this.sequence++;
    if (this.drag && this.graph.hasPointerCapture(this.drag.pointer))
      this.graph.releasePointerCapture(this.drag.pointer);
    this.drag = undefined;
    this.form.hidden = true;
    this.world.querySelector(".lane-preview")?.remove();
  }
  private labelAction(tool: Tool) {
    const selected = this.selectedPart;
    if (!selected || !selected.part.binding || this.stale || this.busy) return;
    this.cancel();
    this.form.replaceChildren();
    this.form.hidden = false;
    const heading = document.createElement("strong");
    heading.textContent = tool.label;
    this.form.append(heading);
    const inputs = new Map<string, HTMLInputElement>();
    for (const field of tool.inputs) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      label.textContent = field.label;
      input.setAttribute("aria-label", field.label);
      input.value = field.default;
      label.append(input);
      this.form.append(label);
      inputs.set(field.id, input);
    }
    const reason = document.createElement("p"),
      apply = document.createElement("button"),
      cancel = document.createElement("button");
    apply.type = "submit";
    apply.textContent = "Apply label edit";
    apply.disabled = true;
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => this.cancel();
    this.form.append(reason, apply, cancel);
    const seq = ++this.sequence;
    void this.callbacks
      .labelTargets?.(tool, selected.part.id)
      .then((result) => {
        if (seq !== this.sequence || this.stale || this.form.hidden) return;
        apply.disabled = !result?.enabled;
        reason.textContent = result?.reason ?? "No label target provider";
      })
      .catch((error) => {
        if (seq === this.sequence) reason.textContent = String(error);
      });
    this.form.onsubmit = (e) => {
      e.preventDefault();
      if (apply.disabled || this.stale || this.busy) return;
      this.busy = true;
      this.root.setAttribute("aria-busy", "true");
      apply.disabled = true;
      void this.callbacks
        .command(tool, selected.owner.key, {
          part: selected.part.id,
          ...Object.fromEntries(
            [...inputs].map(([id, input]) => [id, input.value]),
          ),
        })
        .then(() => this.cancel())
        .catch((error) => {
          reason.textContent = String(error);
        })
        .finally(() => {
          this.busy = false;
          this.root.setAttribute("aria-busy", String(this.stale));
          this.renderTools();
        });
    };
    inputs.values().next().value?.focus();
  }
  private propose(
    step: LaneStep,
    tool: Tool,
    laneId?: string,
    beforeId?: string | null,
    endId?: string | null,
  ) {
    if (this.stale || this.busy || !this.response) return;
    this.cancel();
    this.selected = step.id;
    this.form.replaceChildren();
    this.form.hidden = false;
    const heading = document.createElement("strong");
    heading.textContent = `${tool.label}: ${labelText(step.label)}`;
    this.form.append(heading);
    if (typeof tool.parameters.notice === "string") {
      const notice = document.createElement("p");
      notice.textContent = tool.parameters.notice;
      this.form.append(notice);
    }
    const select = (
      name: string,
      values: { id: string; label: string }[],
      initial: string,
    ) => {
      const label = document.createElement("label"),
        input = document.createElement("select");
      label.textContent = name;
      input.setAttribute("aria-label", name);
      for (const v of values) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = v.label;
        input.append(o);
      }
      input.value = initial;
      label.append(input);
      this.form.append(label);
      return input;
    };
    const scene = this.response.scene,
      container = step.binding.context[0],
      ordered = scene.order
        .map((id) => scene.steps.find((s) => s.id === id)!)
        .filter((s) => s.binding.context[0] === container),
      others = ordered.filter((s) => s.id !== step.id);
    const lanes = scene.lanes.filter((l) => l.container === container),
      span = scene.spans.find((s) => s.step === step.id),
      current = ordered.indexOf(step);
    const lane = select(
      "Target lane",
      lanes.map((l) => ({ id: l.id, label: labelText(l.label) })),
      laneId ?? step.lane,
    );
    const before = select(
      "Insert before",
      [
        { id: "", label: "Append" },
        ...others.map((s) => ({ id: s.id, label: labelText(s.label) })),
      ],
      beforeId === undefined
        ? (ordered[current + 1]?.id ?? "")
        : (beforeId ?? ""),
    );
    const end = select(
      "Span end",
      [
        { id: "", label: "No span" },
        ...others.map((s) => ({ id: s.id, label: labelText(s.label) })),
      ],
      endId === undefined ? (span?.end ?? "") : (endId ?? ""),
    );
    const reason = document.createElement("p");
    reason.className = "lane-target-reason";
    this.form.append(reason);
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.textContent = "Apply placement";
    apply.disabled = true;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => this.cancel();
    this.form.append(apply, cancel);
    const refresh = async () => {
      const seq = ++this.sequence;
      apply.disabled = true;
      reason.textContent = "Checking placement…";
      try {
        const result = await this.callbacks.laneTargets?.(
          tool,
          step.id,
          lane.value,
          before.value || null,
          end.value || null,
        );
        if (seq !== this.sequence || this.stale || this.form.hidden) return;
        apply.disabled = !result?.enabled;
        reason.textContent = result?.reason ?? "No lane target provider";
      } catch (error) {
        if (seq === this.sequence) reason.textContent = String(error);
      }
    };
    for (const input of [lane, before, end])
      input.onchange = () => void refresh();
    this.form.onsubmit = (e) => {
      e.preventDefault();
      if (apply.disabled || this.stale || this.busy) return;
      this.busy = true;
      this.root.setAttribute("aria-busy", "true");
      apply.disabled = true;
      this.renderTools();
      void this.callbacks
        .command(tool, step.binding.key, {
          step: step.id,
          lane: lane.value,
          before: before.value,
          end: end.value,
        })
        .then(() => this.cancel())
        .catch((error) => {
          this.status(String(error));
          reason.textContent = String(error);
        })
        .finally(() => {
          this.busy = false;
          this.root.setAttribute("aria-busy", String(this.stale));
          this.renderTools();
          if (!this.form.hidden) void refresh();
        });
    };
    void refresh();
    lane.focus();
  }
}
