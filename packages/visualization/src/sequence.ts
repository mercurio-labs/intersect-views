import type { Callbacks } from "./canvas.ts";
import type { Binding, GraphScene, GraphSceneResponse, Label, View } from "./protocol.ts";
import { labelText, validateSceneResponse } from "./protocol.ts";
import "./sequence.css";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, String(value));
  return element;
}

function orderedEvents(scene: GraphScene, events: string[]) {
  const successors = new Map(events.map((id) => [id, new Set<string>()]));
  const incoming = new Map(events.map((id) => [id, 0]));
  for (const { source, target } of scene.edges) {
    const targets = successors.get(source)!;
    if (!targets.has(target)) {
      targets.add(target);
      incoming.set(target, incoming.get(target)! + 1);
    }
  }
  const ready = events.filter((id) => incoming.get(id) === 0);
  const rank = new Map<string, number>();
  let concurrent = false;
  for (let index = 0; index < ready.length; index++) {
    if (ready.length - index > 1) concurrent = true;
    const id = ready[index];
    rank.set(id, index);
    for (const target of successors.get(id)!) {
      const remaining = incoming.get(target)! - 1;
      incoming.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  if (rank.size !== events.length) throw Error("Sequence ordering contains a cycle");
  return { rank, concurrent };
}

let instances = 0;

/** Renders typed event and message bindings from a checked sequence scene. */
export class SequenceCanvas {
  private readonly picker = document.createElement("select");
  private readonly message = document.createElement("div");
  private readonly viewport = document.createElement("div");
  private readonly markerId = "sequence-arrow-" + ++instances;
  private readonly selections = new Map<string, SVGGElement[]>();
  private selected: string | null = null;
  private stale = true;

  constructor(root: HTMLElement, private readonly callbacks: Pick<Callbacks, "view" | "select">) {
    root.classList.add("sequence-workbench");
    const heading = document.createElement("div");
    heading.className = "diagram-heading";
    this.picker.setAttribute("aria-label", "Sequence view");
    this.picker.onchange = () => this.callbacks.view(this.picker.value);
    heading.append(this.picker);
    this.message.className = "diagram-status";
    this.message.setAttribute("role", "status");
    this.viewport.className = "sequence-viewport";
    root.append(heading, this.message, this.viewport);
  }

  views(views: View[], selected: string) {
    this.picker.replaceChildren(...views.map((view) => new Option(view.name, view.key)));
    this.picker.value = selected;
  }

  reset() {
    this.viewport.replaceChildren();
    this.selections.clear();
    this.selected = null;
    this.setStale();
  }

  setStale() {
    this.stale = true;
    this.viewport.setAttribute("aria-busy", "true");
  }

  status(message: string) {
    this.message.textContent = message;
    this.message.hidden = !message;
  }

  highlight(id: string | null) {
    this.selected = id;
    for (const [elementId, groups] of this.selections)
      for (const group of groups) group.classList.toggle("sequence-selected", id === elementId);
  }

  setScene(response: GraphSceneResponse) {
    validateSceneResponse(response);
    const scene = response.scene;
    if (scene.layout.strategy !== "sequence") throw Error("Expected a sequence scene");
    const lifelines = scene.nodes[0].children;
    const events = lifelines.flatMap((line) => line.children);
    const { rank, concurrent } = orderedEvents(scene, events.map((event) => event.id));
    const labels = [...lifelines, ...events].map((node) => labelText(node.title));
    const stride = Math.max(240, ...labels.map((label) => label.length * 8 + 55));
    const height = 140 + events.length * 56;
    const chart = svg("svg", {
      width: stride * Math.max(1, lifelines.length),
      height,
      "aria-label": "Sequence diagram",
      role: "group",
    });
    const defs = svg("defs", {});
    const marker = svg("marker", {
      id: this.markerId, viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 8, markerHeight: 8, orient: "auto",
    });
    marker.append(svg("path", { d: "M1 1 L9 5 L1 9", fill: "none", stroke: "context-stroke" }));
    defs.append(marker);
    chart.append(defs);
    this.selections.clear();
    const points = new Map<string, { x: number; y: number }>();
    const eventGroups = [];
    for (const [index, line] of lifelines.entries()) {
      const x = stride * index + 100;
      const g = this.boundGroup(line.binding, line.title, "lifeline");
      g.append(
        svg("line", { x1: x, y1: 56, x2: x, y2: height - 24, class: "sequence-lifeline" }),
        svg("rect", { x: x - 88, y: 16, width: 176, height: 40, rx: 5, class: "sequence-head" }),
        this.label(line.title, x, 41, "middle"),
      );
      chart.append(g);
      for (const event of line.children) {
        const order = rank.get(event.id)!;
        const y = 95 + 56 * order;
        points.set(event.id, { x, y });
        const group = this.boundGroup(event.binding, event.title, "event");
        group.setAttribute("data-rank", String(order));
        group.append(svg("circle", { cx: x, cy: y, r: 5, class: "sequence-event" }), this.label(event.title, x + 10, y + 4));
        eventGroups.push(group);
      }
    }
    for (const edge of scene.edges) {
      if (edge.notation !== "message") continue;
      const from = points.get(edge.source)!;
      const to = points.get(edge.target)!;
      const group = this.boundGroup(edge.binding, edge.label, "message");
      const coordinates = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
      group.append(
        svg("line", { ...coordinates, class: "sequence-hit" }),
        svg("line", { ...coordinates, class: "sequence-message", "marker-end": "url(#" + this.markerId + ")" }),
        this.label(edge.label, (from.x + to.x) / 2 + (from.x === to.x ? 16 : 0), (from.y + to.y) / 2 - 7, "middle"),
      );
      chart.append(group);
    }
    chart.append(...eventGroups);
    this.viewport.replaceChildren(chart);
    this.viewport.removeAttribute("aria-busy");
    this.stale = false;
    this.status(concurrent ? "Independent events are shown in one valid order." : "");
    this.highlight(this.selected);
  }

  private label(label: Label, x: number, y: number, anchor = "start") {
    const text = svg("text", { x, y, "text-anchor": anchor });
    text.textContent = labelText(label);
    return text;
  }

  private boundGroup(binding: Binding, label: Label, role: string) {
    const group = svg("g", {
      "data-sequence-role": role,
      role: "button",
      tabindex: 0,
      "aria-label": "Reveal " + role + " " + labelText(label),
    });
    const elements = this.selections.get(binding.elementId) ?? [];
    elements.push(group);
    this.selections.set(binding.elementId, elements);
    const reveal = () => {
      if (!this.stale) this.callbacks.select(binding, true);
    };
    group.onclick = reveal;
    group.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        reveal();
      }
    };
    return group;
  }
}
