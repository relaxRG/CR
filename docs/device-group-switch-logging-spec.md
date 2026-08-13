# 同步组切换异常日志埋点规范

**适用范围：** 本规范适用于设备从一个同步组安全加入另一个同步组的完整路径，包括准备、主设备交接、原子提交、目标组完整水合、照片下载、冷启动恢复和用户取消。其目标是让故障可定位、可恢复，同时保证**业务数据、配对码、设备令牌和恢复票据绝不进入诊断日志**。

## 1. 日志分层与关联方式

每一次切换生成一个 `switchId`，它是客户端、Worker 和测试用例之间唯一允许共享的关联标识。`switchId` 不含群组ID、设备ID、配对码或业务内容。客户端诊断事件保存到 `AsyncStorage`，Worker审计事件保存到 D1 的 `group_switch_events`；两端都不得写入原始凭据。

| 层级 | 存储位置 | 保留策略 | 可记录字段 | 禁止记录字段 |
|---|---|---:|---|---|
| 客户端诊断 | `cf.sync.switchDiagnostics.v1` | 最近 120 条 | `at`、`event`、`switchId`、群组不可逆短哈希、稳定错误码、`retryable` | 业务JSON、原始群组ID、设备令牌、配对码、恢复票据、照片内容 |
| 可恢复会话 | `cf.sync.groupSwitchSession.v1` + SecureStore | 事务完成后立即删除 | 切换状态、`switchId`、目标群组ID、快照槽位、错误码 | 恢复票据不得存入 AsyncStorage；仅 SecureStore 存放 |
| Worker 审计 | `group_switch_events` | 90 天；每日最多清理一次 | `switch_id`、`event`、`error_code`、`created_at` | 设备令牌、邀请码、业务负载、原始同步数据 |
| 同步操作日志 | `sync.log.v1` | 最近 200 条 | 切换阶段摘要、已写入/清除键数量 | 键的原始值、照片Base64、隐私内容 |

> **定义：** 稳定错误码是可用于程序分支、测试断言与运维统计的短字符串，例如 `TARGET_SNAPSHOT_GROUP_MISMATCH`。它不应使用未经处理的异常正文代替。

## 2. 必须埋点的状态转换

客户端 `appendGroupSwitchDiagnostic()` 与 Worker `logSwitchEvent()` 使用同一类阶段语义。Worker只保留服务端已确认的阶段；客户端还记录本地屏障与恢复过程。

| 事件 | 触发点 | 必填属性 | 处理要求 |
|---|---|---|---|
| `switch_prepared` | Worker校验邀请码、成员资格和交接条件成功 | `switchId` | 尚未撤销源成员；可取消 |
| `write_barrier_enabled` | 客户端停止普通同步、清除A组脏键 | `switchId` | 任何普通推送必须拒绝 |
| `switch_committed` | Worker批量创建B成员、撤销A成员、消费邀请码成功 | `switchId` | 之后不得自动恢复A组 |
| `target_snapshot_requested` | B成员资格下请求完整快照 | `switchId` | 禁止传递 `since` 游标 |
| `target_hydration_started` | 客户端开始逐键覆盖本地同步数据 | `switchId` | LWW、冲突弹窗、普通首轮同步均被隔离 |
| `target_hydration_completed` | 键替换、Store重载和只读照片下载成功 | `switchId` | 方可恢复B组普通推送 |
| `target_hydration_failed` | 提交后水合、照片下载或Store重载失败 | `switchId`、`errorCode`、`retryable=true` | 保留写入屏障和会话，等待恢复 |
| `switch_recovery_started` | 冷启动发现未完成会话 | `switchId` | 使用SecureStore恢复票据查询状态 |
| `source_resumed` | Worker仍为 `prepared`，已取消并恢复A组 | `switchId` | 仅提交前可发生 |
| `switch_recovery_completed` | 已提交事务完成B组水合 | `switchId` | 清除恢复票据与会话 |
| `switch_recovery_failed` | 查询状态或水合仍失败 | `switchId`、`errorCode` | 禁止降级推送或自动清除会话 |

## 3. 错误码规范与响应

| 错误码 | 含义 | 客户端行为 | 运维含义 |
|---|---|---|---|
| `OWNER_HANDOFF_REQUIRED` | 主设备离开时原组仍有其他活跃成员，但未选交接目标 | 不提交；要求用户选择成员 | 正常业务拦截，不告警 |
| `OWNER_HANDOFF_INVALID` | 交接目标不属于原组或已失效 | 不提交；刷新设备列表 | 可能是并发移除设备 |
| `PAIR_CODE_UNAVAILABLE` | 邀请码已使用、过期或被另一个切换保留 | 不提交；要求重新获取邀请码 | 统计高频重复使用风险 |
| `TARGET_GROUP_SAME_AS_SOURCE` | 目标邀请码属于当前组 | 不提交 | 客户端/用户输入错误 |
| `TARGET_SNAPSHOT_GROUP_MISMATCH` | 快照群组与Worker提交成员资格不一致 | 永久阻断；不得覆盖本地数据 | **安全告警**，需审计Worker |
| `TARGET_SNAPSHOT_INCOMPLETE` | 快照未声明完整清单 | 永久阻断；保留恢复会话 | **安全告警** |
| `SYNC_GROUP_SWITCH_WRITE_BLOCKED` | 陈旧异步任务使用旧epoch写入 | 忽略该任务并记录 | 正常并发保护信号 |
| `NETWORK_OFFLINE` | 提交后无法拉取目标快照 | 保留屏障，网络恢复后重试 | 常规网络故障 |
| `SWITCH_RECOVERY_UNAUTHORIZED` | 恢复票据无效或被篡改 | 阻断并引导人工支持 | 可能是本地安全存储损坏或攻击 |

## 4. 告警阈值与排障顺序

系统当前不上传客户端日志。若后续接入集中监控，只允许上报脱敏后的事件结构。出现 `TARGET_SNAPSHOT_GROUP_MISMATCH`、`TARGET_SNAPSHOT_INCOMPLETE` 或连续三次 `SWITCH_RECOVERY_FAILED` 时，应标记为高优先级；任何自动化恢复都不得绕过写入屏障。

排障时先按 `switchId` 查询客户端诊断与 Worker `group_switch_events`。若 Worker状态为 `prepared`，可以取消并恢复源组；若为 `committed`，只能用目标成员资格重复执行完整水合，严禁恢复源组令牌或将本地旧脏键推送到目标组。

## 5. 验收条件

每次修改切组代码时，必须同时通过以下验证：`tests/group-switch-isolation.test.ts`、`tests/group-switch-state-machine.test.ts`、`scripts/group-switch-worker-chaos.py`、`pnpm check` 和全量 `pnpm test`。上线前还需以真实Worker预览版本验证旧令牌返回401、目标快照仅含B组键、断网后重启可继续完成B组水合，以及客户端日志中不包含凭据或业务值。
