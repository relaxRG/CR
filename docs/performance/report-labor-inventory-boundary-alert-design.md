# 报表、人力、库存子边界与 iOS 性能告警实施设计

## 一、共享事实与子边界规则

共享内核只保留跨两个以上功能域使用的唯一事实实例，例如业务月份、同步会话、配方、酒款、自制、供应商采购与葡萄酒事实。门店子边界只能拥有一个 Tab 内可写的事实。报表读取其他域时使用只读物化视图，不可通过投影写回。

| 子边界 | 唯一可写事实 | 只读投影输入 | 输出行为 |
|---|---|---|---|
| `report` | 收入、月报、菜品分析、时段分析、经营分析、月度汇总 | 人力、库存、备用金、供应商采购、葡萄酒事实的月度摘要 | 更新报表自身草稿、重新计算报表投影 |
| `labor` | 员工、排班、考勤、薪资、预支、调休、节假日、提醒 | 备用金关联的只读摘要 | 写人力事实或导航到备用金详情 |
| `inventory` | 烈酒、啤酒、冰块、水果、食材库存与库存月结 | 葡萄酒、供应商采购、门店四类库存的只读月度摘要 | 写库存事实或导航到拥有域 |

## 二、报表 Provider 与只读物化视图

```tsx
// components/providers/StoreReportProviders.tsx
export function StoreReportProviders({ children }: { children: React.ReactNode }) {
  return (
    <RevenueProvider>
      <MonthlyReportProvider>
        <DishAnalysisProvider>
          <PeriodAnalysisProvider>
            <MonthlySummaryProvider>
              <StoreReportReadModelProvider>{children}</StoreReportReadModelProvider>
            </MonthlySummaryProvider>
          </PeriodAnalysisProvider>
        </DishAnalysisProvider>
      </MonthlyReportProvider>
    </RevenueProvider>
  );
}
```

`StoreReportReadModelProvider` 只接收同步注册表或共享内核提供的月度快照。它不导出 `add`、`update`、`delete` 一类命令，也不注册第二组同步键。

```ts
export interface StoreReportReadModel {
  month: string;
  labor: Readonly<{ payrollCost: number; advanceNet: number }>;
  inventory: Readonly<{ purchaseCost: number; consumptionCost: number; closingValue: number }>;
  petty: Readonly<{ expense: number; inflow: number; closingBalance: number }>;
  suppliers: Readonly<{ purchaseTotal: number }>;
}

export function buildStoreReportReadModel(input: ReportSnapshotInput): StoreReportReadModel {
  return {
    month: input.month,
    labor: Object.freeze({ payrollCost: input.payrollCost, advanceNet: input.advanceNet }),
    inventory: Object.freeze({ purchaseCost: input.purchaseCost, consumptionCost: input.consumptionCost, closingValue: input.closingValue }),
    petty: Object.freeze({ expense: input.pettyExpense, inflow: input.pettyInflow, closingBalance: input.pettyClosingBalance }),
    suppliers: Object.freeze({ purchaseTotal: input.supplierPurchaseTotal }),
  };
}
```

报表页只依赖 `useStoreReportReadModel()`；报表修正操作只能调用 `useMonthlyReportStore()` 等其自身 Provider 的命令。输入摘要在同步重载、导入完成、月切换以及进入报表 Tab 时刷新。

## 三、人力 Provider 与备用金只读摘要

```tsx
// components/providers/StoreLaborProviders.tsx
export function StoreLaborProviders({ children }: { children: React.ReactNode }) {
  return (
    <EmployeeProvider>
      <CustomDeptProvider>
        <DeptOrderProvider>
          <ShiftProvider>
            <ShiftTemplateProvider>
              <AttendanceProvider>
                <PaySlipProvider>
                  <SalaryAdvanceProvider>
                    <AdvanceCategoryProvider>
                      <CompOffBalanceEntryProvider>
                        <HolidayConfigProvider>
                          <UnexplainedRestAlertProvider>{children}</UnexplainedRestAlertProvider>
                        </HolidayConfigProvider>
                      </CompOffBalanceEntryProvider>
                    </AdvanceCategoryProvider>
                  </SalaryAdvanceProvider>
                </PaySlipProvider>
              </AttendanceProvider>
            </ShiftTemplateProvider>
          </ShiftProvider>
        </DeptOrderProvider>
      </CustomDeptProvider>
    </EmployeeProvider>
  );
}
```

备用金到人力的关联事实仍由备用金域拥有。人力域只接收 `PettyLaborReferenceReadModel`：按员工与月份提供已关联金额、记录数和稳定备用金记录 ID。人力域不得在本地过滤或保存备用金完整流水；用户点击关联项时使用记录 ID 跳转备用金详情。

## 四、库存 Provider 与跨库存摘要

```tsx
// components/providers/StoreInventoryProviders.tsx
export function StoreInventoryProviders({ children }: { children: React.ReactNode }) {
  return (
    <SpiritsInventoryProvider>
      <BeerInventoryProvider>
        <IceInventoryProvider>
          <FruitInventoryProvider>
            <FoodInventoryProvider>
              <InventoryMonthCloseProvider>{children}</InventoryMonthCloseProvider>
            </InventoryMonthCloseProvider>
          </FruitInventoryProvider>
        </IceInventoryProvider>
      </BeerInventoryProvider>
    </SpiritsInventoryProvider>
  );
}
```

葡萄酒事实和供应商采购事实继续使用共享内核的唯一实例。库存 Tab 对店铺四类和葡萄酒只使用 `InventoryReferenceReadModel`，该投影只返回按月的采购、消耗、期末金额、归档状态和名称索引。跨域项的编辑操作通过导航转入拥有域，不在库存域复制或写入外部事实。

## 五、迁移与删除步骤

| 阶段 | 改动 | 旧代码退役 | 回归测试 |
|---|---|---|---|
| 报表 | 先加入 `StoreReportReadModelProvider`，再把报表可写 Provider 迁出全栈。 | 删除报表页直接使用人力/库存/备用金可写 Context 的路径。 | 月份切换、导入后重算、同步重载、月报修正。 |
| 人力 | 将所有人力事实迁入 `StoreLaborProviders`。 | 删除人力页直接装配备用金 Provider 的兼容代码。 | 排班、考勤、薪资、预支、调休、备用金关联跳转。 |
| 库存 | 将烈酒及四类原料库存迁入 `StoreInventoryProviders`。 | 删除库存页装配店铺四类或葡萄酒第二实例的代码。 | 库存/采购导入、月结、价格渠道、跨域详情。 |
| 收尾 | 用 `StoreTabBoundary` 替换门店全栈装配。 | 删除旧 `StoreFeatureProviders` 中所有已迁出事实 Provider。 | Tab 往返、深链、离线恢复、权限与移动压力。 |

## 六、iOS 性能 CI 失败告警

性能校验器输出结构化报告，失败时由 `notify-ios-performance.mjs` 生成匿名告警载荷。载荷包含构建号、候选/基线设备摘要、失败指标、可复现工作流链接和 24 字符 SHA-256 指纹；不包含业务数据、图片、采购、员工或网络凭据。

```text
fingerprint = SHA-256(sort(failures) + candidateDevice).slice(0, 24)
```

Webhook 接收端可使用 `Idempotency-Key` 和 `X-Performance-Alert-Fingerprint` 去重。同一失败组合在同一设备上重复发生时，只更新既有告警而不重复打扰。若未配置 `PERFORMANCE_ALERT_WEBHOOK_URL`，脚本仍输出 JSON 并成功退出，保证诊断和原始 CI 失败不被通知系统故障掩盖。设置 `PERFORMANCE_ALERT_STRICT=true` 可将 webhook 故障升级为 CI 失败。

```yaml
# 供现有或未来 macOS 性能工作流复用的失败步骤
- name: Upload performance report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: ios-performance-report
    path: artifacts/ios-performance-*.json

- name: Notify performance regression
  if: failure()
  env:
    PERFORMANCE_ALERT_WEBHOOK_URL: ${{ secrets.PERFORMANCE_ALERT_WEBHOOK_URL }}
    PERFORMANCE_BUILD_ID: ${{ github.sha }}
  run: node scripts/ci/notify-ios-performance.mjs artifacts/ios-performance-report.json
```

Webhook 地址必须作为 CI secret 配置，不写入仓库、环境日志或性能报告。当前未假设任何外部通知服务，也不会在未得到用户提供或启用的通知通道时主动向外发送消息。
