# 报表统一受限月份导航：实现与对接方案

## 目标

总月报、经营分析与账户统一采用库存工作台的受限月份导航：左箭头、可点击的居中月份、右箭头，以及由中间按钮打开的月份网格。三页共享**同一个已选业务月**，但数据可用性保持模块独立：某页当月无数据只显示该页空状态，绝不自动跳转到该页最近有数据的月份。

```text
[ ‹ ]   [ 2026年7月  ▾ ]   [ › ]
                 ↓
        年份切换 + 12 个月网格
```

## 当前时间状态审计

| 范围 | 当前状态 | 当前问题 | 统一后处理 |
|---|---|---|---|
| 总月报 `app/monthly-summary.tsx` | 本地 `selectedMonth`；横向月份 Chip 由当前月向前固定生成 | 没有真实业务月份边界；路由进入时不能继承报表页所选月份 | 读取共享月份 hook；用统一导航替换本地 `MonthSelector` |
| 经营分析 `components/store/analytics.tsx` | `day/month/year/custom` 四套独立本地状态；月模式使用固定最近 24 个月 Chip | 月模式会产生没有业务含义的固定月份；不能与总月报、账户同步 | 只在 `month` 模式接入共享月份导航；日、年、自定义范围原样保留 |
| 账户 `components/store/accounts.tsx` | 本地 `selectedMonth`；固定最近 12 个月 Chip | 进入页面默认当前月，导致与上一个报表页面月份脱节 | 读取共享月份 hook；以账户空状态代替自动切换 |
| 报表页签 `app/(tabs)/store.tsx` | 当前“总月报”通过 `router.push('/monthly-summary')` 打开独立路由 | 路由没有携带月份，页面无法保持报表上下文 | 进入总月报时携带 `month` 参数，同时持久化共享月份 |

## 数据边界原则

统一月份导航的边界必须来自三个报表模块业务月份的**并集**，不是任何单一模块的可用月份。

```ts
reportMonthBounds = deriveBusinessMonthBounds([
  ...monthlySummaryReports.map((x) => x.month),
  ...monthlyReportImports.map((x) => normalizeReportMonth(x.rawMonth)),
  ...accountBalances.map((x) => x.month),
  ...revenueRecords.map((x) => x.date),
  ...pettyCashRecords.map((x) => x.date),
  ...paySlips.map((x) => x.month),
]);
// 得到：最早业务月 - 1 个月 至 最晚业务月 + 1 个月。
```

使用并集的原因是：当用户在总月报选择 `2026-07` 再切到账户时，账户即使没有余额数据也必须保留 `2026-07`；若各页面以自身数据范围重新 clamp，就会造成用户看到的跨页面跳月。

## 新增通用组件

建议将库存的日历规则从“库存”语义提升为“业务月份”语义。现有 `BoundedMonthNavigator` 的视觉、网格、边界和测试标识可以复用，但文案不可继续写“库存月份”。下方为建议新增的 `components/months/BoundedBusinessMonthNavigator.tsx`。

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import {
  addInventoryMonths as addMonths,
  canNavigateInventoryMonth as canNavigate,
  getCurrentInventoryMonth as getCurrentMonth,
  inventoryMonthLabel as monthLabel,
  inventoryMonthsForYear as monthsForYear,
  type InventoryMonth as BusinessMonth,
  type InventoryMonthBounds as BusinessMonthBounds,
} from "@/lib/inventory-core/month-browser";

export interface BoundedBusinessMonthNavigatorProps {
  month: BusinessMonth;
  bounds: BusinessMonthBounds;
  onChange: (month: BusinessMonth) => void;
  /** 例如：报表、账户、经营分析；只影响无障碍及弹窗文案。 */
  subject: string;
  testID?: string;
}

export function BoundedBusinessMonthNavigator({
  month,
  bounds,
  onChange,
  subject,
  testID = "business-month-navigator",
}: BoundedBusinessMonthNavigatorProps) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const canPrevious = canNavigate(month, -1, bounds);
  const canNext = canNavigate(month, 1, bounds);
  const available = useMemo(() => monthsForYear(year, bounds), [year, bounds]);
  const current = getCurrentMonth();

  useEffect(() => {
    if (visible) setYear(Number(month.slice(0, 4)));
  }, [visible, month]);

  const select = (next: BusinessMonth) => {
    onChange(next);
    setVisible(false);
  };

  return (
    <>
      <View testID={testID} style={S.row}>
        <Pressable
          testID={`${testID}-previous`}
          disabled={!canPrevious}
          accessibilityRole="button"
          accessibilityLabel={`上一个${subject}月份`}
          onPress={() => canPrevious && onChange(addMonths(month, -1))}
          style={[S.arrow, { backgroundColor: colors.border + "55", opacity: canPrevious ? 1 : 0.32 }]}
        >
          <IconSymbol name="chevron.left" size={15} color={colors.muted} />
        </Pressable>

        <Pressable
          testID={`${testID}-picker`}
          accessibilityRole="button"
          accessibilityLabel={`选择${subject}月份，当前${monthLabel(month)}`}
          onPress={() => setVisible(true)}
          style={[S.monthButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[S.monthText, { color: colors.foreground }]}>{monthLabel(month)}</Text>
          <IconSymbol name="chevron.down" size={14} color={colors.muted} />
        </Pressable>

        <Pressable
          testID={`${testID}-next`}
          disabled={!canNext}
          accessibilityRole="button"
          accessibilityLabel={`下一个${subject}月份`}
          onPress={() => canNext && onChange(addMonths(month, 1))}
          style={[S.arrow, { backgroundColor: colors.border + "55", opacity: canNext ? 1 : 0.32 }]}
        >
          <IconSymbol name="chevron.right" size={15} color={colors.muted} />
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <Pressable style={S.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={[S.sheet, { backgroundColor: colors.background }]} onPress={() => undefined}>
            <View style={[S.handle, { backgroundColor: colors.border }]} />
            <View style={S.header}>
              <Text style={[S.title, { color: colors.foreground }]}>选择{subject}月份</Text>
              <Pressable onPress={() => setVisible(false)} hitSlop={10}>
                <Text style={{ color: colors.muted, fontWeight: "600" }}>关闭</Text>
              </Pressable>
            </View>
            <View style={S.yearRow}>
              <Pressable disabled={year <= Number(bounds.min.slice(0, 4))} onPress={() => setYear((v) => v - 1)} style={S.arrow}>
                <IconSymbol name="chevron.left" size={15} color={colors.muted} />
              </Pressable>
              <Text style={[S.year, { color: colors.foreground }]}>{year}年</Text>
              <Pressable disabled={year >= Number(bounds.max.slice(0, 4))} onPress={() => setYear((v) => v + 1)} style={S.arrow}>
                <IconSymbol name="chevron.right" size={15} color={colors.muted} />
              </Pressable>
            </View>
            <View style={S.grid}>
              {Array.from({ length: 12 }, (_, index) => {
                const candidate = `${year}-${String(index + 1).padStart(2, "0")}` as BusinessMonth;
                const enabled = available.includes(candidate);
                return (
                  <TouchableOpacity
                    key={candidate}
                    testID={`${testID}-month-${candidate}`}
                    disabled={!enabled}
                    onPress={() => select(candidate)}
                    style={[S.cell, {
                      backgroundColor: candidate === month ? colors.primary : colors.surface,
                      borderColor: candidate === month ? colors.primary : colors.border,
                      opacity: enabled ? 1 : 0.28,
                    }]}
                  >
                    <Text style={{ color: candidate === month ? "#fff" : colors.foreground, fontWeight: "600" }}>{index + 1}月</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {current >= bounds.min && current <= bounds.max && current !== month && (
              <TouchableOpacity onPress={() => select(current)} style={[S.current, { borderColor: colors.primary }]}>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>回到本月：{monthLabel(current)}</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const S = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 8 },
  arrow: { width: 32, height: 32, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  monthButton: { minWidth: 164, minHeight: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  monthText: { fontSize: 16, fontWeight: "600" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingBottom: 34 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { fontSize: 18, fontWeight: "700" },
  yearRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 16, marginBottom: 18 },
  year: { minWidth: 90, textAlign: "center", fontSize: 16, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: { width: "22.8%", minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center", alignItems: "center" },
  current: { minHeight: 42, borderWidth: 1, borderRadius: 10, justifyContent: "center", alignItems: "center", marginTop: 20 },
});
```

## 共享状态 Hook

建议新增 `hooks/use-report-month-selection.ts`。重点不是让每个页面把自己的无数据月份 clamp 到最新数据，而是让三页读取和写入同一个已选月份。

```ts
import { useCallback, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  clampInventoryMonth as clampMonth,
  getCurrentInventoryMonth as getCurrentMonth,
  normalizeInventoryMonth as normalizeMonth,
  type InventoryMonth as BusinessMonth,
  type InventoryMonthBounds as BusinessMonthBounds,
} from "@/lib/inventory-core/month-browser";

export function useReportMonthSelection(bounds: BusinessMonthBounds) {
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string }>();
  const [storedMonth, setStoredMonth] = usePersistedState<BusinessMonth>(
    "store.report.active-month.v1",
    getCurrentMonth(),
  );

  // 路由参数只在进入独立总月报路由时优先；两者都须落在全局并集边界内。
  const requested = normalizeMonth(params.month) ?? storedMonth;
  const month = useMemo(() => clampMonth(requested, bounds), [requested, bounds]);

  const selectMonth = useCallback((next: BusinessMonth) => {
    const stable = clampMonth(next, bounds);
    setStoredMonth(stable);
    // 当前路由若支持参数则同步地址；无参数页面不会被强制重定向。
    router.setParams({ month: stable });
  }, [bounds, router, setStoredMonth]);

  return { month, selectMonth };
}
```

## 三页对接代码

### 1. 报表工作台 `app/(tabs)/store.tsx`

`ReportModule` 计算一次共享边界并保存共享月份。进入总月报时显式携带月份；经营分析和账户直接接收 `month / onMonthChange / bounds`。

```tsx
const reportBounds = useMemo(() => deriveReportMonthBounds({
  summaryReports: monthlySummaryStore.reports,
  monthlyReports: monthlyReportStore.reports,
  balances: monthlySummaryStore.balances,
  revenueRecords: revenueStore.records,
  pettyRecords: pettyStore.records,
  paySlips: paySlipStore.paySlips,
}), [monthlySummaryStore.reports, monthlyReportStore.reports, monthlySummaryStore.balances, revenueStore.records, pettyStore.records, paySlipStore.paySlips]);

const { month, selectMonth } = useReportMonthSelection(reportBounds);

<Pressable onPress={() => router.push({ pathname: "/monthly-summary", params: { month } })}>
  <Text>总月报</Text>
</Pressable>

{reportTab === "analytics" && (
  <StoreAnalyticsScreen reportMonth={month} onReportMonthChange={selectMonth} reportBounds={reportBounds} />
)}
{reportTab === "accounts" && (
  <StoreAccountsScreen reportMonth={month} onReportMonthChange={selectMonth} reportBounds={reportBounds} />
)}
```

### 2. 总月报 `app/monthly-summary.tsx`

删除内部固定月份 Chip `MonthSelector`，而不是在无数据时寻找最近报表。路由进入时调用共享 hook，并渲染统一导航。

```tsx
const reportBounds = useReportMonthBoundsFromStores();
const { month: selectedMonth, selectMonth } = useReportMonthSelection(reportBounds);

<BoundedBusinessMonthNavigator
  testID="monthly-summary-month-navigator"
  subject="总月报"
  month={selectedMonth}
  bounds={reportBounds}
  onChange={selectMonth}
/>

const hasReportData = Boolean(report?.lineItems?.length || report?.manualItems?.length);
{!hasReportData ? <MonthlySummaryEmptyState month={selectedMonth} /> : renderReport()}
```

### 3. 经营分析 `components/store/analytics.tsx`

保留日、年与自定义时间段。仅 `mode === "month"` 时使用统一导航，不能再用固定的 `MonthPicker` 最近 24 个月循环。

```tsx
function StoreAnalyticsScreen({ reportMonth, onReportMonthChange, reportBounds }: Props) {
  const [mode, setMode] = useState<PeriodMode>("month");

  {mode === "month" && (
    <BoundedBusinessMonthNavigator
      testID="analytics-month-navigator"
      subject="经营分析"
      month={reportMonth}
      bounds={reportBounds}
      onChange={onReportMonthChange}
    />
  )}

  const currentRange = mode === "month"
    ? monthRange(reportMonth)
    : /* 保持 day/year/custom 原有分支 */;

  const hasAnalyticsData = analyticsRecords.some((row) => monthOf(row.date) === reportMonth);
  if (mode === "month" && !hasAnalyticsData) return <AnalyticsEmptyState month={reportMonth} />;
}
```

### 4. 账户 `components/store/accounts.tsx`

删除内部 `defaultMonth` 与固定 12 个月 `MonthSelector`。

```tsx
function StoreAccountsScreen({ reportMonth, onReportMonthChange, reportBounds }: Props) {
  const balances = getBalancesForMonth(reportMonth);
  const report = reports.find((item) => item.month === reportMonth);

  return (
    <ScrollView>
      <BoundedBusinessMonthNavigator
        testID="accounts-month-navigator"
        subject="账户"
        month={reportMonth}
        bounds={reportBounds}
        onChange={onReportMonthChange}
      />
      {balances.length === 0
        ? <AccountEmptyState month={reportMonth} />
        : <AccountCards balances={balances} report={report} month={reportMonth} />}
    </ScrollView>
  );
}
```

## 无数据不跳月：路由与状态同步伪代码

```text
GLOBAL STATE
  activeReportMonth = persisted("store.report.active-month.v1")
  reportBounds = unionBounds(summary, analytics, accounts, supporting monthly records)

ON USER SELECT MONTH(next)
  canonical = clamp(next, reportBounds)
  activeReportMonth = canonical
  persist(activeReportMonth)
  if current route has month param:
    replace route parameter with canonical
  render current page for canonical

ON SWITCH analytics ↔ accounts
  keep activeReportMonth unchanged
  do not read page's latestDataMonth
  if current page has no canonical-month data:
    render its dedicated empty state
  else:
    render canonical-month data

ON OPEN total monthly report
  push("/monthly-summary?month=" + activeReportMonth)
  total report resolves URL month first, then persisted value
  no effect may call setMonth(latestReportMonth)

ON DATA LOAD / SYNC HOT RELOAD
  recompute reportBounds
  if activeReportMonth inside reportBounds:
    keep it unchanged
  else:
    clamp once to bounds edge and persist
  never select latest record merely because current page has no data
```

## 兼容性风险与防护

| 风险 | 产生原因 | 防护措施 |
|---|---|---|
| 总月报路由和工作台使用不同月份 | 总月报是独立路由，而经营分析/账户是工作台内组件 | 使用同一持久化键；进入总月报同时写入 URL `month` 参数 |
| 无数据时自动跳到其他月份 | 组件加载后使用 `latestReport` 回填本地状态 | 删除该类回填；仅在共享全局边界发生变化且当前月超界时 clamp 一次 |
| 经营分析日/年/自定义范围被破坏 | 经营分析不是纯月度页面 | 月份导航只接管 `mode === "month"`；其他三种模式保持原状态与现有选择器 |
| 不同模块日期格式造成边界漏月 | `YYYY-MM`、日期 ISO、中文月份并存 | 边界收集前统一调用 `normalizeInventoryMonth` |
| 同步重载覆盖用户刚选月份 | 异步数据加载后重建组件本地默认月份 | 已选月份上移到共享 hook；页面不再拥有独立默认月份 |
| 存量深链接失效 | 旧路径没有 `month` 参数 | 参数可选；缺失时读取共享持久化月，再回退当前月 |

## 必须新增的自动化护栏

1. 在 320、375、430pt 下，三页均出现同样的“上一月 / 中间快速选月 / 下一月”结构，且根级没有横向溢出。
2. 在总月报选中 `2026-07` 后切到经营分析和账户，两页均接收 `2026-07`。
3. 经营分析 `2026-07` 无数据时显示“2026年7月暂无经营分析数据”，不得变成最新有数据月份。
4. 账户 `2026-07` 无余额时显示空状态，不得影响总月报和经营分析的月份。
5. 从经营分析进入总月报，URL 参数与共享持久化月份一致；返回后月份不变。
6. 在经营分析切换日、年、自定义范围时，保留最后一次共享月份；重新切回“某月”后恢复该月份。
7. 热重载/云同步加入新月份时，只有当已选月超出全局业务范围才可 clamp；不得默认跳到最新月份。

## 实施顺序

先抽取通用业务月份组件和边界收集器，再接入账户、经营分析，最后接入独立路由总月报并补 URL 同步。这样可以先验证工作台内共享状态，再处理跨路由月份保持，降低一次性重构的状态风险。
