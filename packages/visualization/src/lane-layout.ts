import type { LaneGraphScene, Geometry } from "./protocol.ts";
export interface LaneLayout {
  steps: Map<string, Geometry>;
  lanes: Map<string, Geometry>;
  spans: Map<string, Geometry>;
  width: number;
  height: number;
  slot: number;
  header: number;
  band: number;
  laneOrder: string[];
}
export function orderedLanes(scene: LaneGraphScene, saved: string[]): string[] {
  const known = new Set(scene.lanes.map((l) => l.id));
  return [
    ...saved.filter((id) => known.has(id)),
    ...scene.lanes.map((l) => l.id).filter((id) => !saved.includes(id)),
  ];
}
export function checkLaneOrder(scene: LaneGraphScene, order: string[]): void {
  if (
    order.length !== scene.lanes.length ||
    new Set(order).size !== order.length ||
    scene.lanes.some((l) => !order.includes(l.id))
  )
    throw Error("Lane order must contain every visible lane once");
  for (const span of scene.spans) {
    const ranks = span.lanes
      .map((id) => order.indexOf(id))
      .sort((a, b) => a - b);
    if (ranks.some((r, i) => i > 0 && r !== ranks[i - 1] + 1))
      throw Error("This lane reorder would split a span's contiguous bands");
  }
}
export function laneLayout(
  scene: LaneGraphScene,
  order: string[],
  measure: (s: string) => number,
): LaneLayout {
  checkLaneOrder(scene, order);
  const vertical = scene.axis.direction === "vertical";
  const width = (label: LaneGraphScene["steps"][number]["label"]) =>
    label.parts.reduce(
      (n, p) => n + Math.max(p.binding ? 8 : 0, measure(p.text)),
      0,
    );
  const widths = new Map(
    scene.steps.map((s) => [s.id, Math.max(100, width(s.label) + 32)]),
  );
  const maxWidth = Math.max(100, ...widths.values()),
    laneWidth = Math.max(100, ...scene.lanes.map((l) => width(l.label) + 60));
  const tracks: number[] = [];
  const step = (id: string) => {
    const s = scene.steps.find((s) => s.id === id);
    if (!s) throw Error("Missing layout Step");
    return s;
  };
  const overlaps = (
    a: (typeof scene.spans)[number],
    b: (typeof scene.spans)[number],
  ) =>
    step(a.step).rank <= step(b.end).rank &&
    step(b.step).rank <= step(a.end).rank &&
    a.lanes.some((l) => b.lanes.includes(l));
  scene.spans.forEach((s, i) => {
    let track = 0;
    while (
      scene.spans
        .slice(0, i)
        .some((p, j) => tracks[j] === track && overlaps(s, p))
    )
      track++;
    tracks.push(track);
  });
  const band = Math.max(
      vertical ? Math.max(maxWidth + 40, laneWidth) : 120,
      60 + (Math.max(-1, ...tracks) + 1) * 22,
    ),
    header = vertical ? 80 : laneWidth,
    slot = vertical ? 120 : maxWidth + 50;
  const steps = new Map<string, Geometry>(),
    lanes = new Map<string, Geometry>(),
    spans = new Map<string, Geometry>();
  for (const l of scene.lanes) {
    const cross = 40 + order.indexOf(l.id) * band;
    lanes.set(
      l.id,
      vertical
        ? { x: cross, y: 0, width: band, height: header }
        : { x: 0, y: cross, width: header, height: band },
    );
  }
  for (const s of scene.steps) {
    const cross = 40 + order.indexOf(s.lane) * band,
      u = header + s.rank * slot + 20,
      w = widths.get(s.id)!;
    steps.set(
      s.id,
      vertical
        ? { x: cross + (band - w) / 2, y: u, width: w, height: 44 }
        : { x: u, y: cross + (band - 44) / 2, width: w, height: 44 },
    );
  }
  scene.spans.forEach((s, i) => {
    const start = step(s.step),
      end = step(s.end),
      indices = s.lanes.map((l) => order.indexOf(l)),
      cross = 40 + Math.min(...indices) * band,
      extent = (Math.max(...indices) - Math.min(...indices) + 1) * band,
      u = header + start.rank * slot + 8,
      length = (end.rank - start.rank + 1) * slot - 16,
      offset = 10 + tracks[i] * 18;
    spans.set(
      s.id,
      vertical
        ? {
            x: cross + offset,
            y: u,
            width: extent - offset - 8,
            height: length,
          }
        : {
            x: u,
            y: cross + offset,
            width: length,
            height: extent - offset - 8,
          },
    );
  });
  const semantic = header + Math.max(1, scene.steps.length) * slot + 40,
    cross = 40 + Math.max(1, scene.lanes.length) * band;
  return {
    steps,
    lanes,
    spans,
    width: vertical ? cross : semantic,
    height: vertical ? semantic : cross,
    slot,
    header,
    band,
    laneOrder: order,
  };
}
