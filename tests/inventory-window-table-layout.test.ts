import { describe, expect, it } from "vitest";
import {
  resolveInventoryTableWindowLayout,
  scaleInventoryTableWidths,
} from "@/lib/store/inventory-workspace-ui";

describe("库存 Excel 表格窗口响应式轨道", () => {
  it("iPhone 与 iPad 分屏在可用宽度不足时保持紧凑基准轨道并局部横滑", () => {
    const phone = resolveInventoryTableWindowLayout(375, 978, 24);
    const splitIpad = resolveInventoryTableWindowLayout(744, 978, 24);

    expect(phone).toMatchObject({ density: "compact", scale: 1, tableWidth: 978, expanded: false });
    expect(splitIpad).toMatchObject({ density: "compact", scale: 1, tableWidth: 978, expanded: false });
  });

  it("iPad 宽窗口与 Mac 缩放窗口按实时可用宽度扩展同一列轨道", () => {
    const wideIpad = resolveInventoryTableWindowLayout(1194, 978, 24);
    const mac = resolveInventoryTableWindowLayout(1728, 978, 24);

    expect(wideIpad.density).toBe("standard");
    expect(wideIpad.tableWidth).toBe(1170);
    expect(mac.density).toBe("expanded");
    expect(mac.tableWidth).toBe(1704);
    expect(mac.tableWidth).toBeGreaterThan(wideIpad.tableWidth);
  });

  it("名称、金额和集团列按相同比例同步伸展，避免表头、行和合计错位", () => {
    const layout = resolveInventoryTableWindowLayout(1500, 500, 24);
    const widths = scaleInventoryTableWidths({ name: 112, amount: 66, group: 64 }, layout.scale);

    expect(widths).toEqual({ name: 331, amount: 195, group: 189 });
    expect(widths.name / 112).toBeCloseTo(layout.scale, 2);
    expect(widths.amount / 66).toBeCloseTo(layout.scale, 2);
    expect(widths.group / 64).toBeCloseTo(layout.scale, 2);
  });
});
