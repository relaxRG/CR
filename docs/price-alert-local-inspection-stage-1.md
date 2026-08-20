# 第一阶段：本机价格异常巡检与告警账本

## 目标与边界

第一阶段只在本机发现、持久化和同步价格异常；不调用外部比价服务，不自动覆盖渠道价格、成本基准、采购原文或已归档月份快照。它读取现有 `Bottle.supplierChannels`、`costChannelId`、`SupplierChannel.priceHistory` 和已确认采购记录，并写入独立同步键 `bottles.price-alerts.v1`。

> 价格异常是需要人工确认的业务事实，不是自动修正指令。

## 1. 类型与账本

```ts
// lib/bottles/price-alerts.ts
import type { Bottle, SupplierChannel } from "./types";

export type PriceAlertSeverity = "data_review" | "notice" | "attention" | "critical" | "missing";
export type PriceAlertStatus = "open" | "acknowledged" | "suppressed" | "resolved" | "voided";
export type PriceAlertRule =
  | "invalid_quote"
  | "unit_changed"
  | "channel_unmatched"
  | "cost_basis_missing"
  | "cost_basis_stale"
  | "previous_quote_delta"
  | "median_quote_delta";

export interface PriceAlert {
  id: string;
  /** bottle + channel + 价格历史版本 + 规则；同一异常永远只有一条 */
  fingerprint: string;
  bottleId: string;
  channelId?: string;
  rule: PriceAlertRule;
  severity: PriceAlertSeverity;
  status: PriceAlertStatus;
  price: number | null;
  referencePrice: number | null;
  delta: number | null;
  deltaPercent: number | null;
  unit?: string;
  detail: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  detectedCount: number;
  source: "channel_edit" | "purchase_import" | "manual_purchase" | "cost_basis_change" | "recovery_scan";
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolution?: "confirmed_change" | "temporary_promotion" | "corrected_input" | "ignored_once";
  suppressionUntil?: string;
  operationId?: string;
  version: number;
}

export interface PriceAlertLedger {
  schemaVersion: 1;
  updatedAt: string;
  alerts: PriceAlert[];
}

export const PRICE_ALERTS_KEY = "bottles.price-alerts.v1";
```

## 2. 规则配置与价格历史归一化

```ts
export interface PriceAlertPolicy {
  noticePercent: number;      // 0.05
  noticeAbsolute: number;     // ¥5
  attentionPercent: number;   // 0.15
  attentionAbsolute: number;  // ¥15
  criticalPercent: number;    // 0.30
  criticalAbsolute: number;   // ¥30
  staleDays: number;          // 90
  medianHistoryCount: number; // 6
}

export const DEFAULT_PRICE_ALERT_POLICY: PriceAlertPolicy = {
  noticePercent: 0.05,
  noticeAbsolute: 5,
  attentionPercent: 0.15,
  attentionAbsolute: 15,
  criticalPercent: 0.30,
  criticalAbsolute: 30,
  staleDays: 90,
  medianHistoryCount: 6,
};

function validHistory(channel: SupplierChannel) {
  return [...(channel.priceHistory ?? [])]
    .filter((entry) => Number.isFinite(entry.price) && entry.price > 0 && entry.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function severityFor(
  current: number,
  reference: number,
  policy: PriceAlertPolicy,
): PriceAlertSeverity | null {
  const delta = Math.abs(current - reference);
  const percent = reference > 0 ? delta / reference : 0;
  if (percent >= policy.criticalPercent && delta >= policy.criticalAbsolute) return "critical";
  if (percent >= policy.attentionPercent && delta >= policy.attentionAbsolute) return "attention";
  if (percent >= policy.noticePercent && delta >= policy.noticeAbsolute) return "notice";
  return null;
}
```

## 3. 单渠道巡检：只创建可解释的候选告警

```ts
export function inspectChannel(
  bottle: Bottle,
  channel: SupplierChannel,
  source: PriceAlert["source"],
  policy = DEFAULT_PRICE_ALERT_POLICY,
): Omit<PriceAlert, "id" | "firstDetectedAt" | "lastDetectedAt" | "detectedCount" | "status" | "version">[] {
  const now = new Date().toISOString();
  const base = {
    bottleId: bottle.id,
    channelId: channel.id,
    source,
    unit: channel.unit,
    operationId: undefined,
  };
  const current = Number(channel.latestPrice);
  if (!Number.isFinite(current) || current <= 0) {
    return [{ ...base, rule: "invalid_quote", severity: "data_review", price: null, referencePrice: null, delta: null, deltaPercent: null, detail: "渠道价格或数量无效，不能进入成本计算。", fingerprint: `${bottle.id}:${channel.id}:invalid_quote` }];
  }

  const history = validHistory(channel);
  if (channel.isCostBasis && history.length === 0) {
    return [{ ...base, rule: "cost_basis_missing", severity: "data_review", price: current, referencePrice: null, delta: null, deltaPercent: null, detail: "成本基准渠道没有有效报价历史，需人工确认首次基准。", fingerprint: `${bottle.id}:${channel.id}:cost_basis_missing` }];
  }

  const candidates: Omit<PriceAlert, "id" | "firstDetectedAt" | "lastDetectedAt" | "detectedCount" | "status" | "version">[] = [];
  const previous = history.length >= 2 ? history[history.length - 2].price : null;
  const referenceSet = history.slice(-policy.medianHistoryCount - 1, -1).map((entry) => entry.price);
  const medianPrice = median(referenceSet);

  for (const [rule, reference] of [["previous_quote_delta", previous], ["median_quote_delta", medianPrice]] as const) {
    if (reference === null) continue;
    const severity = severityFor(current, reference, policy);
    if (!severity) continue;
    const delta = current - reference;
    candidates.push({
      ...base,
      rule,
      severity,
      price: current,
      referencePrice: reference,
      delta,
      deltaPercent: reference > 0 ? delta / reference : null,
      detail: rule === "previous_quote_delta"
        ? `当前报价较上次有效报价变化 ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}。`
        : `当前报价偏离近期开奖价中位数 ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}。`,
      // 价格历史最后更新时间是版本；同一次变更不会重复告警
      fingerprint: `${bottle.id}:${channel.id}:${rule}:${history.at(-1)?.date ?? now}:${current}`,
    });
  }
  return candidates;
}
```

## 4. 指纹去重与状态保留

```ts
export function upsertInspectionAlerts(
  ledger: PriceAlertLedger,
  candidates: ReturnType<typeof inspectChannel>,
  now = new Date().toISOString(),
): PriceAlertLedger {
  const alerts = [...ledger.alerts];
  for (const candidate of candidates) {
    const index = alerts.findIndex((entry) => entry.fingerprint === candidate.fingerprint);
    if (index < 0) {
      alerts.push({
        ...candidate,
        id: crypto.randomUUID(),
        status: "open",
        firstDetectedAt: now,
        lastDetectedAt: now,
        detectedCount: 1,
        version: 1,
      });
      continue;
    }
    const prior = alerts[index];
    // suppressed 有效期内不重新弹出；resolved/voided 不被重复导入重新打开。
    const suppressed = prior.status === "suppressed" && prior.suppressionUntil && prior.suppressionUntil > now;
    alerts[index] = {
      ...prior,
      ...candidate,
      status: suppressed ? "suppressed" : prior.status,
      lastDetectedAt: now,
      detectedCount: prior.detectedCount + 1,
      version: prior.version + 1,
    };
  }
  return { schemaVersion: 1, updatedAt: now, alerts };
}

export function resolvePriceAlert(
  ledger: PriceAlertLedger,
  id: string,
  resolution: NonNullable<PriceAlert["resolution"]>,
  actorId: string,
  suppressionUntil?: string,
): PriceAlertLedger {
  return {
    ...ledger,
    updatedAt: new Date().toISOString(),
    alerts: ledger.alerts.map((alert) => alert.id !== id ? alert : {
      ...alert,
      status: resolution === "temporary_promotion" ? "suppressed" : "acknowledged",
      resolution,
      acknowledgedBy: actorId,
      acknowledgedAt: new Date().toISOString(),
      suppressionUntil,
      version: alert.version + 1,
    }),
  };
}
```

## 5. 本机事件接入

```ts
// lib/bottles/store.tsx：统一写入点。保存渠道后永远先规范化，再巡检。
async function commitChannelChange(
  bottleBefore: Bottle,
  bottleAfter: Bottle,
  source: PriceAlert["source"],
) {
  const changedChannels = bottleAfter.supplierChannels.filter((next) => {
    const prior = bottleBefore.supplierChannels.find((entry) => entry.id === next.id);
    return !prior || prior.latestPrice !== next.latestPrice || prior.unit !== next.unit || prior.isCostBasis !== next.isCostBasis;
  });

  let ledger = await loadPriceAlertLedger();
  for (const channel of changedChannels) {
    ledger = upsertInspectionAlerts(ledger, inspectChannel(bottleAfter, channel, source));
  }
  await AsyncStorage.multiSet([
    [BOTTLES_KEY, JSON.stringify(nextBottles)],
    [PRICE_ALERTS_KEY, JSON.stringify(ledger)],
  ]);
  notifySyncChange(BOTTLES_KEY);
  notifySyncChange(PRICE_ALERTS_KEY);
}

// Excel/PDF/手动采购确认完成后：只对唯一关联且非归档酒款创建候选。
function onConfirmedPurchase(record: ConfirmedPurchase) {
  if (!record.bottleId || record.isArchivedMatch || !record.channelId) return;
  // 将确认报价写入渠道价格历史，然后调用 commitChannelChange(..., "purchase_import")。
}

// App 启动或网络恢复：仅扫上次巡检后的渠道；不自动改价格或成本基准。
async function runRecoveryScan(bottles: Bottle[]) {
  const ledger = await loadPriceAlertLedger();
  const candidates = bottles.flatMap((bottle) => bottle.supplierChannels.flatMap((channel) =>
    inspectChannel(bottle, channel, "recovery_scan"),
  ));
  await savePriceAlertLedger(upsertInspectionAlerts(ledger, candidates));
}
```

## 6. 本机持久化与同步边界

```ts
async function loadPriceAlertLedger(): Promise<PriceAlertLedger> {
  const raw = await AsyncStorage.getItem(PRICE_ALERTS_KEY);
  if (!raw) return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), alerts: [] };
  // 实际实现需要做结构校验、未知字段剥离和旧版本迁移。
  return JSON.parse(raw) as PriceAlertLedger;
}

async function savePriceAlertLedger(ledger: PriceAlertLedger) {
  await AsyncStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(ledger));
  notifySyncChange(PRICE_ALERTS_KEY);
}
```

`price-alerts.v1` 必须在同步能力契约中标为 `bottles.view + bottles.edit`。同步合并策略以 `fingerprint` 为键：保留更高 `version`；若版本相同保留较晚的 `lastDetectedAt`，并把冲突记录入操作审计，而不是静默丢弃确认状态。

## 7. 必需测试

| 测试 | 断言 |
|---|---|
| 首次报价 | 只建立价格历史/首次基准待确认，不触发涨跌告警 |
| 同一导入重复执行 | 告警指纹不重复创建，只递增 `detectedCount` |
| 促销抑制 | 有效期内不重新弹窗，到期后恢复巡检 |
| 单位/规格改变 | 仅产生数据待确认，不计算涨跌百分比 |
| 成本基准切换 | 可生成变化提示，但不得改写历史月结快照 |
| 归档酒款 | 导入匹配不再为其创建价格告警 |
| 离线恢复 | 恢复联网后补扫，结果与在线事件巡检一致 |
| 多设备冲突 | 已确认的告警不会被另一设备的重复扫描改回 `open` |
```
