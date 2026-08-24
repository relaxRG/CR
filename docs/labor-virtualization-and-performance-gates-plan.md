# 人力大数据虚拟化、PR 性能门禁与夜间套件实施方案

**作者：Manus AI**  
**日期：2026-08-24**

## 一、问题与目标

当前人力排班工作区在同一组件中同时挂载排班网格页和考勤卡片页。排班页以纵向 `ScrollView` 直接渲染所有 `calendarWeeks`，考勤页以 `allDeptEmployees.map(...)` 直接渲染全部员工卡片；两页又放在同一个横向分页容器中。因而在 500 名员工、10,000 条排班记录及大量调休/考勤事实的场景下，即使用户只看其中一个横向页面，两个完整子树仍会参与首次渲染和内存占用。

最近的 H5 大数据观测中，劳动路由首次加载约为 **6.86 秒**，最大帧间隔约 **1,411ms**，DOM 节点约 **24,220**。这是观测型压力脚本的结果，尚未作为硬性失败阈值；但它明确说明当前全量挂载策略不适合极端数据规模。

> 目标不是把 10,000 条排班逐条“分页显示”而继续在内存中全量构建，而是使 UI、派生模型和计算任务都遵循**按月、按部门、按员工窗口和按可视区域**的渐进工作方式。

## 二、建议的目标架构

| 层次 | 当前风险 | 目标改造 | 预期效果 |
|---|---|---|---|
| 路由/页面层 | 排班页和考勤页同时挂载 | 横向 pager 仅挂载当前页，邻页只保留轻量占位；切页时再挂载目标页 | 立刻减少一半以上的首屏 JSX 与派生工作 |
| 排班列表层 | 多个周块通过 `ScrollView` 全量渲染 | 采用按部门分组的 `SectionList`，或扁平员工行 `FlatList` | 屏幕外员工行不创建原生视图/DOM |
| 考勤列表层 | `allDeptEmployees.map(...)` 创建 500 张卡片及潜在展开内容 | 采用 `FlatList`，收起卡固定行高，展开卡按 ID 局部失效 | 仅渲染可视窗口和少量 overscan 行 |
| 事实投影层 | 多处从 10,000 条排班记录重复扫描、`find`、`filter` | 每月构建一次不可变 `LaborMonthReadModel`，维护 employeeId→shift 数组、attendance、comp-off 的 Map | 从重复 O(员工×排班) 扫描转为一次 O(排班) 建索引 + O(可视员工) 读取 |
| 重计算调度 | 月份切换、搜索、编辑可能抢占首次交互 | 使用 revision/generation ticket、`useDeferredValue` 与 `InteractionManager` 分批构建非关键汇总 | 旧月份/旧筛选结果永不回写，首屏先可操作 |

### 2.1 P0：先拆开两个横向页面的实际挂载

当前横向 `ScrollView` 内的排班网格和考勤卡片同时存在。应改为由 `schedulePagerIndex` 控制：当前页面立即挂载，邻页在预加载状态只呈现轻量壳；用户完成滑动或明确点击后再加载该页。这样不会改变现有「排班表 / 考勤概况」的交互语义，但会显著降低初次构建量。

```tsx
const shouldMountGrid = schedulePagerIndex === 0 || hasVisitedGrid;
const shouldMountAttendance = schedulePagerIndex === 1 || hasVisitedAttendance;

<HorizontalPager index={schedulePagerIndex} onIndexChange={setSchedulePagerIndex}>
  <SchedulePageShell>{shouldMountGrid ? <VirtualizedScheduleGrid /> : null}</SchedulePageShell>
  <AttendancePageShell>{shouldMountAttendance ? <VirtualizedAttendanceList /> : null}</AttendancePageShell>
</HorizontalPager>
```

`hasVisitedGrid` 和 `hasVisitedAttendance` 应仅记录用户是否到过页面，不应以月份变化重置；月份变化只使 read model revision 更新。若需要维持滑动顺畅，可在用户停留当前页后用 `InteractionManager.runAfterInteractions` 预加载相邻页，而不是在首屏并行挂载。

### 2.2 P1：排班网格采用“员工行虚拟化 + 周切片”

排班的自然虚拟化单位应是**员工行**，而不是每个班次格。每行只渲染员工信息与当前 7 天的单元格；周切片由用户切换，默认只显示当前周或包含当天的一周。500 名员工在 5 周布局下若全量渲染会形成 2,500 行级工作量，虚拟化后通常只保持 12–24 行可视窗口。

推荐的数据与组件边界如下：

```ts
type ScheduleWindowQuery = Readonly<{
  month: string;
  weekStart: string;
  departmentIds: readonly string[];
  search: string;
  revision: string;
}>;

type ScheduleEmployeeRow = Readonly<{
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: EmployeeDept;
  days: readonly DayShiftCell[]; // 固定 7 格
}>;

function VirtualizedScheduleGrid({ query }: { query: ScheduleWindowQuery }) {
  const { rows, refreshRevision } = useScheduleWindow(query);
  return (
    <SectionList
      sections={groupScheduleRowsByDepartment(rows)}
      keyExtractor={(row) => row.employeeId}
      renderItem={({ item }) => <MemoScheduleEmployeeRow row={item} />}
      renderSectionHeader={({ section }) => <DepartmentHeader title={section.title} />}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      removeClippedSubviews
      getItemLayout={isFixedRowHeight ? fixedScheduleRowLayout : undefined}
      extraData={refreshRevision}
    />
  );
}
```

当系统字体倍率、名称折行、展开编辑状态或辅助功能导致行高不固定时，必须关闭 `getItemLayout`；不能为追求滚动性能而破坏可访问性或裁切内容。收起员工行可使用固定高度，例如 52px；编辑模式下应把编辑器移至 modal/浮层或独立“编辑行”，避免把任意一行永久变成可变高大块。

### 2.3 P1：考勤页采用可展开 `FlatList`

考勤页不应再以 `allDeptEmployees.map` 生成所有卡片。应将现有收起卡拆成纯展示的 `AttendanceSummaryRow`，把加班、节假日、调休兑换等大量内容放进按 `employeeId` 控制的详情组件。只有当前展开的员工才渲染详情。

```tsx
const expandedEmployeeIds = useAttendanceExpansionStore((state) => state.expandedIds);

<FlatList
  data={filteredEmployees}
  keyExtractor={(employee) => employee.id}
  renderItem={({ item }) => (
    <AttendanceEmployeeCard
      employee={item}
      summary={attendanceByEmployee.get(item.id)}
      expanded={expandedEmployeeIds.has(item.id)}
      onToggle={() => toggleExpanded(item.id)}
    />
  )}
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  windowSize={7}
  removeClippedSubviews
/>
```

展开状态、输入框草稿和调休面板状态必须以 `employeeId` 为键存储在页面级 reducer 或专用 store。这样虚拟列表卸载屏幕外行时不会丢失用户正在编辑的草稿；重新挂载同一行也不会错误复用另一名员工的状态。

### 2.4 P1：一次建索引，窗口化读取

目前大数据风险不仅在视图，也在重复计算。排班、考勤、调休和薪资单应该针对当前月构建一次只读索引：

```ts
type LaborMonthReadModel = Readonly<{
  revision: string;
  activeEmployees: readonly Employee[];
  employeesById: ReadonlyMap<string, Employee>;
  shiftsByEmployee: ReadonlyMap<string, readonly Shift[]>;
  attendanceByEmployee: ReadonlyMap<string, AttendanceSummary>;
  compOffByEmployee: ReadonlyMap<string, readonly CompOffEntry[]>;
  payrollByEmployee: ReadonlyMap<string, PaySlip>;
}>;
```

构建流程先以单次循环处理 10,000 条排班，填充 `shiftsByEmployee`；再对 500 名活跃员工生成摘要。渲染每一行时只用 O(1) Map 查找，而不是在 JSX 中调用 `find`、`filter`、`getShifts` 或重新汇总。对于搜索和部门筛选，仅对 `activeEmployees` 进行过滤，不重新扫描排班事实。

若 read model 构建超过一帧，应采用 generation ticket：月份、筛选条件或事实 revision 变化时产生新 ticket；旧任务完成后仅当 ticket 仍为当前值才提交。重计算可按 50–100 名员工分块，通过 `InteractionManager` 或短任务调度让首屏输入和滚动优先完成。

### 2.5 P2：持久化快照与分页边界

AsyncStorage 仍会把单个键完整读入内存，因此“UI 分页”不能解决存储层的 10,000 条全量解析。建议将排班按 `YYYY-MM` 分片，并为每月维护轻量 manifest：

```ts
labor.shifts.manifest.v2
labor.shifts.2026-04.v2
labor.attendance.2026-04.v2
labor.comp-off.2026-04.v2
```

manifest 仅保存可用月份、revision、分片校验和及迁移版本。进入某月时只加载该月的排班分片；跨月汇总只读取摘要快照。迁移期间需双读旧 `labor_shifts_v1` 与新分片，校验行数、员工数和总工时一致后再切换写入；旧数据不应在未完成迁移前删除。

## 三、实施顺序与验收门槛

| 阶段 | 改动范围 | 回归测试 | 推荐验收门槛 |
|---|---|---|---|
| P0 | Pager 按页挂载；考勤详情惰性渲染 | 500 员工/10,000 排班 H5 场景，确认首屏仅渲染当前页 | DOM 节点显著低于当前约 24,220；无功能/状态丢失 |
| P1 | `SectionList` 排班行、`FlatList` 考勤卡、稳定 row memo | 字体倍率、展开后滚出/滚回、快速切周、快速切月、编辑草稿保留 | H5 最大帧间隔 P95/最大值分别建立基线后收紧；常规滚动保持 16ms 预算 |
| P2 | `LaborMonthReadModel`、Map 索引、ticket 取消 | 旧请求不得回写；单条班次编辑只更新所属员工行；500/10,000 压力基准 | 不再在 JSX 内对全量 shifts 重复扫描 |
| P3 | 月分片 manifest 与渐进迁移 | 双读一致性、断电恢复、旧版回退、月结历史不可变 | 当前月只读取本月分片；历史月按需加载 |

建议先连续三次采集无回归基线，再把目标写入 CI。初始可将 `/labor` 10,000 条场景的首屏等待、DOM 节点、堆内存增量和长帧作为观测值；完成 P0/P1 后再将以下预算设为硬门禁：首屏可操作时间、最大帧间隔、可视 DOM 上限、堆增量和切周/切月更新耗时。阈值必须按稳定运行环境的中位数和容差确定，不能仅凭一次沙箱测量设死。

## 四、将10,000条采购压力测试设为GitHub合并门禁

当前工作流已包含唯一 Job 名称 **`High-frequency render performance`**，该 Job 已运行常规 Profiler 套件和 `tests/store-purchase-virtualization-stress.test.tsx`。要让失败真正阻止合并，需要在仓库层增加分支保护；仅有工作流文件不会自动禁止点击 Merge。

在 GitHub 仓库页面完成以下操作：

1. 进入 **Settings → Branches**；如果仓库界面使用新版规则，请进入 **Settings → Rules → Rulesets**。创建或编辑匹配 `main` 的规则。
2. 启用 **Require a pull request before merging**。这可防止直接推送绕过 PR 检查。
3. 启用 **Require status checks to pass before merging**，并勾选 **Require branches to be up to date before merging**，以严格模式在最新 `main` 上重新验证。
4. 从最近运行过的检查列表中选择以下准确 Job 名称：

```text
Provider Stability Matrix
High-frequency render performance
```

5. 对管理员也启用 **Do not allow bypassing the above settings**；否则有管理员权限的账号仍可绕过失败检查。
6. 不要对这两个 Job 使用 `paths-ignore` 或 job 级 `if` 跳过。GitHub 将 `skipped` 视为成功，若性能 Job 被跳过，会削弱门禁效果。
7. 创建一个临时 PR 并故意降低 `visibleRows` 断言或将采购虚拟窗口设置为全量，确认 Merge 面板显示 **High-frequency render performance — failing** 且合并按钮被阻止；完成后关闭并删除该临时分支。

GitHub 官方文档明确指出，受保护分支的 required check 必须成功、跳过或中性才能合并；并提醒跨工作流的同名 Job 会造成歧义。因此性能 Job 名称必须保持唯一。[1] [2]

## 五、当前夜间性能套件完整实现

夜间入口在 `package.json` 的 `scripts` 中，完整定义如下：

```json
{
  "test:performance:quick": "vitest run tests/price-history-hook-render-regression.test.tsx tests/virtualized-ledger-render-performance.test.tsx tests/labor-overview-render-performance.test.tsx tests/spirits-inventory-workspace-render-performance.test.tsx tests/store-analytics-render-performance.test.tsx tests/store-petty-cash-render-performance.test.tsx tests/store-purchase-render-performance.test.tsx --reporter=dot",
  "test:performance:stress": "vitest run tests/store-purchase-virtualization-stress.test.tsx --reporter=dot",
  "test:performance:policy": "vitest run tests/app-performance-marks.test.ts tests/app-workspace-performance-policy.test.ts tests/global-month-stress-e2e-policy.test.ts tests/offline-cache-performance-policy.test.ts tests/schedule-workspace-performance-policy.test.ts tests/startup-sync-performance-policy.test.ts tests/store-analytics-performance-policy.test.ts tests/store-inventory-period-performance-policy.test.ts tests/store-labor-performance-policy.test.ts tests/store-purchase-performance-policy.test.ts tests/wine-workbench-performance-policy.test.ts tests/store-performance-stress-harness.test.ts --reporter=dot",
  "test:performance:nightly:core": "pnpm test:performance:quick && pnpm test:performance:stress && pnpm test:performance:policy",
  "test:performance:nightly": "pnpm test:performance:nightly:core && CI=true npx expo export --platform web --output-dir dist-web && node scripts/h5-store-large-dataset-stress-e2e.mjs && node scripts/h5-global-month-stress-e2e.mjs"
}
```

该分层有明确目的。快速套件适合 pre-commit 和 PR；10,000 条采购压力覆盖虚拟窗口不退化；策略测试验证关键性能约束仍被代码保持；夜间套件再进行 Web 静态导出与真实 H5 大数据场景。移动端真实 iOS/Android 帧率、冷启动和内存峰值仍应通过设备基线工作流补充，不能由浏览器 Profiler 取代。

## References

[1] [GitHub Docs — About protected branches](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)

[2] [GitHub Docs — Status checks](https://docs.github.com/en/pull-requests/reference/status-checks)
