# 上线运营监控：付款金额不平与啤酒成本混算实时告警规则

**适用范围：** 烈酒进销存内的供应商统一付款、采购行核销、预付款、啤酒 / Beer 分类、非啤酒烈酒分类和总月报只读投影。  
**目标：** 发现后立刻阻断或隔离错误投影，保留原始事实与审计证据；绝不自动修改采购成本、付款或分类快照。

> 付款总额、分配总额、预付款余额、采购成本与分类投影是五个不同概念。监控规则只检查它们应满足的不变量，不能用“自动修复”掩盖账务错误。

## 1. 监控事件与最小告警载荷

每次提交付款、分配、预付款抵扣、采购快照重分类、月结调整或报表投影时，Worker 写入结构化 `finance_invariant_event`。事件不包含完整发票、银行卡、token 或原始业务附件。

```ts
interface FinanceInvariantEvent {
  eventId: string;
  eventType: "payment_committed" | "allocation_committed" | "credit_applied" | "purchase_reclassified" | "report_projection_built";
  groupIdHash: string;
  supplierId: string;
  purchaseIds: string[];
  months: string[];
  operationId?: string;
  revision: number;
  occurredAt: string;
}

interface FinanceAlert {
  alertId: string;
  ruleId: string;
  severity: "critical" | "high" | "warning" | "info";
  dedupeKey: string;
  supplierId?: string;
  purchaseIds: string[];
  months: string[];
  expectedMinor?: number;
  actualMinor?: number;
  deltaMinor?: number;
  action: "block_write" | "quarantine_projection" | "require_review" | "observe";
  status: "open" | "acknowledged" | "resolved" | "false_positive";
}
```

金额均以最小货币单位整数记录；告警 payload 只包含必要的 ID、月份和差额。操作员在受权限保护的 App 内查看受影响采购行和凭证关联。

## 2. 不变量

| 编号 | 不变量 | 公式/条件 | 违反含义 |
|---|---|---|---|
| INV-P1 | 一张付款单守恒 | `payment = allocations + credits + explicit_unallocated_draft` | 付款有金额去向不明或重复记账 |
| INV-P2 | 采购行不可超核销 | `allocations + creditOffsets ≤ purchase.amount` | 超付或重复分配 |
| INV-P3 | 预付款不可为负 | `credit.available ≥ 0` | 重复抵扣或并发写入 |
| INV-P4 | 同供应商边界 | 付款、采购、credit 的 `groupId + supplierId` 一致 | 串供货商/串组核销 |
| INV-P5 | 成本/付款分离 | 付款写入不改变 `purchase.amountMinor` 或台账成本 | 付款重复计入成本 |
| INV-B1 | 分类快照完整 | 新采购必须有受控 `productClassSnapshot` | 无法可靠拆分啤酒成本 |
| INV-B2 | 啤酒成本单独投影 | `beerCost = Σ purchase[beer].amount` | 啤酒误入非啤酒烈酒成本 |
| INV-B3 | 分类拆分守恒 | `beer + spirit + unresolved = totalSpiritsPurchase` | 丢行、重复行或混算 |
| INV-B4 | 历史快照稳定 | 月结/已发布采购的分类不能被普通主档编辑改写 | 历史报表漂移 |
| INV-B5 | 月报只读一致 | 月报分类成本与采购投影同 revision | 旧投影覆盖新事实或双读混合 |

## 3. 实时告警规则

### 3.1 付款金额不平与核销异常

| Rule ID | 触发 SQL/逻辑 | 严重级别 | 自动动作 | 人工处置 |
|---|---|---|---|---|
| PAY-001 | 已提交付款 `payment.amount != SUM(allocation) + SUM(credit)` | **Critical** | 阻断该付款后续核销；隔离供应商付款卡写操作 | 核对转账凭证、分配行与预付款余额；创建调整或冲销 |
| PAY-002 | 任一采购 `allocated + credited > purchase.amount` | **Critical** | 拒绝当前写入事务；不生成付款投影 | 检查并发/重复 operationId，冲销错误 allocation |
| PAY-003 | `credit.available < 0` | **Critical** | 冻结该 credit 的后续抵扣 | 核对所有 credit allocation，回滚/冲销多余抵扣 |
| PAY-004 | 付款、采购、credit 供应商或组不一致 | **Critical** | 立即拒绝 API 请求并审计安全事件 | 检查供应商映射与设备组权限 |
| PAY-005 | 同 `operationId` 请求哈希不同 | **High** | 拒绝第二请求，保留首个结果 | 排查客户端重放或操作 ID 复用 |
| PAY-006 | 网络采购 `petty_cash` 无有效备用金凭证却标记已付 | **High** | 降级为待关联，禁止付款完成状态 | 关联正确备用金凭证或改为直接付款并说明 |
| PAY-007 | 单供应商当日超付超过阈值（例如应付的 105%） | **Warning** | 保留凭证但不自动分配超额 | 确认是否形成预付款、折扣或录入错误 |
| PAY-008 | 跨账期核销触及已月结月份且无调整原因 | **High** | 拒绝写入 | 走月结调整工作流，填写原因与审批信息 |

示例实时校验（必须在提交事务前执行）：

```sql
SELECT
  p.id,
  p.amount_minor,
  COALESCE((SELECT SUM(amount_minor) FROM payment_allocations WHERE purchase_id = p.id), 0)
    + COALESCE((SELECT SUM(amount_minor) FROM credit_allocations WHERE purchase_id = p.id), 0) AS settled_minor
FROM spirit_purchase_records p
WHERE p.id IN (:affected_purchase_ids)
  AND settled_minor > p.amount_minor;
```

若返回任意行，Worker 返回 `409 PAYMENT_ALLOCATION_EXCEEDS_PURCHASE` 并写 PAY-002；不执行后续写入。

### 3.2 啤酒成本混算与分类快照异常

| Rule ID | 触发 SQL/逻辑 | 严重级别 | 自动动作 | 人工处置 |
|---|---|---|---|---|
| BEER-001 | 新采购 `productClassSnapshot IS NULL` | **High** | 禁止进入已发布月报分类成本；显示待确认 | 在采购详情确认分类或修复酒款链接 |
| BEER-002 | `beer + spirit + unresolved != total`（按月/供应商） | **Critical** | 隔离该月份月报分类投影，保留总采购只读提示 | 导出差异行，检查迁移/重复投影 |
| BEER-003 | `productClassSnapshot='beer'` 出现在非啤酒烈酒成本聚合 | **Critical** | 阻断/下线错误月报分类卡，重新生成投影 | 修正聚合查询或快照数据；不得改采购金额 |
| BEER-004 | `productClassSnapshot='spirit'` 出现在啤酒成本聚合 | **Critical** | 同 BEER-003 | 同上 |
| BEER-005 | 已月结历史行因主档分类变更而更改快照 | **High** | 拒绝普通写入并生成审计 | 用受控月结调整处理 |
| BEER-006 | 月报投影 revision 小于采购/付款事实 revision | **Warning** | 标记“刷新中”，不展示可能过期分类拆分 | 重新构建投影；检查旧请求回写 |
| BEER-007 | unresolved 分类金额超过阈值（默认该月烈酒采购 2% 或 3 行） | **Warning** | 保留总额，隐藏不确定的啤酒拆分 | 财务/库存人员完成分类确认 |

分类金额守恒检查：

```sql
WITH totals AS (
  SELECT month, supplier_id, SUM(amount_minor) AS total_minor
  FROM spirit_purchase_records
  GROUP BY month, supplier_id
), classes AS (
  SELECT month, supplier_id,
    SUM(CASE WHEN product_class_snapshot = 'beer' THEN amount_minor ELSE 0 END) AS beer_minor,
    SUM(CASE WHEN product_class_snapshot = 'spirit' THEN amount_minor ELSE 0 END) AS spirit_minor,
    SUM(CASE WHEN product_class_snapshot IS NULL THEN amount_minor ELSE 0 END) AS unresolved_minor
  FROM spirit_purchase_records
  GROUP BY month, supplier_id
)
SELECT t.month, t.supplier_id, t.total_minor,
       c.beer_minor + c.spirit_minor + c.unresolved_minor AS split_minor,
       t.total_minor - (c.beer_minor + c.spirit_minor + c.unresolved_minor) AS delta_minor
FROM totals t JOIN classes c USING (month, supplier_id)
WHERE t.total_minor <> c.beer_minor + c.spirit_minor + c.unresolved_minor;
```

任何返回行都触发 BEER-002。注意：`unresolved` 是允许的过渡状态，不等于混算；其金额必须被单列报告，不能被计入 beer 或 spirit。

## 4. 去重、聚合与通知策略

| 规则类别 | Dedupe Key | 抑制窗口 | 升级条件 |
|---|---|---:|---|
| 付款 Critical | `ruleId:supplierId:paymentId:revision` | 0；每次新 revision 重新评估 | 10 分钟未确认升级至财务负责人 |
| 分类 Critical | `ruleId:month:supplierId:revision` | 5 分钟 | 同月多供应商触发时升级为全局月报阻断 |
| 待确认 Warning | `ruleId:month:supplierId` | 24 小时 | 连续 3 日或超过阈值升级 High |
| 投影延迟 Warning | `ruleId:month:projection` | 15 分钟 | 超过 30 分钟仍未恢复升级 High |

通知目标分级：Critical 发送给账务负责人和系统值班；High 发送给模块负责人和财务；Warning 进入 App 内待办和每日摘要。外部通知只发送差额、月份、供应商显示名（若权限允许）和受影响记录数，不发送银行卡、发票附件、session token 或完整业务明细。

## 5. 自动隔离与人工恢复

| 告警动作 | 系统行为 | 用户可见表现 | 恢复条件 |
|---|---|---|---|
| `block_write` | 当前事务回滚，阻止错误凭证写入 | “金额核销不平，未保存” | 修复输入后重试 |
| `quarantine_projection` | 不发布错误分类月报投影 | 月报显示“该分类对账中”，总采购可读 | 守恒检查连续两次通过 |
| `require_review` | 保留事实但标记待确认 | 采购/付款详情显示琥珀提醒 | 有权限人员确认、调整或冲销 |
| `observe` | 仅记录和汇总 | App 内待办/日报 | 达到阈值或人工关闭 |

恢复操作必须产生 `finance_alert_resolution`，至少记录规则 ID、处理人、时间、原因、关联 adjustment/operation ID、验证查询结果。不能仅点击“忽略”使 Critical 告警消失。

## 6. 监控测试与演练

1. 构造付款金额 ¥1,000、分配 ¥900、未形成预付款的请求，断言 PAY-001 被阻断。
2. 对 ¥560 啤酒采购写入 ¥600 allocation，断言 PAY-002 和超付 UI 异常；不能形成正常已付。
3. 构造同一供应商啤酒 ¥560、烈酒 ¥2,240，验证统一付款卡总额 ¥2,800，分类拆分守恒；随后人为让 beer 聚合叠加到 spirit，断言 BEER-003/BEER-002 触发并隔离投影。
4. 修改已月结酒款分类，断言历史 `productClassSnapshot` 不变并触发 BEER-005。
5. 模拟报表旧 revision 回写，断言 BEER-006 进入刷新中而不展示混合快照。
6. 对每个 Critical 规则执行“触发 → 事务回滚/投影隔离 → 修复 → 两次连续验证通过 → 告警关闭”演练。

## 7. 上线后的仪表板指标

| 指标 | 目标 | 告警阈值 |
|---|---:|---:|
| 付款守恒差额 | 0 | 任意非零 Critical |
| 采购超核销行数 | 0 | 任意非零 Critical |
| 分类拆分差额 | 0 | 任意非零 Critical |
| 未确认分类金额占比 | < 2% | ≥2% Warning；≥5% High |
| 待关联网络采购数量 | 业务可控 | 连续 7 日未下降 Warning |
| 月报投影延迟 | < 5 分钟 | ≥15 分钟 Warning；≥30 分钟 High |
| 告警修复平均时长 | 持续下降 | Critical 超过 10 分钟未确认升级 |
