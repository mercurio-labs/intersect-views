export const autoLayouts = [
  { id: "layered", label: "Layered" },
  { id: "top-down", label: "Top to bottom" },
  { id: "packed", label: "Compact packing" },
] as const;

export type AutoLayout = (typeof autoLayouts)[number]["id"];
