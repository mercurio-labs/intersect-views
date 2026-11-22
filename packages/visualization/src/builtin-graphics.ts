/** Legacy notation v1 is an adapter to the same checked geometry renderer.
 * Its closed color-token vocabulary retains the application's existing theme. */
import { GraphicDefinitions, type GraphicGeometry, type SymbolLibrary } from "./graphics-contract.ts";
import { layoutGraphic } from "./graphics-layout.ts";
import { color, type NodeStyle } from "./notation.ts";

export function builtinBody(style: NodeStyle, width: number, height: number, owner="builtin:body"): string {
  const geometry: GraphicGeometry = style.shape === "ellipse"
    ? { kind:"ellipse", width, height }
    : style.shape === "diamond"
      ? { kind:"polyline", width, height, closed:true, points:[{x:width/2,y:0},{x:width,y:height/2},{x:width/2,y:height},{x:0,y:height/2}] }
      : { kind:"rectangle", width, height, radius:style.shape==="rounded" ? style.radius??8 : 0 };
  const library: SymbolLibrary = { schemaVersion:1,id:"intersect.builtin",imports:[],definitions:[{
    id:"intersect.builtin/body",version:"1",role:"node",parameters:{},slots:{},connectionAnchor:null,
    root:{id:"body",when:null,anchors:[],content:{kind:"geometry",geometry,fill:"#010101",stroke:"#020202",strokeWidth:1}},
  }] };
  const drawing=layoutGraphic(new GraphicDefinitions([library]),{definition:"intersect.builtin/body",parameters:{},slots:{}},owner,{},width,()=>0);
  const root=/^<g data-graphic-part="([^"]*)">([\s\S]*)<\/g>$/.exec(drawing.markup);
  if(!root)throw Error("Invalid built-in geometry result");
  return root[2].replace(/<(rect|ellipse|polygon) /, `<$1 class="node-body" data-graphic-part="${root[1]}" `)
    .replace("fill:#010101;stroke:#020202",`fill:${color(style.fill)};stroke:${color(style.stroke)}`);
}
