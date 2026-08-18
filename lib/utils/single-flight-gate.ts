/**
 * 将同一高风险交互限制为单飞执行。
 * 在异步任务、确认弹窗或状态提交完成前，后续触发会被忽略；调用方必须在 finally 中释放门闩。
 */
export interface SingleFlightGate {
  tryAcquire: () => boolean;
  release: () => void;
  isLocked: () => boolean;
}

export function createSingleFlightGate(): SingleFlightGate {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}
