import { describe, expect, it } from "vitest";
import {
  expandStoreTableColumns,
  formatStoreMoney,
  formatStorePercentage,
  formatStoreQuantity,
  getStoreTableViewport,
  STORE_TABLE_METRICS,
} from "@/lib/store/table-display";

describe("门店台账显示规范", () => {
  it("以完整两位小数显示金额、数量和百分比", () => {
    expect(formatStoreMoney(13248.6)).toBe("¥13,248.60");
    expect(formatStoreMoney(0)).toBe("¥0.00");
    expect(formatStoreQuantity(178)).toBe("178.00");
    expect(formatStoreQuantity(0.5)).toBe("0.50");
    expect(formatStorePercentage(100)).toBe("100.00%");
    expect(formatStoreMoney(undefined)).toBe("—");
  });

  it("在手机和平板保持最小可读列宽，在桌面按权重填满可用宽度", () => {
    const columns = [
      { key: "identity", width: 200, flexWeight: 3 },
      { key: "quantity", width: 90, flexWeight: 1 },
      { key: "amount", width: 110, flexWeight: 2 },
    ];
    expect(getStoreTableViewport(639)).toBe("phone");
    expect(getStoreTableViewport(640)).toBe("tablet");
    expect(getStoreTableViewport(1024)).toBe("desktop");
    expect(expandStoreTableColumns(columns, 834)).toEqual(columns);

    const desktop = expandStoreTableColumns(columns, 1400);
    expect(desktop.reduce((total, column) => total + column.width, 0)).toBe(1400);
    expect(desktop[0].width).toBeGreaterThan(desktop[1].width);
    expect(desktop[2].width).toBeGreaterThan(desktop[1].width);
  });

  it("维持统一的紧凑可读行高，防止库存台账再次出现高低不齐", () => {
    expect(STORE_TABLE_METRICS.headerHeight).toBe(48);
    expect(STORE_TABLE_METRICS.rowHeight).toBe(46);
    expect(STORE_TABLE_METRICS.groupHeight).toBe(34);
    expect(STORE_TABLE_METRICS.summaryHeaderHeight).toBe(42);
    expect(STORE_TABLE_METRICS.summaryRowHeight).toBe(40);
  });
});
