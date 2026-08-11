# 排班清空调用审计与一次性迁移建议

**审计范围：** `app/`、`lib/`、`tests/` 与 `docs/` 中的 `batchDeleteShifts`、`deleteShift`、`deleteSelected`、`clear`、`reset`、快照覆盖和薪资归零相关调用。

## 结论

代码库中**没有独立遗留的“旧版全月清空函数”**。此前风险来自把“生成薪资单”误作为异常纠错入口，而不是来自一个需要删除的旧 API。全月纠错现已唯一收敛为 `handleForceClearCurrentMonthSchedule`；它在编辑模式可见，受月度状态、调休权益和双重确认保护。

底层 `deleteShift` 与 `batchDeleteShifts` 不是旧业务逻辑，而是受控存储原语，仍被多个合法编辑场景使用，不能删除。

## 调用分类

| 调用位置 | 业务用途 | 是否保留 | 安全要求 |
|---|---|---:|---|
| 排班格子编辑 / 时长编辑的 `deleteShift` | 清除单个班次或空工时记录 | 保留 | 使用真实日期调用 `ensureScheduleDatesWritable`；由自动同步重算当月考勤。 |
| 编辑模式 `deleteSelected` → `batchDeleteShifts` | 删除用户手选的多条班次 | 保留 | 从真实记录回查选中项，按全部日期检查冻结月。 |
| 员工从班次组取消勾选 → `batchDeleteShifts` | 清除该员工本月该班次记录 | 保留 | 仅清理当前组/当前班次；自动同步处理派生薪资。 |
| 快照一键代入 → `batchDeleteShifts` + `batchUpsertShifts` | 覆盖当前部门当前月排班 | 保留 | 只删除快照所属部门；先检查月份可写。 |
| `handleForceClearCurrentMonthSchedule` | 异常纠错：全月清空并重建派生考勤薪资 | 保留且唯一化 | `DRAFT`/`ADJUSTING`、权益完整性校验、两次确认、显式空排班重算。 |
| “生成薪资单” | 按当前排班结算 | 保留但不得用于清空 | 执行前确认；文案明确不清除错误排班。 |

## 一次性清理方案

1. 禁止新增任何以“生成薪资单”为名的清空、归零或删除行为；若出现异常排班，统一调用专用强制清空流程。
2. 禁止绕过 `ensureScheduleDatesWritable` 直接调用单格或批量删除原语。
3. 禁止在 UI 层手动修改 `attendanceSalary`、`proportionalBaseSalary` 或 `grossSalary`；删除排班后必须由空排班进入生产计算器并持久化结果。
4. 禁止删除底层 `deleteShift` / `batchDeleteShifts`；它们是单格编辑、批量选择和快照覆盖的公共受控原语。
5. 以后新增的排班覆盖功能必须按“冻结校验 → 限定范围删除 → 批量写入 → 自动同步”的顺序实现，并新增测试。

## 自动化护栏

- `tests/payroll-correction-ui.test.ts`：确认生成与强制清空职责分离、双确认、空排班重算及调休余额拦截。
- `tests/schedule-engine-audit.test.ts`：验证跨月隔离、31 天请假/调休、法定节假日补偿和日薪精度。
- `scripts/h5-schedule-correction-e2e.mjs`：验证 375/390/430pt H5 下编辑入口、独立清空入口和无根级横向溢出。
