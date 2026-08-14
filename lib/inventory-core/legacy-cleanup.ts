export type LegacyInventoryRecord = Record<string, unknown>;

/**
 * 库存预警已从业务模型移除。所有历史记录在进入当前状态树前均通过此函数
 * 丢弃旧字段，其他库存、损耗、采购与成本字段保持原样。
 */
export function stripLegacyInventoryAlertThreshold<T extends LegacyInventoryRecord>(record: T): Omit<T, "alertThreshold"> {
  const { alertThreshold: _legacyAlertThreshold, ...currentRecord } = record;
  return currentRecord;
}
