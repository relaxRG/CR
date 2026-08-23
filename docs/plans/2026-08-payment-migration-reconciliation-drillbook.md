# 统一付款与分类快照迁移：数据对账与风险防范演练方案

**目标：** 在将烈酒内啤酒分类快照、统一供货商付款、按行核销和预付款余额迁入受控事实模型时，证明采购成本、付款现金流、分类构成与历史账期均可追溯、金额守恒且可回滚。

> 本演练方案不授权任何生产迁移。生产迁移必须在单独确认后，以备份、影子校验、分批执行和明确放行门槛进行。

## 1. 演练环境与冻结范围

| 环境 | 用途 | 数据要求 | 禁止事项 |
|---|---|---|---|
| 本地测试库 | 自动化迁移和失败注入 | 合成、脱敏样本 | 使用真实令牌或业务文件 |
| 预发布影子库 | 全量结构、只读对账 | 从生产快照脱敏复制 | 向生产回写 |
| 生产只读预检 | 基线统计和差异报告 | 只读 SQL | 创建/更新/删除任何数据 |
| 生产迁移窗口 | 经确认后的受控执行 | 加密备份与操作日志 | 跳过预检、绕过回滚点 |

迁移窗口开始前冻结以下写路径：分类重命名/删除、采购导入、供应商付款提交、备用金分摊和月结发布。只读页面可继续提供已发布数据；所有试图写入的客户端显示“账务迁移中，稍后重试”，并将草稿保留在受控本机状态，不生成远端事实。

## 2. 迁移前基线对账

每个月、每个烈酒供应商、每个分类分别生成基线。基线文件必须包含迁移版本、数据库快照 ID、生成时间和 SQL 校验哈希。

```sql
-- 采购成本基线：迁移前后必须严格相等。
SELECT month, supplier_id, SUM(amount_minor) AS purchase_amount_minor, COUNT(*) AS purchase_count
FROM spirit_purchase_records
GROUP BY month, supplier_id
ORDER BY month, supplier_id;

-- 付款基线：旧付款事实不因新分类/核销模型丢失。
SELECT paid_month, supplier_id, SUM(amount_minor) AS payment_amount_minor, COUNT(*) AS payment_count
FROM legacy_supplier_payments
GROUP BY paid_month, supplier_id
ORDER BY paid_month, supplier_id;

-- 分类基线：确认“啤酒 / Beer”分类的明确酒款与采购行数量。
SELECT c.id, c.name, COUNT(i.id) AS item_count
FROM spirit_categories c
LEFT JOIN spirit_items i ON i.category = c.name
GROUP BY c.id, c.name;
```

必须额外抽取以下人工核查样本：同一供应商同时有啤酒与其它烈酒；跨账期付款；部分付款；网络采购备用金；同名但未链接酒款；已月结采购；预付款/超付/退款（如存在）。

## 3. 演练场景矩阵

| 场景 | 注入条件 | 自动断言 | 人工复核 |
|---|---|---|---|
| 明确啤酒历史行 | `itemId` 指向已确认“啤酒 / Beer”分类 | 写入 beer 快照；采购金额不变 | 采购原名、日期、数量不变 |
| 不确定历史行 | 无 itemId 或分类无法确认 | 保持 `migration_unresolved` | 不进入啤酒成本行 |
| 同供应商跨类 | 啤酒 ¥560、烈酒 ¥2,240 | 同一付款卡总额 ¥2,800；分类构成正确 | 付款单和采购发票匹配 |
| 跨账期核销 | 7 月采购、8 月付款 | 7 月成本不变，8 月现金付款存在 | 月报前后对比 |
| 部分付款 | 一采购两笔付款 | 待付递减且金额守恒 | 两张凭证可追溯 |
| 预付款 | 付款大于已选采购 | 多余额形成 credit，不进成本 | 供货商确认余额 |
| 网络采购 | 备用金未链接/已链接 | 未链接为待关联；链接后仅结清对应行 | 凭证与采购关联 |
| 月结冻结 | 已发布月更改核销 | 生成调整，不能静默改写 | 调整原因完整 |
| 冲突/断网 | revision 变更或请求中断 | 草稿保留、operationId 幂等 | 无重复付款 |

## 4. 自动化对账闸门

迁移脚本每一步结束后执行以下查询；任一闸门失败即停止，不进入下一步骤。

### 4.1 采购成本守恒

```sql
WITH before_totals AS (
  SELECT month, supplier_id, amount_minor FROM migration_baseline_purchase_totals
), after_totals AS (
  SELECT month, supplier_id, SUM(amount_minor) AS amount_minor
  FROM spirit_purchase_records
  GROUP BY month, supplier_id
)
SELECT
  COALESCE(b.month, a.month) AS month,
  COALESCE(b.supplier_id, a.supplier_id) AS supplier_id,
  COALESCE(b.amount_minor, 0) AS before_minor,
  COALESCE(a.amount_minor, 0) AS after_minor,
  COALESCE(a.amount_minor, 0) - COALESCE(b.amount_minor, 0) AS delta_minor
FROM before_totals b
FULL OUTER JOIN after_totals a
  ON a.month = b.month AND a.supplier_id = b.supplier_id
WHERE COALESCE(a.amount_minor, 0) <> COALESCE(b.amount_minor, 0);
```

**放行条件：** 返回零行。SQLite/D1 没有 `FULL OUTER JOIN` 时用 `LEFT JOIN UNION ALL` 等价实现。

### 4.2 分类拆分守恒

```sql
WITH all_cost AS (
  SELECT month, SUM(amount_minor) AS total_minor
  FROM spirit_purchase_records GROUP BY month
), split_cost AS (
  SELECT month, SUM(amount_minor) AS total_minor
  FROM spirit_purchase_records
  GROUP BY month
)
SELECT a.month, a.total_minor AS all_minor, s.total_minor AS split_minor,
       a.total_minor - s.total_minor AS delta_minor
FROM all_cost a JOIN split_cost s USING (month)
WHERE a.total_minor <> s.total_minor;
```

报告中必须同时列出 `beer`、`spirit` 与 `unresolved` 三类金额。`unresolved` 可以大于零，但必须有列表和处理计划；它不能被计入啤酒成本。

### 4.3 付款核销守恒

```sql
SELECT p.id AS payment_id, p.amount_minor,
       COALESCE(SUM(a.amount_minor), 0) AS allocated_minor,
       COALESCE(c.available_minor, 0) AS credit_minor,
       p.amount_minor - COALESCE(SUM(a.amount_minor), 0) - COALESCE(c.available_minor, 0) AS delta_minor
FROM supplier_payments p
LEFT JOIN payment_allocations a ON a.payment_id = p.id
LEFT JOIN supplier_credits c ON c.origin_payment_id = p.id AND c.status = 'available'
GROUP BY p.id, p.amount_minor, c.available_minor
HAVING delta_minor <> 0;
```

**放行条件：** 返回零行。若是待分配草稿，必须不在 `supplier_payments` 已提交集合中。

## 5. 风险防范与回滚策略

| 风险 | 防范 | 发现后操作 | 回滚原则 |
|---|---|---|---|
| 名称误判为啤酒 | 仅 itemId+确认分类自动回填 | 标记 unresolved，停止该批次 | 清除本批快照并保留审计 |
| 分类金额不守恒 | 月/供应商级 SQL 闸门 | 阻断放行，导出差异行 | 恢复迁移前快照 |
| 重复付款 | operationId 与唯一约束 | 查询幂等日志，禁止二次入账 | 冲销重复凭证，不删历史 |
| 预付款误记成本 | 付款/成本两表分离 | 检查 credit 无 purchaseId | 删除未提交草稿或冲销 credit |
| 月结数据被改写 | 月结保护与调整记录 | 停止迁移，审计受影响月份 | 回滚调整批次，不改采购原始行 |
| 迁移中写入 | 写路径冻结与客户端版本门禁 | 将写入放入待提交草稿队列 | 迁移完成后按新 revision 重放 |
| 迁移脚本半完成 | 可重入批次 ID、审计表、事务 | 从最后成功 checkpoint 恢复 | 事务失败自动回滚；批次可显式撤销 |

## 6. 演练流程

1. **准备：** 创建加密备份、生成基线、验证恢复演练、设置迁移批次 ID。
2. **影子执行：** 在预发布影子库运行 schema 扩展、快照初始化和付款表迁移；运行全部自动化测试。
3. **对账：** 执行三类守恒闸门、分类 unresolved 报告、抽样清单和月结差异报告。
4. **故障注入：** 在每个 checkpoint 注入 SQL 失败、Worker 超时、重复 operationId、网络中断、revision 冲突；验证无重复付款或成本变更。
5. **业务复核：** 财务人员按抽样清单核对发票/转账/备用金凭证、采购账期和分类构成。
6. **放行评审：** 技术、财务、业务三方签署闸门结果；任意阻断项未清零则不进入生产。
7. **生产执行：** 仅在明确确认后按同一批次脚本运行；每一步保存日志、统计和可恢复 checkpoint。
8. **迁移后观察：** 24 小时内只读对账监控；重点关注 unresolved、新付款、冲突和跨账期调整。

## 7. 生产放行清单

- [ ] 备份可恢复演练成功。
- [ ] 采购成本月/供应商级差额为零。
- [ ] 已提交付款 = 已核销 + 可用预付款，差额为零。
- [ ] 啤酒、其它烈酒与 unresolved 分类金额报告可解释。
- [ ] 所有未确认历史行保留列表，未被自动分入啤酒。
- [ ] 月结冻结行没有被直接改写。
- [ ] 断网/幂等/冲突/回滚故障注入全部通过。
- [ ] 财务抽样复核签署通过。
- [ ] 生产迁移已获得单独、明确授权。
