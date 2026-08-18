import { describe, expect, it } from "vitest";
import { createSingleFlightGate } from "@/lib/utils/single-flight-gate";

describe("高风险操作单飞门闩", () => {
  it("任务执行期间只允许一次触发，释放后才允许下一次操作", () => {
    const gate = createSingleFlightGate();

    expect(gate.isLocked()).toBe(false);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.isLocked()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.release();
    expect(gate.isLocked()).toBe(false);
    expect(gate.tryAcquire()).toBe(true);
  });
});
