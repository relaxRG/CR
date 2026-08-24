export interface WineSupplierTrendLayout {
  mode: "compact" | "regular" | "expanded";
  maxBars: number;
  chartHeight: number;
  columns: number;
}

export function resolveWineSupplierTrendLayout(width: number): WineSupplierTrendLayout {
  if (width < 560) return { mode: "compact", maxBars: 3, chartHeight: 260, columns: 1 };
  if (width < 900) return { mode: "regular", maxBars: 5, chartHeight: 300, columns: 1 };
  return { mode: "expanded", maxBars: 6, chartHeight: 340, columns: 2 };
}
