# App 全局功能与逻辑审计报告

> **审计对象**：`relaxRG/CR`，审计基线提交 `20a56fa`  
> **审计日期**：2026-08-20  
> **审计方式**：全库静态代码、路由、Provider、功能契约、同步引擎、存储治理、严格未使用符号检查，以及 H5 移动端回归结果复核。  
> **审计结论**：App 的业务能力覆盖完整，五 Tab 权限和同步边界已经具备较强的制度化约束；当前主要风险不是核心业务缺失，而是**历史兼容界面重复、巨型页面/Store、手工维护的数据清理范围、以及大量未使用符号**。本报告为审计结论，不执行任何删除或生产数据操作。

---

## 执行摘要

该项目是一个 React Native + Expo Router 的餐饮经营管理 App，采用 **“本地 AsyncStorage 状态仓库优先 + 设备配对云同步 + Worker 策略核验”** 的架构。顶层面向用户的业务入口已收敛为 **鸡尾酒、葡萄酒、研发、餐食、门店** 五个 Tab；门店内部再使用同页页签承载报表、员工、备用金、库存与店铺工作台。[1] [2]

项目当前代码量较大，核心业务已具备持续化、离线编辑、跨设备同步、冲突提示、月结归档、导入导出、备份等能力。但架构上存在两类需要优先治理的“历史增量成本”：第一类是**数据治理入口与当前同步体系不完全同源**，尤其旧数据管理页仍保留手工键清单与 `AsyncStorage.clear()`；第二类是**功能重构后的 UI/类型/状态残留**，严格编译发现 311 条生产代码未使用符号诊断。

> **重要判断**：核心账本、权限和同步功能并非“不可用的旧架构”。问题集中在“旧页面/旧入口/旧字段清理尚未完全产品化”和“模块体积过大导致重构遗留”。应优先收敛，而不是重新推翻五 Tab、事件账本或 DeviceSessionV2 架构。

---

# 一、功能与界面清单（Features & Screens）

## 1.1 代码数量与结构规模

| 统计维度 | 数量 | 说明 |
|---|---:|---|
| 代码文件 | **511** | `300` 个 `.ts`、`182` 个 `.tsx`、其余为脚本与 Worker 文件 |
| 生产与基础设施代码行 | **122,505 行** | `app/lib/components/hooks/server/workers/scripts` 下 TypeScript/JavaScript 文件 |
| 测试代码行 | **13,806 行** | `125` 个测试文件 |
| App 路由文件 | **83** | 去除布局文件后为 `81` 个页面路由文件 |
| Root Stack 注册 | **62** | 根布局显式声明的 Stack 页面 |
| 顶层功能契约 | **38** | 其中 `31` 个共享同步功能、`7` 个本地功能 |
| 同步业务键 | **94** | 由同步引擎与功能契约共同治理 |
| 根级业务 Provider | **40** | 根布局中实际嵌套的状态 Provider |
| 隐藏 Tab 路由 | **8** | 用于兼容旧路径或直达子工作台 |
| 开发/诊断路由 | **2** | `/dev/money-input-lab`、`/dev/theme-lab` |
| 一次性迁移源文件 | **7** | 含书库退役、旧月份、空排班和旧固定工资字段清理 |

| 目录 | 代码文件数 | 行数 | 职责 |
|---|---:|---:|---|
| `app` | 83 | 54,383 | 页面、路由、业务编排 |
| `lib` | 184 | 44,754 | Store、领域引擎、同步、导入导出、主题与迁移 |
| `components` | 58 | 11,736 | 通用 UI、库存/门店展示组件 |
| `hooks` | 11 | 426 | 页面状态与权限辅助 Hook |
| `server` | 20 | 4,974 | 服务端路由及运行时辅助 |
| `workers` | 2 | 3,388 | Cloudflare Worker、设备与同步接口 |
| `scripts` | 28 | 3,743 | 发布、门禁、H5 回归、注册表生成 |
| `tests` | 125 | 13,806 | 单元、集成、回归与策略测试 |

### 复杂度热点

| 文件 | 行数 | 审计判断 |
|---|---:|---|
| `app/labor.tsx` | **5,599** | 员工、排班、薪资、调休、月结、核对、跳转同时聚合，属于最高优先级拆分目标 |
| `app/spirits-inventory.tsx` | **3,800** | 进销存、导入、供应商、月结、表格交互混合，维护成本高 |
| `app/recipe-form.tsx` | **2,800** | 配方编辑、AI 补全、原料联动、表单状态混杂 |
| `workers/cocktail-ai/worker-v4.js` | **2,972** | 设备、策略、同步、文件与 AI API 复用同一 Worker 文件，需按路由域拆分 |
| `server/routers.ts` | **2,573** | 服务端 API 入口集中，存在横向耦合风险 |
| `app/homemade-form.tsx` | **2,428** | 自制品表单、成本、分类和联动过于集中 |

这些文件不等于错误，但其体积说明：任何一次功能微调都容易留下未使用 state、事件处理器和样式，正是本轮严格编译发现大量残留的主要来源。

## 1.2 用户可见的正式功能

| 顶层业务域 | 已实现功能 | 数据与执行方式 |
|---|---|---|
| **鸡尾酒** | 配方库、分类/标签、配方详情、配方编辑、成本/酒精度估算、原料智能链接、酒款库、自制品、酒单、采购清单、对比 | 本地 Store + AsyncStorage；照片和共享业务键参与同步；AI 补全走异步 Worker 请求 |
| **葡萄酒** | 酒款目录、产区/品种筛选、详情与编辑、葡萄酒库存工作台、当月进货、Excel 导入/导出、月末盘点 | 本地 Store 先写入，再由同步引擎按策略推送；导入/导出是异步文件操作 |
| **研发** | 研发项目、批次、配方关联、项目对比、研发计划、在售清单、采购清单 | 项目/批次/计划使用独立 Store；工作台内同页分段切换，详情与表单使用 Stack 路由 |
| **餐食** | 菜单、食材、食材详情、食材表单、采购记录、供应商导入 | 本地持久化；与门店月报、供应商汇总联动 |
| **门店—报表** | 总月报、经营分析、账户、时段经营分析、月度导入、菜品分析、账户/付款管理 | 同页四分段；总月报从薪资、备用金、烈酒/葡萄酒/食材采购与上传报表聚合 |
| **门店—员工** | 员工档案、排序、归档、排班、考勤、薪资草稿、预支、绩效/补贴、调休、薪资核对、发薪历史、月结/更正 | 本地账本与结算器；已确认月份归档；调休兑现只通过事件快照进入薪资 |
| **门店—备用金** | 备用金记录、分类、库存关联、人工已付关联、月度汇总 | 本地 Store；联动总月报与薪资核对 |
| **门店—库存六类** | 烈酒、葡萄酒、水果、食材、啤酒、冰块：台账、采购、盘点、月结、导入/导出 | 各类库存 Store；共享台账组件与月结模型；按策略同步 |
| **门店—店铺四类** | 杯具、餐具、日用品、设备：台账、库存与维护信息 | 共享库存工作台，部分资源为 local-only、部分共享同步 |
| **系统与治理** | 设备管理、配对、五 Tab 权限、同步日志、备份/恢复、数据管理、角色说明、标签/分类/卡片标签、冰块设置 | DeviceSessionV2、Cloudflare Worker、SecureStore/AsyncStorage、备份快照与诊断工具 |

## 1.3 全部现有界面与路由

### A. 五个用户可见的顶级 Tab

| 路由 | 界面 | 状态 |
|---|---|---|
| `/cocktail` | 鸡尾酒聚合工作台：配方、酒款、自制品 | **正式主入口** |
| `/wine` | 葡萄酒目录：列表、产区、品种 | **正式主入口** |
| `/lab` | 研发：清单、计划清单、研发计划 | **正式主入口** |
| `/food` | 餐食：菜单、食材 | **正式主入口** |
| `/store` | 门店：报表、员工、备用金、库存、店铺 | **正式主入口** |

### B. 内容、编辑与详情界面

| 路由 | 界面 | 入口性质 |
|---|---|---|
| `/recipe/[id]`、`/recipe-form` | 配方详情、编辑/新建 | 正式详情与模态表单 |
| `/bottle/[id]`、`/bottle-form`、`/bottle-channels` | 酒款详情、编辑、渠道 | 正式详情与模态表单 |
| `/homemade/[id]`、`/homemade-form` | 自制品详情、编辑 | 正式详情与模态表单 |
| `/wine/[id]`、`/wine-form` | 葡萄酒详情、编辑 | 正式详情与模态表单 |
| `/food/[id]`、`/food-form` | 菜品详情、编辑 | 正式详情与模态表单 |
| `/food-ingredient/[id]`、`/food-ingredient-form` | 食材详情、编辑 | 正式详情与模态表单 |
| `/menu`、`/shopping` | 酒单与采购清单 | 隐藏 Tab 兼容页，也被局部流程直达 |
| `/compare` | 配方/自制品横向对比 | 正式功能，来源于配方/自制品卡片 |

### C. 研发界面

| 路由 | 界面 | 入口性质 |
|---|---|---|
| `/lab/projects`、`/lab/[id]` | 项目列表、项目详情 | 正式页面 |
| `/lab/new`、`/lab/batch-form` | 新建项目、批次编辑 | 模态/编辑流程 |
| `/lab/compare` | 项目/配方比较 | 项目详情内跳转 |
| `/lab/plan` | 研发计划 | 嵌入式工作台与直达路由并存 |

### D. 员工、薪资、月结界面

| 路由 | 界面 | 入口性质 |
|---|---|---|
| `/labor` | 员工、排班、薪资聚合工作台 | 门店内嵌为主，也支持直达 |
| `/labor-employees`、`/labor-employee-profile`、`/labor-employee-form`、`/labor-employee-sort`、`/labor-archived` | 员工列表、档案、编辑、排序、归档 | 正式详情/管理页 |
| `/labor-attendance` | 单员工考勤、薪资、调休与草稿重建 | 正式详情页 |
| `/labor-advances` | 薪资预支 | 正式页面 |
| `/labor-kpi-allowance`、`/labor-kpi-allowance-edit` | KPI/补贴管理与编辑 | 正式页面 |
| `/labor-salary-history` | 员工发薪历史 | 正式页面 |

### E. 门店、库存、报表与导入界面

| 路由 | 界面 | 入口性质 |
|---|---|---|
| `/monthly-summary`、`/period-analysis`、`/store-accounts`、`/dish-analysis` | 总月报、时段分析、账户、菜品分析 | 多数由 `/store` 内嵌复用，也支持直达 |
| `/monthly-report-import` | 月度报表导入 | 正式导入流程 |
| `/spirits-inventory`、`/wine-inventory`、`/wine-inventory-import` | 烈酒/葡萄酒库存及导入 | 正式独立工作台 |
| `/beer-inventory`、`/ice-inventory`、`/fruit-inventory`、`/food-inventory` | 啤酒、冰块、水果、食材库存 | 正式独立路由；复用共享库存组件 |
| `/glassware-inventory`、`/tableware-inventory`、`/daily-inventory`、`/equipment-inventory` | 杯具、餐具、日用品、设备台账 | 正式独立路由；复用共享库存组件 |
| `/suppliers`、`/supplier-import` | 供应商管理与导入 | 正式页面 |
| `/petty-category-settings` | 备用金分类设置 | 模态管理页 |
| `/store-hours` | 门店营业时段配置 | 正式设置页 |

### F. 系统、数据与设备界面

| 路由 | 界面 | 状态 |
|---|---|---|
| `/me` | 当前独立个人中心 | **当前实际入口**：门店头像跳转至此页 |
| `/device-manager`、`/pair-device`、`/role-guide`、`/role-settings` | 设备、配对、权限说明与角色设置 | 正式系统页面 |
| `/backup`、`/sync-log`、`/data-manager` | 备份、同步日志、数据清理 | 正式治理页面 |
| `/tags`、`/system-tags`、`/taxonomy-manager`、`/card-tag-settings`、`/ice-settings` | 标签、分类、显示与冰块设置 | 正式设置页面 |
| `/bulk-import` | 批量导入 | 正式工具页 |
| `/oauth/callback` | OAuth 回调 | 系统回调，不面向人工导航 |

### G. 隐藏、兼容与开发界面

| 路由 | 状态 | 审计结论 |
|---|---|---|
| `/`（`(tabs)/index`） | 隐藏兼容 | 仅 `replace('/cocktail')`，合理重定向 |
| `/library` | **隐藏兼容，重复** | 与 `/cocktail` 都聚合配方、酒款、自制品；使用不同持久化分段键，属于高价值合并对象 |
| `(tabs)/me` | **隐藏兼容，重复** | 与根 `/me` 的功能集合大幅重复，且 URL 语义易冲突 |
| `(tabs)/bottles`、`/homemade`、`/menu`、`/shopping`、`/recipes` | 隐藏子工作台 | 仍被局部功能或旧深链使用；不应未经兼容策略直接删除 |
| `/dev/money-input-lab` | 开发实验页 | 不是普通导航入口，但 Expo 路由可被深链；发布版建议移出 `app/` 或加显式开发门禁 |
| `/dev/theme-lab` | 开发实验页 | 同上 |

---

# 二、核心业务逻辑与执行方式（Logic & Execution）

## 2.1 启动、状态与持久化总链路

```text
App 启动
  → RootLayout 初始化运行时、安全区、QueryClient
  → 执行历史迁移/清理器
  → 挂载 40 个业务 Provider
  → 各 Provider 从 AsyncStorage 读取并进入 ready 状态
  → 页面读取 Context/Hook 并渲染
  → 用户操作调用 Store handler
  → 先更新 React state，再异步写 AsyncStorage
  → notifySyncChange(storageKey)
  → 同步引擎记录修改时间、按设备策略推送
```

根布局承担启动迁移、全局 Provider 装配、Stack 注册和主题/安全区的统一装配。[1] 绝大部分 Store 的典型写入模式是：`setState` 立即刷新 UI，`AsyncStorage.setItem` 异步持久化，再向同步引擎发送键变更通知。[3]

**执行方式**：以本地优先为主。用户在断网时可查看缓存并编辑允许编辑的草稿；同步、AI、导入/导出、月结等动作则依据功能契约和在线条件进行限制。[2]

## 2.2 跨设备同步与权限链路

```text
已有设备凭据
  → Worker DeviceSessionV2 核验成员资格与策略
  → cfPull 拉取远端键值
  → runInitialSync：空本地保护 + ID/字段级合并 + 冲突收集
  → triggerStoreReload 让 Provider 重读持久化数据
  → 按 STORAGE_POLICY 与能力过滤 cfPush
  → WebSocket 实时通知 / 前后台恢复 / 网络恢复触发受控重试
```

同步 Provider 具有以下关键安全行为：未配对设备保持本地单机模式，不会自动创建同步组；推送只依据 Worker 核验后的能力策略；弱网时从已核验会话降级为离线缓存；重试使用单定时器和最大次数限制；冲突由用户选择本地、云端或批量处理。[4] 同步引擎对 ID 列表执行字段级 LWW 合并，对偏好数据采用“有利优先”合并，并防止空设备覆盖云端。[5]

**执行方式**：异步网络请求 + 本地持久化合并。该链路是本项目最成熟的基础设施之一，但同步键、功能契约、存储注册表和数据清理页仍存在多处配置来源，后续应继续收敛为单一生成源。

## 2.3 员工、排班、调休与薪资链路

```text
员工档案 + 班次模板 + 排班 + 特殊状态
  → calculateAttendanceFromShifts()
  → MonthlyAttendance
  → 薪资附加项、预支、绩效、社保与个税结算
  → 调休余额 → CompOffCashOutEvent → verified settlement snapshot
  → PaySlip 草稿
  → 月结归档 / 已确认月更正会话
  → 总月报 labor 科目与员工付款记录
```

劳务 Store 将员工、排班、考勤、工资单、调休、预支、月结快照等拆分为多个持久化键，并通过计算器和月结操作门禁完成草稿/归档边界。[3] 调休兑现已不允许直接在工资单保存裸金额；只有经事件、费率、金额、来源和状态验证后的快照能进入薪资，这是防止历史孤儿金额回流的正确单向链路。

**执行方式**：主要本地结算、异步持久化和共享同步。月结、导出和部分高风险操作受权限/在线约束；已确认记录保留历史，通过更正会话而非删除修改。

## 2.4 总月报与经营分析聚合链路

```text
选定月份
  → 读取备用金、烈酒采购、葡萄酒快照/手工进货、食材采购、供应商、薪资、上传报表
  → aggregateMonthlyReport()
  → 非 labor 科目覆盖写入
  → labor 科目由 paySlip 变化的防抖同步维护
  → 自动生成/更新供应商货款与员工薪资付款记录
  → 月结归档或创建更正会话
```

总月报不会仅依赖一个表单输入，而是从多个模块读取当月源数据。薪资科目由工资单变化触发的 800ms 防抖同步维护；手工项目、付款状态、重复标记在月报对象中独立保存。自动汇总前会显示来源记录数，并要求用户确认覆盖。[6]

**执行方式**：本地跨 Store 聚合。该设计能避免重复输入，但月报页面体积较大，且“自动同步 + 手动覆盖 + 付款派生”集中在一个组件中，后续需要抽离聚合服务和付款投影层。

## 2.5 导入、导出、AI 与文件链路

| 场景 | 执行方式 | 关键边界 |
|---|---|---|
| Excel/PDF 导入 | 文件选择 → 解析器 → 预览/确认 → Store 写入 | 本地解析为主，导入后参与同步 |
| 月度报表导入 | 文件归档 → 菜品/报表解析 → 月报/经营分析 Store | 原始导入文件由归档 Store 管理 |
| AI 补全 | 页面表单 → `smart-router` → Worker API | React Query mutation 不自动重试，调用者处理错误 |
| 图片同步 | 本地图片路径 → 云端上传/下载/路径修复 | 同步后触发 Store 重载 |
| 备份恢复 | 本地快照 + iCloud/导出文件 | 应与新业务基线流程统一，不能只清 AsyncStorage |

---

# 三、废弃与冗余代码清理（Technical Debt）

## 3.1 严格未使用符号检查结果

以 `tsc --noUnusedLocals --noUnusedParameters` 进行审计，发现 **328 条**诊断：其中 **311 条位于生产代码**，**17 条位于测试代码**。这不代表 311 个独立功能都不可用，但每条都表示“当前文件中定义、解构或导入后没有被使用”，应作为真实重构残留处理，而不是忽略。

| 区域 | 未使用诊断 | 典型问题 | 建议 |
|---|---:|---|---|
| `app` | **206** | 历史 state、handler、import、样式、未接入批量动作 | 按页面拆分清理，优先员工/烈酒/配方/自制表单 |
| `lib` | **75** | 旧单位常量、未接入计算器参数、未使用 Store import | 清理公共 API 前先做跨文件引用核验 |
| `components` | **30** | 共享组件导入、图表变量、门店视觉令牌残留 | 删除前确认没有动态 JSX 引用 |
| `tests` | **17** | 未用 fixture、assertion 常量、类型 import | 与生产修复同批清理 |

### 高置信度可直接删除的候选

以下是严格检查明确标出的、本地未被引用的候选，适合在独立清理提交中删除：

| 文件/区域 | 候选 | 风险等级 |
|---|---|---|
| `app/(tabs)/bottles.tsx` | `handleBatchEnrich`、`missingCount`、`chipStyle`、旧拖拽列表常量 | 中：先确认产品不再需要批量 AI 补全入口 |
| `app/(tabs)/homemade.tsx` | `groupPrepsByName`、`deleteBottle`、`updateBottle`、子标签样式 | 低至中 |
| `app/backup.tsx` | `handleICloudRestore`、`icloudRestoring` | **高**：若恢复功能已取消，应删除入口、状态和文案；若仍要保留，应补回 UI 调用 |
| `app/device-manager.tsx` | `handleChangeRole` | 高：当前五 Tab 模型已替代旧角色配置时，应删除旧角色变更路径 |
| `app/dish-analysis.tsx` | `CATEGORY_TABS`、`categoryFilter` | 高：分类筛选 UI 已移除但状态仍残留 |
| `app/homemade-form.tsx` | `handleDeepAnalyze`、`handlePasteImport`、实时估算映射 | 中：确认是否已无按钮引用 |
| `app/recipe-form.tsx` | `handleAiEnrich`、`handlePasteImport`、用户覆盖 state | 中：应核对是否有功能被删 UI 后留下 handler |
| `app/spirits-inventory.tsx` | 供应商/进货批量操作、匹配内存、分类管理、导出菜单的一批未用解构 | **高**：巨型页面经历多次重构后仍留有大段遗留状态 |
| `app/monthly-summary.tsx` | 账户标签、付款复制、旧配置常量与部分 Store 方法 | 中 |
| `lib/cf-sync/provider.tsx` | `saveDeviceCredentials` import | 低 |
| `lib/labor/store.tsx` | 多个未用类型/日期/调休辅助 import | 低 |

## 3.2 结构性技术债

### P0：数据管理页与当前“全新业务基线”目标不一致

`app/data-manager.tsx` 仍维护一套手工 `RECIPE_KEYS/BOTTLE_KEYS/PREP_KEYS/.../ALL_KEYS` 清单，且危险区直接调用 `AsyncStorage.clear()`。这与当前项目已有的存储注册表、SecureStore 设备凭据、同步组、业务键和新基线策略不一致。[7]

**风险**：选择性清理会遗漏后续新增模块键；“恢复出厂”只清本地 AsyncStorage，不会原子处理设备凭据、同步队列、云端成员资格或旧组回流；导出的备份也只覆盖少量早期键。

**处理建议**：删除手工键清单和裸 `AsyncStorage.clear()`，改为基于 `local-storage-registry.json + FEATURE_CONTRACTS + SyncProvider` 的受确认重置工作流：只读备份 → 停止同步 → 轮换本机凭据 → 切换/新建同步组 → 清空受注册表管理的业务键 → 验证空基线。

### P1：巨型页面与巨型 Provider

`app/labor.tsx`、`app/spirits-inventory.tsx`、`app/recipe-form.tsx` 等页面同时承担 UI、状态编排、计算、导入、弹窗、权限、路由和数据重建。根布局又直接嵌套 40 个 Provider。[1]

**风险**：逻辑改动的影响面大，未使用 state/handler 容易积累，加载和重渲染难以局部化，测试难以按领域覆盖。

**处理建议**：将“页面容器”“领域 Hook/Controller”“纯计算器”“展示组件”拆层；根 Provider 改为按五个 Tab 的领域 Provider 聚合，结合页面级懒加载或延迟初始化。

### P1：同步配置存在多处维护源

同步键在 `SYNC_KEYS`、`FEATURE_CONTRACTS`、`STORAGE_POLICY`、存储注册表和数据管理清理页出现。CI 已能检查一部分契约，但数据管理页仍手工维护旧键。

**处理建议**：以功能契约和存储策略为唯一机器可读源，生成 `SYNC_KEYS`、本地注册表、备份范围、数据清理范围和诊断标签；禁止页面内写硬编码清理列表。

### P2：`any` 类型逃逸较多

正则审计发现约 **303** 处 `as any`/`: any` 逃逸（该数字是文本扫描数量，不等同于 TypeScript 风险数量）。主要集中在大型页面、路由参数和跨 Store 聚合。

**处理建议**：优先为同步 entries、月报聚合输入、库存表格 row、路由参数和薪资对账创建 DTO；对外部 Excel/JSON 入口使用 schema 校验，而不是在 UI 内反复 `as any`。

### P2：迁移器缺少统一退役台账

当前有 7 个迁移源文件，根布局启动时并行触发其中多个。书库退役清理已具备精确范围、幂等与失败重试；其余迁移仍主要靠注释和历史提交说明判断是否应移除。

**处理建议**：建立 `migration-registry.ts`：每项迁移声明版本、键范围、首次上线版本、最晚移除版本、是否可重试；启动只运行登记项，CI 在到期后阻止迁移长期留存。

### P2：开发路由在发布包中可被深链访问

`/dev/money-input-lab` 与 `/dev/theme-lab` 位于 `app/dev`，虽然没有常规导航入口，但仍是 Expo 可发现路由。

**处理建议**：开发构建以外排除 `app/dev`，或将入口改为仅 `__DEV__` 可见并对生产深链返回 404/安全占位；若不再需要，直接删除。

---

# 四、页面跳转与路由合理性检查（Navigation Audit）

## 4.1 合理且已收敛的路由模式

| 场景 | 当前实现 | 审计判断 |
|---|---|---|
| 五 Tab 切换 | 使用 `router.navigate('/{tab}')` | 合理：避免重复压栈，保持顶级业务切换稳定 |
| 门店内部导航 | 主页签与报表子页签在同一 `/store` 页面嵌入切换 | **符合用户要求**：不反复跳转，不新建重复入口 |
| 导入完成跳转 | `router.replace('/wine-inventory')` 或 `replace('/(tabs)/store')` | 合理：成功页不应返回导入完成态 |
| 新建研发项目 | 创建后 `replace('/lab/[id]')` | 合理：避免“新建页 → 详情页 → 再返回新建页”的死循环 |
| 库存独立页面 | 共享 `BaseInventoryScreen` 在 `embedded=false` 时提供 `router.back()` | 合理：静态扫描未见页面自身 `back()` 不代表缺少返回 |
| OAuth 回调 | 成功/失败后替换回 Tab | 合理：系统回调无需人工返回 |

未发现由 `router.push`/`router.replace` 直接形成的显式循环跳转。对于静态扫描中“无 `router.back()`”的库存页，已核对为共享组件提供返回栏，属于**误报已排除**。

## 4.2 重复造轮子与可合并界面

### P1：`/library` 与 `/cocktail` 功能同构

`/cocktail` 是当前正式鸡尾酒聚合页，内嵌配方、酒款、自制品三屏；隐藏 `/library` 也以不同标题和不同持久化分段键重新内嵌同一组三屏。[8]

**问题**：两页承载相同业务对象、相同子屏、相近统计和相近筛选行为，却维护两套头部、文案和持久化 tab 键。它是当前最明确的“已有界面却重新造了类似界面”的实例。

**建议**：保留 `/library` 作为一次性兼容重定向，迁移 `library.tab.v2 → cocktail.tab.v1` 后 `replace('/cocktail')`；经过设定版本窗口后删除页面和旧键。

### P1：两个“我的”页面高度重叠

当前门店头像跳转根 `/me`；隐藏 Tab `(tabs)/me` 也实现了统计、标签、导入、分类、设备同步、备份等高度重叠功能。两者 UI 文案、i18n 覆盖和返回模式不同。[9]

**建议**：确定根 `/me` 为唯一产品入口；隐藏 Tab 页改为兼容重定向或抽取同一 `MeContent` 组件；移除重复状态解构与菜单数组。特别应避免路由组导致两个实现争用同一 URL 语义。

### P2：嵌入页与直达页的边界需要统一声明

总月报、经营分析、账户、时段分析、员工主工作台、库存页面均可被 `/store` 内嵌，也存在独立 Stack 路由。这种“同一组件 `embedded`/直达复用”本身是正确的，不是重复造轮子；但部分独立页缺少明确的“直达场景”标注。

**建议**：为每个独立路由声明 `routeMode: 'standalone' | 'embedded-reusable' | 'legacy-alias' | 'system-callback'`。只有 `legacy-alias` 才允许被隐藏；`embedded-reusable` 必须由共享组件提供统一返回行为。

### P2：直达入口不足的管理页面

静态检查将 `/lab/plan`、`/store-accounts` 标为“未显式 `router.back()`”。这不等于 bug：它们主要被内嵌使用。但若用户通过深链或外部通知直达，返回路径应由顶层 Header/BackButton 明确保证。

**建议**：增加路由级 E2E：从深链打开每个 Stack 页面，验证可返回上级或安全回到所属顶级 Tab。

---

# 五、优化建议清单（Action Items）

## 5.1 立即执行（P0）

| 行动 | 应删除/替换内容 | 验收标准 |
|---|---|---|
| **重做数据管理危险操作** | 删除手工 `ALL_KEYS`、裸 `AsyncStorage.clear()`、早期局部备份键表 | 重置、备份、切组、凭据轮换和云端回流阻断都由统一基线服务驱动 |
| **建立备份/重置单一事实来源** | 页面内硬编码键列表 | 由存储注册表和功能契约生成备份与清理范围；新增键未登记时 CI 失败 |

## 5.2 本轮重构优先执行（P1）

| 行动 | 应删除/合并内容 | 预期收益 |
|---|---|---|
| **合并 `/library` 到 `/cocktail`** | `library.tsx` 独立壳、`library.tab.v2` | 消除同构页面与筛选状态分裂 |
| **合并 `(tabs)/me` 与 `/me`** | 隐藏 Tab 的重复布局、菜单、同步/备份状态 | 个人中心只有一个产品事实来源 |
| **建立 unused-code 清理批次** | 311 条生产未使用诊断中的 imports、states、handlers、styles | 减少包体、认知成本与误导性 API |
| **优先拆分三大巨型页面** | `labor.tsx`、`spirits-inventory.tsx`、`recipe-form.tsx` | 降低回归风险；让计算、导入、UI 各自可测 |
| **抽出根 Provider 领域聚合层** | 40 层手写 Provider 嵌套 | 降低启动复杂度，支持按 Tab 延迟初始化 |

## 5.3 后续治理（P2）

| 行动 | 说明 |
|---|---|
| 为 `any` 建立收敛预算 | 先阻止新增，再按同步/财务/导入/路由优先级替换为 DTO 与 schema |
| 建立迁移注册表与退出日期 | 不允许一次性迁移器无最晚移除版本长期运行 |
| 隔离或删除开发路由 | 发布构建不可访问 `/dev/*` |
| 补足深链返回 E2E | 所有 Stack 页面从冷启动直达时均能安全返回所属业务 Tab |
| 使用生成式配置 | 从功能契约生成同步、备份、清理和诊断清单，消除多处手工维护 |

---

## 建议的实施顺序

> **第 1 周：先消除数据风险。** 完成数据管理页重构与全新业务基线服务，补充“旧组不回流、新组为空、备份可验证”的 E2E。
>
> **第 2 周：再收敛导航事实来源。** 将 `/library`、隐藏 `(tabs)/me` 迁移为兼容重定向，建立路由模式声明和深链返回测试。
>
> **第 3–4 周：处理规模与死代码。** 以 311 条未使用诊断为清单分批删除，每批必须通过类型、测试、H5 回归；同时优先拆解 `labor.tsx` 与 `spirits-inventory.tsx`。
>
> **持续治理：让约束自动化。** 将 no-unused、开发路由、迁移到期、存储键生成和 `any` 增量预算纳入 CI，防止同类债务回流。

---

## 证据索引

[1]: https://github.com/relaxRG/CR/blob/20a56fa/app/_layout.tsx "根布局、Provider 与 Stack 路由"
[2]: https://github.com/relaxRG/CR/blob/20a56fa/lib/sync/feature-contract.ts "全 App 功能契约、同步与离线策略"
[3]: https://github.com/relaxRG/CR/blob/20a56fa/lib/labor/store.tsx "劳务 Store 的持久化与薪资链路"
[4]: https://github.com/relaxRG/CR/blob/20a56fa/lib/cf-sync/provider.tsx "DeviceSessionV2、同步、重试、冲突与切组"
[5]: https://github.com/relaxRG/CR/blob/20a56fa/lib/sync/engine.ts "同步键、合并、冲突与存储刷新"
[6]: https://github.com/relaxRG/CR/blob/20a56fa/app/monthly-summary.tsx "月报自动汇总、薪资同步与付款投影"
[7]: https://github.com/relaxRG/CR/blob/20a56fa/app/data-manager.tsx "数据管理页、手工键清单与恢复出厂实现"
[8]: https://github.com/relaxRG/CR/blob/20a56fa/app/(tabs)/cocktail.tsx "当前鸡尾酒聚合页" ； https://github.com/relaxRG/CR/blob/20a56fa/app/(tabs)/library.tsx "隐藏资料库兼容页"
[9]: https://github.com/relaxRG/CR/blob/20a56fa/app/me.tsx "当前独立个人中心" ； https://github.com/relaxRG/CR/blob/20a56fa/app/(tabs)/me.tsx "隐藏 Tab 个人中心"

---

## 审计限制

本报告基于当前提交的静态代码、注册表、路由配置、测试和已执行的 H5 回归。未连接生产数据库，未读取任何用户设备的实际业务数据，也未执行删除、迁移、Worker 部署或数据重置。严格未使用诊断可准确识别当前文件内未被消费的局部符号，但跨包公开导出仍须在删除前进行二次引用审计。
