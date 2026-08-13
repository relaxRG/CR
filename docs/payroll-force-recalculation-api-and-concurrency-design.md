# 所选月草稿薪资重算：API与并发设计

## 当前已实现的本机安全层

前端现已具备 DRAFT 月按钮、二次确认、7槽本地快照、同月互斥锁和一次 `replaceMonthPaySlips()` 批量替换。它能彻底清除**本机所选月的可再生旧聚合金额**，同时保留补贴覆盖、KPI选择、业绩实绩、预支、备用金已付、调休兑现和节假日分配。

当前本机锁不等同于跨设备事务；同步组场景必须再接入下述Worker协议。

## Worker API

### `POST /api/payroll/recalculation/prepare`

请求：

```json
{
  "month": "2026-08",
  "expectedRevision": 17,
  "clientRunId": "recalc-...",
  "scope": "draft-payroll-only"
}
```

Worker认证当前设备后，在D1事务中执行：验证设备拥有 `payroll` 写权限；验证月份状态为 `draft`；读取 `payroll_month_revisions`；仅当 `expectedRevision` 匹配且该月没有未过期租约时，写入30秒租约并返回 `leaseId`、`revision` 与服务器时间。

响应：

```json
{
  "leaseId": "lease-...",
  "month": "2026-08",
  "revision": 17,
  "expiresAt": 1720000000000
}
```

### `POST /api/payroll/recalculation/commit`

请求只提交经过本机唯一引擎重建的**脱敏差异摘要**，不上传本地所有薪资业务内容：

```json
{
  "leaseId": "lease-...",
  "month": "2026-08",
  "expectedRevision": 17,
  "affectedEmployees": 5,
  "changedEmployees": 2,
  "summary": {
    "workKPI": { "from": 0, "to": 1700 },
    "dailyAllowance": { "from": 15, "to": 0 }
  }
}
```

D1事务验证租约归属和未过期状态，将修订号递增，删除租约，写入 `payroll_recalculation_audit`。客户端随后通过现有通用同步键推送已重建的当月薪资单；修订冲突时必须拉取最新数据、展示差异，不能静默覆盖。

### 错误码

| HTTP | 代码 | 客户端动作 |
|---:|---|---|
| 401 | `DEVICE_AUTH_UNAUTHORIZED` | 重新认证；不得清空本地月份 |
| 403 | `PAYROLL_PERMISSION_DENIED` | 提示联系主设备/管理员 |
| 409 | `PAYROLL_MONTH_NOT_DRAFT` | 进入月度归档或差额流程 |
| 409 | `PAYROLL_MONTH_RECALCULATION_IN_PROGRESS` | 显示其他设备正在处理，等待或重试 |
| 409 | `PAYROLL_MONTH_REVISION_CONFLICT` | 拉取最新状态，展示差异后重新确认 |
| 422 | `PAYROLL_RECALCULATION_SCOPE_INVALID` | 拒绝任何跨月或非薪资范围请求 |
| 500 | `PAYROLL_RECALCULATION_COMMIT_FAILED` | 保持本地快照，允许恢复，不做部分提交 |

## D1表与事务

```sql
CREATE TABLE IF NOT EXISTS payroll_month_revisions (
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_device_id TEXT,
  lease_expires_at INTEGER,
  PRIMARY KEY (group_id, month)
);

CREATE TABLE IF NOT EXISTS payroll_recalculation_audit (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  affected_employees INTEGER NOT NULL,
  changed_employees INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

两端点必须使用同一个D1事务。租约过期只能释放锁，不能让旧的 `leaseId` 成功提交。日志仅保存错误码、月份、修订号和统计数量，不保存薪资明细、设备Token、配对码或银行卡。

## 旧缓存与跨月误识别清理

“清理”分为三个层次：

1. **本机所选DRAFT月：** 全量替换该月薪资单集合，旧聚合金额自然消失。
2. **冻结与其他月份：** 不删除。只运行异常扫描，例如发现旧 `performanceBonus`、`salesCommission` 或日补贴与0出勤冲突时生成“跨月异常清单”。
3. **异常处理：** 每个受影响月份单独打开，DRAFT执行同一重算；FROZEN创建差额调整。禁止一个八月按钮删除七月或九月数据。

## 完整并发测试

测试代码已加入 `tests/payroll-force-recalculation-concurrency.test.ts`。它覆盖同月双并发仅一个成功、不同月不互锁、DRAFT门禁、快照创建、批量替换与移动端可访问标签。Worker/D1上线前还必须补充两设备CAS集成测试：相同`expectedRevision`并发提交时一方成功、一方得到 `PAYROLL_MONTH_REVISION_CONFLICT`。
