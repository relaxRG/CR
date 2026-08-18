/**
 * 将一次需要用户确认的高风险操作限制为单飞执行。
 * 同一确认框未结束前，重复点击直接忽略；确认、取消或系统关闭后必须显式释放。
 */
export interface ResetActionGate {
  tryAcquire: () => boolean;
  release: () => void;
  isLocked: () => boolean;
}

export function createResetActionGate(): ResetActionGate {
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
