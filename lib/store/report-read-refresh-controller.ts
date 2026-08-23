export type ReportReadRefreshTicket = Readonly<{ generation: number }>;

/**
 * 只保留最后一次报表快照读取的提交资格。
 * AsyncStorage 读取无法中断；因此旧读取完成后只能被废弃，绝不能回写到已切换的报表边界。
 */
export function createReportReadRefreshController() {
  let generation = 0;
  let disposed = false;

  return Object.freeze({
    begin(): ReportReadRefreshTicket {
      if (disposed) throw new Error("报告快照刷新控制器已释放");
      generation += 1;
      return Object.freeze({ generation });
    },
    isCurrent(ticket: ReportReadRefreshTicket): boolean {
      return !disposed && ticket.generation === generation;
    },
    dispose(): void {
      disposed = true;
      generation += 1;
    },
    snapshot(): Readonly<{ generation: number; disposed: boolean }> {
      return Object.freeze({ generation, disposed });
    },
  });
}
