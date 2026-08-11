/**
 * 单客户端、同一月份的同步互斥守卫。
 *
 * AsyncStorage 没有跨键事务；月度归档动作会同步修改归档、调整会话以及派生数据。
 * 该守卫在 React 事件层阻止同月重复点击或重入。跨设备互斥必须由服务端
 * Compare-and-Swap / D1 事务实现，不能由客户端替代。
 */
export function createMonthCloseOperationGate() {
  const activeMonths = new Set<string>();

  return {
    tryAcquire(month: string): boolean {
      if (activeMonths.has(month)) return false;
      activeMonths.add(month);
      return true;
    },
    release(month: string): void {
      activeMonths.delete(month);
    },
    isActive(month: string): boolean {
      return activeMonths.has(month);
    },
    runExclusive<T>(month: string, operation: () => T): T | null {
      if (!this.tryAcquire(month)) return null;
      try {
        return operation();
      } finally {
        this.release(month);
      }
    },
  };
}
