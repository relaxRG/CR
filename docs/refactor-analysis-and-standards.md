# 重构分析与开发规范报告

## 1. 导出功能重构影响分析

### 1.1 受影响的关联逻辑与引擎

本次员工管理导出功能重构（由单一 CSV 升级为 Excel/PDF 双引擎多报表），对项目的多个层级产生了深远影响。在 **UI 层 (`app/labor.tsx`)**，我们彻底移除了旧的单一导出按钮以及原有的纯文本 CSV 剪贴板复制逻辑，取而代之的是右上角的「↑」菜单，该菜单提供了 6 个细分的导出选项。同时，为了实现职责分离，UI 层不再直接依赖 `expo-file-system` 和 `expo-sharing`，这些底层 API 被统一剥离。

在 **业务逻辑层 (`lib/labor/export.ts`)**，我们构建了全新的独立导出引擎。该引擎封装了 `buildPayrollWorkbook` 和 `buildScheduleWorkbook` 用于生成复杂的 Excel 表格，并引入了 HTML 模板引擎（`buildPayrollHtml` 和 `buildScheduleHtml`）以支持高质量的 A3 横向 PDF 打印。此外，文件写入与系统分享（`Sharing.shareAsync`）的错误处理机制也在此层得到了统一封装。

在 **类型定义 (`lib/labor/types.ts`)** 方面，导出的细化字段严格依赖于 `MonthlyAttendance` 和 `PaySlip` 接口的最新定义。特别是排班表导出，高度依赖于 `ShiftHoursValue` 类型，这要求我们在引擎中妥善处理 `number | "休" | "无早" | null` 这种复杂的联合类型。

### 1.2 旧代码与冲突代码清理

在全面的代码扫描与重构过程中，我们针对旧代码残留与逻辑冲突进行了深度清理。

首先是**废弃字段引用修复**。旧代码中错误引用了不存在的 `att?.overtimeBonus` 字段，现已精准更正为 `MonthlyAttendance` 接口中正确的 `att?.overtimePay`。同样，不存在的 `att?.holidayDays` 引用也被移除，由于节假日相关逻辑已完全迁移至 `PaySlip` 统一处理，此处的冗余计算已被安全置为 0。

其次是**类型安全修复**。在处理 `ShiftHoursValue` 的工时累加时，原逻辑直接相加导致了 `string | number` 联合类型的严重报错。我们通过引入严格的类型守卫（`typeof s.hoursValue === 'number'`），有效过滤了诸如 "休" 或 "无早" 等非数字类型，确保了数学运算的绝对安全。

最后是**冗余 Import 清理**。随着底层 API 调用的下沉，我们从 `app/labor.tsx` 中彻底清除了 `expo-file-system/legacy` 和 `expo-sharing` 的引入，确保了 UI 组件的纯粹性。

---

## 2. Bug 产生原因分析

在重构过程中暴露出的字段名错误（如 `overtimeBonus`）和联合类型报错，深刻反映了项目在高速迭代中积累的技术债务。

**类型定义分散与迭代遗留**是首要原因。`types.ts` 在从 V1 到 V3 的多次架构升级中，经历了剧烈的变动。例如，加班费逻辑从 `PaySlip` 迁移至 `MonthlyAttendance`，字段名也随之更改为 `overtimePay`。然而，导出引擎在初期构建时，过度依赖了开发者的旧有记忆或过期的上下文文档，未能与最新的接口定义保持同步，最终导致了对废弃字段的错误调用。

**联合类型的隐式转换陷阱**导致了编译期的严重阻塞。`ShiftHoursValue` 作为一个高度灵活的联合类型，允许传入非数字值（如代表休息的 "休"）。但在执行 `reduce` 数组累加时，原逻辑缺乏必要的类型守卫，直接进行加法运算，触发了 TypeScript 对 `string | number` 无法应用于 `+` 运算符的严格保护机制。

此外，**UI 与底层逻辑耦合过深**也增加了重构的难度。在旧架构中，文件系统操作（FileSystem）和分享调度（Sharing）被直接硬编码在 UI 组件（`labor.tsx`）内部。这种设计不仅违背了单一职责原则，还导致在导出逻辑被抽离后，UI 组件中仍潜伏着难以察觉的冗余依赖包。

---

## 3. 开发规范建议

为根治上述问题，防止类型错误、废弃字段残留和状态不同步的再次发生，我们提炼了以下核心开发规范，建议将其纳入项目的 `dev-standards.md` 中。

| 规范维度 | 核心原则 | 具体执行标准 |
| :--- | :--- | :--- |
| **强类型与数据模型** | 杜绝主观猜测，严控联合类型 | 编写复杂逻辑前，必须通过 `npx tsc` 或查阅 `types.ts` 确认最新字段。处理如 `ShiftHoursValue` 等联合类型时，数学运算前必须使用显式的类型守卫（`typeof val === 'number'`），严禁滥用 `?? 0` 进行隐式转换。 |
| **模块化与职责分离** | 底层 API 强制下沉，统一业务入口 | 涉及 `expo-file-system`、`expo-sharing` 等设备级 API 的操作，必须封装在如 `lib/*/export.ts` 的专用引擎中。页面组件仅负责调用 `exportData(type, data)`，严禁在 UI 层处理缓存读写或格式转换。 |
| **废弃代码清理** | 践行"童子军规则"，同步无死角清理 | 新增重构逻辑后，必须在同一 Commit 内利用正则全局搜索（如 `grep -rn "exportCSV"`）扫除旧有按钮、拼接逻辑及冗余 Import。废弃字段需先通过 `/** @deprecated */` 标记并排查所有引用点，确认无误后方可物理删除。 |
| **即时响应式更新** | 坚持单一真实数据源（SSOT） | 坚决避免在 UI 层维护与全局 Store 冗余的 Local State。例如，薪资条目的勾选状态必须即时写入 `PaySlip` 的 `allowanceOverrides`，防止因组件卸载导致的状态丢失与同步失败。 |

---

## 4. 修复方案推广（举一反三）

本次重构确立的「独立导出引擎 + 强类型校验 + UI 解耦」三位一体方案，不仅解决了员工管理模块的痛点，更为整个 App 的架构演进提供了标准范式。该方案可直接推广应用于以下核心模块：

在**烈酒库存导出模块 (`spirits/export.ts`)** 中，应立即启动针对 `app/spirits-inventory.tsx` 的专项审查，确保其已彻底剥离对 `FileSystem` 和 `Sharing` 的底层依赖，完全拥离纯粹的 UI 渲染职责。

对于**月报导出模块 (`monthly-report.tsx`)**，未来若面临从简单图表向专业 Excel/PDF 报表的升级需求，应无缝复用本次在 `lib/labor/export.ts` 中沉淀的 HTML 转 PDF 模板架构（基于 `expo-print`），从而避免重复造轮子。

针对**数据备份导出模块 (`backup.tsx`)**，尽管其目前仅依赖纯文本 JSON 分享，但仍应全面引入本次重构中标准化的 `try-catch` 错误处理模式。这将确保全端在调用 `Sharing.shareAsync` 时，能够提供一致且优雅的异常捕获与用户提示体验。
