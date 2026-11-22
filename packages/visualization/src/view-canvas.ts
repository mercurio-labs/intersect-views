import { validatePresentation } from "./protocol.ts";
import { LaneCanvas } from "./lane.ts";
import { DiagramCanvas, type Callbacks } from "./canvas.ts";
import { GridCanvas } from "./grid.ts";
import type {
  SceneResponse,
  View,
  Presentation,
  NotationProfile,
} from "./protocol.ts";
/** Form routing only; session transactions and semantic work stay outside DOM. */
export class ViewCanvas {
  whenReady(): Promise<void> { return this.form==="graph"?this.graph.whenReady():Promise.resolve(); }
  destroy() {
    this.graph.destroy();
    this.graphRoot.remove(); this.gridRoot.remove(); this.laneRoot.remove();
  }
  private graphRoot = document.createElement("div");
  private gridRoot = document.createElement("div");
  private laneRoot = document.createElement("div");
  private lane: LaneCanvas;
  private graph: DiagramCanvas;
  private grid: GridCanvas;
  private form = "graph";
  constructor(
    root: HTMLElement,
    private callbacks: Callbacks,
  ) {
    for (const node of [this.graphRoot, this.gridRoot, this.laneRoot]) {
      node.style.height = "100%";
      root.append(node);
    }
    this.graph = new DiagramCanvas(this.graphRoot, callbacks);
    this.grid = new GridCanvas(this.gridRoot, callbacks);
    this.lane = new LaneCanvas(this.laneRoot, callbacks);
    this.laneRoot.hidden = true;
    this.laneRoot.style.display = "none";
    this.gridRoot.hidden = true;
    this.gridRoot.style.display = "none";
  }
  views(views: View[], selected: string) {
    this.graph.views(views, selected);
    this.grid.views(views, selected);
    this.lane.views(views, selected);
  }
  requestView(key: string) {
    this.graph.requestView(key);
    this.grid.requestView(key);
    this.lane.requestView(key);
  }
  setScene(response: SceneResponse) {
    this.form = response.scene.form;
    this.graphRoot.hidden = this.form !== "graph";
    this.gridRoot.hidden = this.form !== "grid";
    this.laneRoot.hidden = this.form !== "laneGraph";
    this.laneRoot.style.display = this.laneRoot.hidden ? "none" : "";
    this.graphRoot.style.display = this.graphRoot.hidden ? "none" : "";
    this.gridRoot.style.display = this.gridRoot.hidden ? "none" : "";
    this.lane.setStale();
    if (response.scene.form === "graph") {
      this.grid.setStale();
      this.graph.setScene({ ...response, scene: response.scene });
    } else if (response.scene.form === "grid") {
      this.graph.setStale();
      this.grid.setScene({ ...response, scene: response.scene });
    } else {
      this.graph.setStale();
      this.grid.setStale();
      this.lane.setScene({ ...response, scene: response.scene });
    }
  }
  setStale() {
    this.graph.setStale();
    this.grid.setStale();
    this.lane.setStale();
  }
  status(message: string) {
    (this.form === "graph"
      ? this.graph
      : this.form === "grid"
        ? this.grid
        : this.lane
    ).status(message);
  }
  highlight(id: string | null) {
    (this.form === "graph"
      ? this.graph
      : this.form === "grid"
        ? this.grid
        : this.lane
    ).highlight(id);
  }
  setPresentation(value: Presentation) {
    validatePresentation(value);
    this.graph.setPresentation(value);
    this.lane.setPresentation(value);
  }
  setNotation(value: NotationProfile) {
    this.graph.setNotation(value);
    this.lane.setNotation(value);
  }
  addSeed(key: string) {
    this.callbacks.scope?.({ op: "addSeed", element: key });
  }
}
