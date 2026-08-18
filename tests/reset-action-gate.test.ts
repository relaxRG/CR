import { describe, expect, it } from "vitest";
import { createResetActionGate } from "@/lib/store/monthly-report/reset-action-gate";

describe("经营分析重置单飞门闩", () => {
  it("确认框存续期间只允许一次触发，释放后才允许下一次按月重置", () => {
    const gate = createResetActionGate();

    expect(gate.isLocked()).toBe(false);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.isLocked()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.release();
    expect(gate.isLocked()).toBe(false);
    expect(gate.tryAcquire()).toBe(true);
  });
});
