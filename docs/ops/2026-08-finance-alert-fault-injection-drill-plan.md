# 付款与啤酒成本告警：故障注入与压测演练方案

## 1. 边界与原则

所有演练仅在**影子环境**进行：独立 Prometheus、Alertmanager、Grafana、测试 D1/SQLite 数据库与合成业务数据。禁止使用真实转账、真实备用金、生产 webhook、生产数据库或生产 Worker 凭证。演练的成功标准不是“告警数量越多越好”，而是每一个异常都能被正确识别、去重、阻断或隔离，并在修复后可靠恢复。

## 2. 观测路径

```text
合成付款/采购事件 → 对账服务 → invariant metrics → Prometheus rules
                                                 ↓
                                           Alertmanager
                                                 ↓
                                 Grafana / 影子告警接收器 / 审计日志
```

每个演练用例需要记录：场景 ID、种子、开始时间、触发事件数、期望指标、期望告警、实际告警、自动动作、修复动作、恢复时间和审阅人。

## 3. 基准负载

| 维度 | 常规 | 压力 | 极限 |
|---|---:|---:|---:|
| 烈酒供货商 | 50 | 500 | 2,000 |
| 每供应商开放采购行 | 20 | 200 | 1,000 |
| 啤酒采购占比 | 20% | 30% | 40% |
| 统一付款并发提交 | 5/min | 100/min | 500/min |
| 跨账期采购行 | 10% | 25% | 40% |
| 待确认分类 | 1% | 2% | 5% |

压测使用可重复的固定随机种子生成合成采购、付款、allocation 和 credit；每批合成数据必须保证在注入错误前金额守恒。

## 4. 故障注入用例

| ID | 注入方法 | 期望告警/动作 | 恢复验证 |
|---|---|---|---|
| FI-PAY-001 | 付款 ¥1,000，只写 allocation ¥900，未建 credit | PAY-001 Critical；付款提交回滚或投影隔离 | 补足明确 credit 或冲销后差额=0 |
| FI-PAY-002 | 对 ¥560 采购写入 ¥600 allocation | PAY-002 Critical；拒绝超核销写入 | 无超额 allocation；采购待付正确 |
| FI-PAY-003 | 并发两次消费同一 credit | PAY-003 Critical；第二事务冲突/回滚 | credit.available ≥ 0 |
| FI-PAY-004 | 付款 supplierId A 分配到采购 supplierId B | PAY-004 Critical；请求拒绝 | 无跨供应商 allocation |
| FI-PAY-005 | 重用 operationId 但 payload 不同 | PAY-005 High；第二请求拒绝 | 首次结果保持唯一 |
| FI-PAY-006 | 网络采购缺备用金凭证却尝试标记 paid | PAY-006 High；状态待关联 | 关联凭证后才可结清 |
| FI-BEER-001 | 新啤酒采购移除分类快照 | BEER-001 High；不进入分类月报 | 补快照后重建投影 |
| FI-BEER-002 | 人为让 beer+spirit+unresolved 与总额不等 | BEER-002 Critical；隔离月报分类投影 | 重新计算后两次守恒=0 |
| FI-BEER-003 | 将 beer 行错误聚合到 spirit 投影 | BEER-003 Critical；卡片隔离 | 修正聚合并验证分类金额 |
| FI-BEER-005 | 对已月结采购普通编辑分类 | BEER-005 High；拒绝普通写入 | 走月结调整后有审计 |
| FI-BEER-006 | 让报表投影 revision 落后事实 revision | BEER-006 Warning；显示刷新中 | 刷新后 lag=0 |
| FI-NET-001 | 付款提交后丢弃 API 响应 | 不重复扣款；按 operationId 查询结果 | 仅一张付款凭证 |

## 5. 压测阶段

### 阶段 A：指标吞吐

以 100/min、500/min 的付款提交向影子 API 持续 15 分钟，观测 `invariant evaluation latency`、Prometheus 抓取时长、告警评估时长和 Grafana 查询延迟。目标：关键不变量在提交后 30 秒内可观测，Critical 告警在 60 秒内到达影子接收器。

### 阶段 B：并发正确性

对同一供应商和同一 credit 进行高竞争提交，验证 revision、条件写入和 operationId 幂等。目标：只有一个提交成功，所有失败操作可恢复为草稿，不能出现负 credit、超核销或重复付款。

### 阶段 C：告警风暴与去重

一次注入 1,000 个同供应商、同月份的分类混算行。目标：Alertmanager 以 `ruleId:supplierId:month:revision` 去重，形成一个可操作的 Critical 事件而非 1,000 条通知；修复后能发出 resolved。

### 阶段 D：恢复演练

每个 Critical 场景执行“触发 → 自动阻断/隔离 → 使用维护脚本修复 → 两次连续采集验证 → resolved”闭环。目标：审计日志完整，任何环节不得直接修改采购成本或删除付款历史。

## 6. 放行标准

- 所有 Critical 注入均被检测，误报率为零。
- PAY-001/PAY-002/PAY-003/BEER-002/BEER-003 必须产生阻断或投影隔离。
- 同类异常在 5 分钟内最多一条主要通知；升级路径可用。
- 影子修复后，付款守恒、采购行未超核销、分类拆分守恒均连续两轮为零差额。
- 压力测试未产生重复付款、负预付款、成本回写或跨供应商 allocation。
- 参与人员完成 Runbook 演练，并在演练记录签字确认。
