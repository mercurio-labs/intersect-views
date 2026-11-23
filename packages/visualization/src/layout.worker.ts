import type { AutoLayout } from "./layout-options.ts";
import {validateNotation,type NotationProfile} from "./notation.ts";
import { own } from "./records.ts";
import { graphPresentation } from "./protocol.ts";
import { partitionLayout } from "./partition-layout.ts";
import { labelText } from "./protocol.ts";
import { hasGraphics, graphicGraphLayout,separateUnsaved } from "./graph-graphics.ts";
import { routeMeasuredLayout } from "./routing-layout.ts";
import { RoutingFailure } from "./routing.ts";
import type { PresentationContext } from "./graphics-contract.ts";
/// <reference lib="webworker" />
/** Generic layout adapter. All semantic selection happens upstream. */
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type {
  GraphScene as Scene,
  Node,
  Layout,
  Geometry,
  Presentation,
} from "./protocol";
const elk = new ELK();
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({
  data,
}: MessageEvent<{ id: number; scene: Scene; presentation: Presentation; context: PresentationContext;notation?:NotationProfile; autoLayout?: AutoLayout }>) => {
  const { id, scene, presentation, context: presentationContext,notation, autoLayout } = data;
  const packed = autoLayout === "packed";
  const placement = {
    "elk.algorithm": packed ? "box" : "layered",
    "elk.direction": autoLayout === "top-down" ? "DOWN" : scene.layout.direction,
  };
  try {
    if(notation)validateNotation(notation);
    const canvas = new OffscreenCanvas(1, 1),
      context = canvas.getContext("2d");
    if (context) context.font = "600 14px system-ui";
    const measure = (s: string) =>
      context?.measureText(s).width ?? s.length * 9;
    const measureGraphic = (s: string, size: number, weight: number, italic: boolean) => {
      if (context) context.font = `${italic ? "italic " : ""}${weight} ${size}px system-ui`;
      return context?.measureText(s).width ?? s.length * size * .65;
    };
    const publish = (layout:Layout) => {
      const result=routeMeasuredLayout(scene,layout,presentation,presentationContext,{
        revision:scene.revision,viewKey:scene.view.key,scopeIdentity:`layout:${id}`,
        packageFingerprint:presentationContext.fingerprint,generation:id,
      },measureGraphic,notation);
      scope.postMessage({id,result});
    };
    if (hasGraphics(scene.nodes)) {
      const result = await graphicGraphLayout(scene, presentation, presentationContext, measureGraphic, async (nodes, edges) => {
        const graph = await elk.layout({ id: "graphic-root", children: nodes, edges: packed ? [] : edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })), layoutOptions: { ...placement, "elk.spacing.nodeNode": "65", "elk.padding": "[top=35,left=35,bottom=35,right=35]" } });
        return graph.children ?? [];
      });
      publish(result); return;
    }
    const hasRegions = (nodes: Node[]): boolean =>
      nodes.some(
        (n) => (n.regions?.items.length ?? 0) > 0 || hasRegions(n.children),
      );
    if (hasRegions(scene.nodes)) {
      publish(await partitionLayout(scene, presentation, measure, placement));
      return;
    }
    const saved =
      graphPresentation(presentation, scene.view.key)?.positions ?? {};
    // ELK places visible shapes. The router below uses the actual proxy IDs
    // once it can measure their anchors on the collapsed owners.
    const proxyOwners = new Map(
      scene.endpointProxies.map(({ id, displayOwner }) => [id, displayOwner]),
    );
    const edgeList: ElkExtendedEdge[] = scene.edges.map((e) => ({
      id: e.id,
      sources: [proxyOwners.get(e.source) ?? e.source],
      targets: [proxyOwners.get(e.target) ?? e.target],
      labels: e.label
        ? [
            {
              text: labelText(e.label),
              width: measure(labelText(e.label)) + 10,
              height: 16,
            },
          ]
        : [],
    }));
    const toElk = (node: Node): ElkNode => {
      const rows = node.compartments.reduce(
        (sum, c) => sum + 20 + c.rows.length * 20,
        0,
      );
      const longest = Math.max(
        measure(labelText(node.title)),
        measure(labelText(node.subtitle)),
        ...node.ports.map((p) => measure(labelText(p.label)) + 24),
        ...node.compartments.flatMap((c) => [
          measure(c.label),
          ...c.rows.map((r) => measure(labelText(r.label))),
        ]),
        18,
      );
      return {
        id: node.id,
        width: Math.max(205, longest + 28),
        height: 56 + rows + (node.ports.length ? 28 : 0),
        children: node.children.map(toElk),
        ports: node.ports.map((p, i) => ({
          id: p.id,
          width: 12,
          height: 12,
          layoutOptions: {
            "elk.port.side": p.side,
            "elk.port.index": String(i),
          },
        })),
        layoutOptions: {
          ...placement,
          "elk.padding": `[top=${64 + rows},left=28,bottom=38,right=28]`,
          "elk.portConstraints": "FIXED_SIDE",
          "elk.spacing.nodeNode": "55",
        },
      };
    };
    const graph = await elk.layout({
      id: "root",
      children: scene.nodes.map(toElk),
      edges: packed ? [] : edgeList,
      layoutOptions: {
        ...placement,
        "elk.hierarchyHandling": packed ? "SEPARATE_CHILDREN" : "INCLUDE_CHILDREN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "65",
        "elk.layered.spacing.nodeNodeBetweenLayers": "85",
        "elk.padding": "[top=40,left=50,bottom=40,right=50]",
      },
    });
    const result: Layout = {
      revision: scene.revision,
      viewKey: scene.view.key,
      nodes: Object.create(null),
      ports: Object.create(null),
      edges: Object.create(null),
      regions: Object.create(null),
      minimum: Object.create(null),
    };
    const collect = (node: ElkNode, parentX: number, parentY: number) => {
      const g: Geometry = {
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? 200,
        height: node.height ?? 70,
      };
      result.minimum[node.id] = { width: g.width, height: g.height };
      const previous = own(saved, node.id);
      if (previous) {
        g.x = previous.x;
        g.y = previous.y;
        g.width = Math.max(g.width, previous.width);
        g.height = Math.max(g.height, previous.height);
      }
      if (
        ![g.x, g.y, g.width, g.height, parentX + g.x, parentY + g.y].every(
          Number.isFinite,
        ) ||
        Math.max(
          Math.abs(parentX + g.x),
          Math.abs(parentY + g.y),
          parentX + g.x + g.width,
          parentY + g.y + g.height,
        ) > 1_000_000
      )
        throw new Error("graph.layout.extent");
      // Persisted positions are local to visual parents, not to the semantic model.
      result.nodes[node.id] = g;
      for (const port of node.ports ?? [])
        result.ports[port.id] = {
          x: g.x + parentX + (port.x ?? 0) + 6,
          y: g.y + parentY + (port.y ?? 0) + 6,
        };
      for (const child of node.children ?? [])
        collect(child, parentX + g.x, parentY + g.y);
    };
    for (const node of graph.children ?? []) collect(node, 0, 0);
    // Saved siblings survive a source edit. Newly introduced automatic symbols
    // must be placed around them before routing, rather than overlapping an old
    // terminal while waiting for a client-side placement correction.
    const reconcile=(nodes:Node[])=>{
      for(const node of nodes){reconcile(node.children);const g=result.nodes[node.id];if(node.children.length){g.width=Math.max(g.width,...node.children.map(c=>result.nodes[c.id].x+result.nodes[c.id].width+28));g.height=Math.max(g.height,...node.children.map(c=>result.nodes[c.id].y+result.nodes[c.id].height+38));}}
      if(nodes.some(n=>own(saved,n.id)))separateUnsaved(nodes,result.nodes,saved,Math.max(55,scene.routing.stubLength+scene.routing.clearance*2));
    };reconcile(scene.nodes);
    const locatePorts=(nodes:Node[],at:{x:number;y:number})=>{for(const n of nodes){const g=result.nodes[n.id],a={x:at.x+g.x,y:at.y+g.y};for(const side of ["NORTH","SOUTH","WEST","EAST"]){const ports=n.ports.filter(p=>p.side===side);ports.forEach((p,i)=>{const f=(i+1)/(ports.length+1);result.ports[p.id]={x:a.x+(side==="WEST"?0:side==="EAST"?g.width:g.width*f),y:a.y+(side==="NORTH"?0:side==="SOUTH"?g.height:g.height*f)};});}locatePorts(n.children,a);}};locatePorts(scene.nodes,{x:0,y:0});
    // ELK positions only. Routing consumes the final measured/saved geometry.
    publish(result);
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      diagnostics:error instanceof RoutingFailure?[{code:error.code,edgeIds:error.edgeIds,partIds:error.partIds}]:[],
    });
  }
};
