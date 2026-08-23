import { describe, expect, it } from "vitest";
import { createReportReadRefreshController } from "@/lib/store/report-read-refresh-controller";

describe("报表快照刷新控制器", () => {
  it("只允许最后一次重叠读取提交结果", () => {
    const controller = createReportReadRefreshController();
    const first = controller.begin();
    const second = controller.begin();

    expect(controller.isCurrent(first)).toBe(false);
    expect(controller.isCurrent(second)).toBe(true);
    expect(controller.snapshot()).toEqual({ generation: 2, disposed: false });
  });

  it("卸载后使所有未完成读取失效且拒绝启动新的读取", () => {
    const controller = createReportReadRefreshController();
    const ticket = controller.begin();

    controller.dispose();

    expect(controller.isCurrent(ticket)).toBe(false);
    expect(controller.snapshot()).toEqual({ generation: 2, disposed: true });
    expect(() => controller.begin()).toThrow("已释放");
  });
});
