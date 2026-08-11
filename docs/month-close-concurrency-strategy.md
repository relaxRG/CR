# 月度归档高并发结算与锁策略审计

## 一、当前结论

当前 App 的月度归档、差额调整和排班/薪资数据首先写入 **AsyncStorage**，随后通过云同步客户端推送到 Cloudflare Worker。仓库内不包含 Worker 或 D1 Schema，因此本仓库**没有可执行的 D1 行锁、SQL 事务或比较并交换接口**。

当前同步协议仅提交以下字段：

```ts
{ storageKey, value, clientUpdatedAt }
```

并使用客户端的时间戳、60 秒冲突窗口和字段级/ID 级合并处理跨设备变化。这适用于普通资料编辑，不足以作为金融结算的跨设备互斥锁。

| 范围 | 已有保护 | 仍然缺失 |
|---|---|---|
| 同一 App 实例内重复点击 | `MonthCloseOperationGate` 按月份互斥 | 无需额外锁。 |
| 异步加载未完成 | 月度归档和进入调整前检查员工、排班、考勤、薪资的 `ready` 状态 | 无需额外锁。 |
| App 崩溃时放弃调整 | 调整会话持久化完整月度基线，可用于恢复 | 多键写入没有提交日志。 |
| 两台设备同时结算同一月份 | 同步窗口内产生客户端冲突，不自动覆盖 | 缺少服务端租约锁和版本比较。 |
| D1 数据库并发写入 | 不在本仓库 | 缺少原子事务、唯一约束与乐观锁。 |

## 二、本次客户端加固

### 2.1 单设备同月互斥

`lib/labor/month-close-operation-gate.ts` 为同一 JavaScript 运行时中的归档、进入调整、放弃调整、应用归档排班和差额登记建立按月份互斥。重复点击会被拒绝，异常时由 `finally` 释放锁，不会永久卡住月份。

### 2.2 高负载快照复杂度

最终排班快照和冻结薪资快照已从嵌套查找改为一次索引。

| 计算 | 旧风险 | 当前策略 |
|---|---|---|
| 部门排班归档 | 每部门使用 `includes` 与重复筛选，员工/排班量上升时额外扫描 | 员工→部门、部门→班次一次 Map 分组，复杂度为 `O(员工数 + 班次数)`。 |
| 薪资冻结归档 | 每名员工对全量薪资单执行一次 `find`，复杂度接近 `O(员工数 × 薪资单数)` | 先建立员工→当月薪资单 Map，复杂度为 `O(员工数 + 薪资单数)`。 |
| 当前归档查询 | 过滤后排序 | 单次线性选出最高正式版本。 |

回归测试以 2,000 名员工、62,000 条班次为基准，验证部门快照可在 2 秒内完成；2,000 名员工的薪资冻结快照可在 500ms 内完成。阈值用于发现数量级退化，而不是测量设备绝对性能。

## 三、必须在 Cloudflare Worker / D1 实现的生产锁契约

在多设备结算上线前，Worker 必须增加专用结算 API，禁止客户端将月度归档当作普通同步键直接 LWW 推送。

### 3.1 建议表结构

```sql
CREATE TABLE month_close_locks (
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,
  owner_device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, month)
);

CREATE TABLE month_close_archives (
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,
  version INTEGER NOT NULL,
  archive_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, month, version),
  UNIQUE (archive_id)
);
```

### 3.2 建议接口

| 接口 | 作用 | 服务端必须保证 |
|---|---|---|
| `POST /api/payroll/month-close/acquire` | 获取 60 秒可续期租约 | `BEGIN IMMEDIATE`；同一 group+month 仅一个未过期 owner。 |
| `POST /api/payroll/month-close/commit` | 提交 v1 或 vN | 校验 token、锁未过期、`expectedRevision`；在单个事务内写 archive、差额与 revision。 |
| `POST /api/payroll/month-close/release` | 释放未提交租约 | 仅 owner token 可释放。 |
| `POST /api/payroll/month-close/renew` | 长结算续租 | token 匹配才允许延长。 |

提交应使用乐观锁，核心伪代码如下：

```sql
BEGIN IMMEDIATE;
SELECT owner_device_id, token, expires_at, revision
  FROM month_close_locks
 WHERE group_id = :groupId AND month = :month;

-- token 必须匹配，expires_at 必须大于当前时间，revision 必须等于 expectedRevision。
UPDATE month_close_archives
   SET payload_json = :payload, revision = revision + 1
 WHERE group_id = :groupId AND month = :month AND version = :version;

-- 首次归档 INSERT v1；重新确认 INSERT vN 并将 vN-1 标为 superseded。
COMMIT;
```

若任一步失败，返回 `409 MONTH_CLOSE_CONFLICT`，客户端必须拉取最新归档，展示“另一设备已完成结算”而不是自动覆盖。

## 四、提交恢复建议

AsyncStorage 的多键写入不能原子提交。客户端后续应引入 `month_close_commit_journal_v1`，按以下状态恢复：

```text
PREPARING → ARCHIVE_WRITTEN → SESSION_CLEARED → COMMITTED
```

启动时发现未完成 journal：若 archive 存在则补齐会话清理；若 archive 不存在则恢复调整基线并标记需要人工检查。该能力依赖服务端归档 commit token，避免离线客户端自行伪造最终状态。

## 五、发布前门槛

在 Worker 未实现租约锁和 CAS 前，月度归档只能视为**单设备结算功能**。多设备同时结算同一月份应在产品层明确限制，并提示用户在唯一结算设备完成归档。

发布前执行：

```bash
pnpm check
pnpm test
pnpm test:h5:schedule-correction
```
