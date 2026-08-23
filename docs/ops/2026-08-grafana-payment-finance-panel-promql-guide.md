# Grafana「付款与啤酒成本完整性」大盘：PromQL 面板说明与调优指南

## 1. 标签与基数规则

所有指标仅允许以下稳定、低基数标签：`group_id`（建议哈希/短 ID）、`supplier_id`、`month`、`product_class`、`rule_id`、`severity`。**禁止**在 Prometheus 标签中写入 `purchase_id`、`payment_id`、`operation_id`、原始商品名、发票号、错误文本或用户 ID；这些高基数详情应进入日志/审计表，并从 Grafana 链接跳转查询。

| 指标 | 类型 | 推荐标签 | 说明 |
|---|---|---|---|
| `cocktail_finance_payment_amount_minor` | gauge | group_id, supplier_id, payment_id* | 单笔付款金额；生产建议不要带 payment_id，而改为写日志详情 |
| `cocktail_finance_payment_allocated_minor` | gauge | group_id, supplier_id | 已分配付款总额 |
| `cocktail_finance_payment_credit_minor` | gauge | group_id, supplier_id | 可用预付款余额 |
| `cocktail_finance_product_class_split_delta_minor` | gauge | group_id, supplier_id, month | 分类拆分差额 |
| `cocktail_finance_purchase_cost_minor` | gauge | group_id, supplier_id, month, product_class | 采购成本投影 |
| `cocktail_finance_unresolved_product_class_amount_minor` | gauge | group_id, month | 待确认分类金额 |
| `cocktail_finance_report_projection_revision_lag` | gauge | group_id, month | 投影 revision 滞后数 |
| `cocktail_finance_open_alerts` | gauge | rule_id, severity, domain | 打开的告警数量 |

> `payment_id` 在高交易量生产中会造成时间序列爆炸。最佳实践是以供货商/月份为聚合指标告警，将具体付款 ID 放入结构化日志、审计库和告警 annotation。

## 2. Panel 1：付款金额不平（笔）

**业务问题：** 已提交付款是否存在“付款金额 ≠ 已分配 + 预付款”的差额。

```promql
sum(
  cocktail_finance_supplier_payment_imbalance_count
)
```

若必须由金额派生：

```promql
count(
  (
    sum by (group_id, supplier_id) (cocktail_finance_payment_amount_minor)
    - sum by (group_id, supplier_id) (cocktail_finance_payment_allocated_minor)
    - sum by (group_id, supplier_id) (cocktail_finance_payment_credit_minor)
  ) != 0
)
```

**Panel 类型：** Stat。  
**阈值：** `0` 绿色，`≥1` 红色。  
**调优：** 生产优先导出预聚合的 `cocktail_finance_supplier_payment_imbalance_count`，避免在 Grafana 每次刷新时对大规模付款序列做减法聚合。

## 3. Panel 2：分类成本拆分差额

```promql
sum(
  abs(cocktail_finance_product_class_split_delta_minor)
) / 100
```

**含义：** 任意月份/供应商中，啤酒 + 非啤酒烈酒 + 待确认分类与烈酒采购总额的绝对差额。  
**Panel 类型：** Stat，单位 `currencyCNY`。  
**阈值：** 0 绿色，任何非零红色。  
**调优：** 差额应由 Worker/recording rule 计算并输出；不要在面板内进行多表 join。推荐 recording rule：

```yaml
- record: cocktail_finance:product_class_split_delta_minor
  expr: |
    sum by (group_id, supplier_id, month) (cocktail_finance_total_spirits_purchase_amount_minor)
    - sum by (group_id, supplier_id, month) (cocktail_finance_purchase_cost_minor{product_class=~"beer|spirit|unresolved"})
```

## 4. Panel 3：统一付款—分配—预付款余额

```promql
sum by (supplier_id) (cocktail_finance_payment_amount_minor) / 100
sum by (supplier_id) (cocktail_finance_payment_allocated_minor) / 100
sum by (supplier_id) (cocktail_finance_payment_credit_minor) / 100
```

**Panel 类型：** Time series。  
**用途：** 查看同一供货商统一付款、按行分配和预付款余额的关系。若“付款”曲线明显高于“分配 + 预付款”，应点击跳转至 PAY-001 Runbook。  
**调优：** 对供应商数量很多时，默认只显示 Top 20：

```promql
topk(20, sum by (supplier_id) (cocktail_finance_payment_amount_minor)) / 100
```

使用 Grafana 变量 `${supplier_id:regex}` 仅查询用户选择的供应商，避免全局渲染数千条线。

## 5. Panel 4：烈酒内分类成本—啤酒与非啤酒烈酒

```promql
sum by (month) (cocktail_finance_purchase_cost_minor{product_class="beer"}) / 100
sum by (month) (cocktail_finance_purchase_cost_minor{product_class="spirit"}) / 100
sum by (month) (cocktail_finance_purchase_cost_minor{product_class="unresolved"}) / 100
```

**Panel 类型：** Time series 或 Bar chart。  
**用途：** 啤酒不是独立模块，但必须在内部核算中清晰可见；`unresolved` 只表示待确认，不能被当成啤酒或其它烈酒。  
**调优：** 月份是低基数标签，适合聚合。供应商下钻时增加 `supplier_id=~"${supplier_id:regex}"`；不建议使用采购行级标签。

## 6. Panel 5：待人工处理的财务异常

```promql
sum by (rule_id, severity, domain) (cocktail_finance_open_alerts)
```

**Panel 类型：** Table。  
**字段建议：** 规则、级别、领域、数量、Runbook 链接、最近触发时间。  
**调优：** Prometheus 只显示聚合告警；具体受影响付款/采购行在 Alertmanager annotation 或日志系统中查询。使用 Grafana data link 传递 `rule_id` 和 `supplier_id` 跳转审计检索。

## 7. Panel 6：待确认分类金额占比

```promql
sum(cocktail_finance_unresolved_product_class_amount_minor)
/
clamp_min(sum(cocktail_finance_total_spirits_purchase_amount_minor), 1)
```

**Panel 类型：** Stat，单位 `percentunit`。  
**阈值：** `<2%` 绿色，`2%–5%` 琥珀，`≥5%` 红色。  
**调优：** 不要以瞬时单行指标判断；建议配合 `max_over_time(...[24h])` 观察每日最高值，Alertmanager 使用 `for: 24h` 防止导入过程短暂波动：

```promql
max_over_time((
  sum(cocktail_finance_unresolved_product_class_amount_minor)
  / clamp_min(sum(cocktail_finance_total_spirits_purchase_amount_minor), 1)
)[24h:5m])
```

## 8. 通用查询与数据源调优

1. **使用 recording rules。** 所有付款守恒、分类拆分、未确认比例和 revision lag 均应在 Prometheus recording rule 或 Worker 聚合层先计算，Grafana 只消费聚合指标。
2. **限制时间范围。** 默认 30 天；月度趋势可用 90 天，但不应默认加载全年高粒度数据。
3. **限制图例数量。** 供应商维度使用 `topk` 或 Dashboard 变量；单屏不应超过 20 条线。
4. **选择合适 step。** 30 天范围使用 `min_interval=5m`，90 天使用 `1h`；不要对月度成本指标以 5 秒粒度查询。
5. **避免高基数。** 付款/采购行 ID、操作 ID、商品名、错误文本进入 Loki/审计数据库，不进入 metric label。
6. **数据延迟可见。** 对投影指标加 `generated_at` 或 revision lag；避免用户把过期零值误读为无业务数据。
7. **安全过滤。** Grafana variable 不应暴露未授权 group；数据源查询必须由服务端依据设备组/角色限制。

## 9. 推荐大盘交互

- 点击 Panel 1 或 Panel 2 的红色状态，跳转至异常表，并自动带入 `rule_id`、月份和供应商变量。
- 点击 Panel 3 某供应商曲线，打开对应统一付款对账页面；仅传 ID，不传名称作为写入依据。
- 点击 Panel 4 啤酒柱，深链到烈酒当月进货并预填“啤酒 / Beer”分类；不打开独立啤酒页面。
- 点击 Panel 5 行，打开 SOP 对应 Runbook 或受权限保护的审计详情。
