import {separateUnsaved} from "./graph-graphics.ts";
import { own } from "./records.ts";
import { graphPresentation } from "./protocol.ts";
/** Client-only partition composition over the existing ELK adapter. */
import ELK from "elkjs/lib/elk.bundled.js";
import {
  labelText,
  type GraphScene,
  type Node,
  type Layout,
  type Presentation,
  type Geometry,
} from "./protocol.ts";
export async function partitionLayout(
  scene: GraphScene,
  presentation: Presentation,
  measure: (s: string) => number,
): Promise<Layout> {
  const elk = new ELK(),
    result: Layout = {
      revision: scene.revision,
      viewKey: scene.view.key,
      nodes: Object.create(null),
      regions: Object.create(null),
      ports: Object.create(null),
      edges: Object.create(null),
      minimum: Object.create(null),
    },
    saved = graphPresentation(presentation, scene.view.key)?.positions ?? {};
  const sizes = new Map<string, { width: number; height: number }>();
  async function block(nodes: Node[], left: number, top: number, root = false) {
    for (const n of nodes) await size(n);
    if (!nodes.length) return { width: 0, height: 0 };
    const laid = await elk.layout({
      id: `layout:${nodes[0].id}`,
      children: nodes.map((n) => ({ id: n.id, ...sizes.get(n.id)! })),
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": scene.layout.direction,
        "elk.spacing.nodeNode": "55",
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      },
    });
    let width = 0,
      height = 0;
    for (const n of laid.children ?? []) {
      const old = own(saved, n.id);
      const g = {
        x: root
          ? (old?.x ?? (n.x ?? 0) + left)
          : Math.max(left, old?.x ?? (n.x ?? 0) + left),
        y: root
          ? (old?.y ?? (n.y ?? 0) + top)
          : Math.max(top, old?.y ?? (n.y ?? 0) + top),
        width: n.width ?? 205,
        height: n.height ?? 70,
      };
      result.nodes[n.id] = g;

    }
    if(nodes.some(n=>own(saved,n.id)))separateUnsaved(nodes,result.nodes,saved,Math.max(55,scene.routing.stubLength+scene.routing.clearance*2));
    for(const n of nodes){const g=result.nodes[n.id];width=Math.max(width,g.x+g.width+left);height=Math.max(height,g.y+g.height+28);}
    return { width, height };
  }
  async function size(n: Node) {
    const rows = n.compartments.reduce(
        (v, c) => v + 23 + c.rows.length * 20,
        0,
      ),
      header = 76 + rows;
    const texts = [
      labelText(n.title),
      labelText(n.subtitle),
      ...n.ports.map((p) => labelText(p.label)),
      ...n.compartments.flatMap((c) => [
        c.label,
        ...c.rows.map((r) => labelText(r.label)),
      ]),
    ];
    let width = Math.max(205, ...texts.map((s) => measure(s) + 40)),
      height = header + 28;
    const direct = await block(n.children, 28, header);
    width = Math.max(width, direct.width);
    let regionTop = Math.max(
      header,
      direct.height ? direct.height + 12 : header,
    );
    const regions = n.regions?.items ?? [];
    const rSizes: { width: number; height: number }[] = [];
    for (const r of regions) {
      const children = await block(r.children, 20, 42);
      rSizes.push({
        width: Math.max(
          205,
          children.width + 20,
          measure(labelText(r.label)) + 28,
        ),
        height: Math.max(90, children.height + 20),
      });
    }
    // Separate partition outlines so each contextual endpoint can cross its own
    // gate without simultaneously crossing a neighboring partition at another gate.
    const gap = Math.max(20, scene.routing.clearance * 2 + 4), gaps = Math.max(0, regions.length - 1) * gap;
    const row = n.regions?.direction === "row";
    if (regions.length) {
      width = Math.max(
        width,
        (row
          ? rSizes.reduce((sum, r) => sum + r.width, 0) + gaps
          : Math.max(...rSizes.map((r) => r.width))) + 56,
      );
      height =
        regionTop +
        (row
          ? Math.max(...rSizes.map((r) => r.height))
          : rSizes.reduce((sum, r) => sum + r.height, 0) + gaps) +
        28;
    } else height = Math.max(height, direct.height);
    result.minimum[n.id] = { width, height };
    width = Math.max(width, saved[n.id]?.width ?? 0);
    height = Math.max(height, saved[n.id]?.height ?? 0);
    let cursor = 0;
    const extra = row
      ? (width - 56 - gaps - rSizes.reduce((sum, r) => sum + r.width, 0)) /
        Math.max(1, regions.length)
      : (height -
          regionTop -
          28 - gaps -
          rSizes.reduce((sum, r) => sum + r.height, 0)) /
        Math.max(1, regions.length);
    regions.forEach((r, i) => {
      const w = row ? rSizes[i].width + extra : width - 56,
        h = row ? height - regionTop - 28 : rSizes[i].height + extra;
      result.regions[r.id] = {
        x: 28 + (row ? cursor : 0),
        y: regionTop + (row ? 0 : cursor),
        width: w,
        height: h,
      };
      cursor += (row ? w : h) + gap;
    });
    sizes.set(n.id, { width, height });
  }
  await block(scene.nodes, 50, 40, true);
  function collect(nodes: Node[], x: number, y: number) {
    for (const n of nodes) {
      const g = result.nodes[n.id],
        a = { x: x + g.x, y: y + g.y };
      if (
        ![g.x, g.y, g.width, g.height, a.x, a.y].every(Number.isFinite) ||
        Math.max(Math.abs(a.x), Math.abs(a.y), a.x + g.width, a.y + g.height) >
          1_000_000
      )
        throw new Error("graph.layout.extent");
      const sides = new Map<string, number>();
      for (const p of n.ports) {
        const i = sides.get(p.side) ?? 0;
        sides.set(p.side, i + 1);
        const count = n.ports.filter((q) => q.side === p.side).length,
          f = (i + 1) / (count + 1);
        result.ports[p.id] = {
          x:
            a.x +
            (p.side === "WEST" ? 0 : p.side === "EAST" ? g.width : g.width * f),
          y:
            a.y +
            (p.side === "NORTH"
              ? 0
              : p.side === "SOUTH"
                ? g.height
                : g.height * f),
        };
      }
      collect(n.children, a.x, a.y);
      for (const r of n.regions?.items ?? []) {
        const v = result.regions[r.id];
        collect(r.children, a.x + v.x, a.y + v.y);
      }
    }
  }
  collect(scene.nodes, 0, 0);
  return result;
}
