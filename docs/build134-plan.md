# Build 134 完整实现计划：月报系统 v2

## 总体目标

将月报系统升级为完整的「收支往来管理中心」，实现：
1. 备用金分类可配置归属（库存模块 / 人工 / 固定成本 / 其他）
2. 库存模块可配置是否在月报单独显示
3. 月报科目行全面支持手工增删改 + isDuplicate 手工切换
4. 货款 Tab 展示所有科目的付款卡片（含备用金已付项）
5. 部分付款功能（供应商 + 员工）
6. 收入行从经营分析自动匹配

---

## Phase 1：数据层升级

### 1A. 备用金分类配置表（新增）

新增持久化配置 `petty_code_config.v1`，存储每个备用金分类的归属配置：

```typescript
interface PettyCodeConfig {
  code: PettyCode;
  /** 归属库存模块（spirits / wine / food / beer / ice / null） */
  inventoryModule: "spirits" | "wine" | "food" | "beer" | "ice" | null;
  /** 是否归属人工成本 */
  isLabor: boolean;
  /** 是否在月报中单独显示（false = 归入备用金汇总） */
  showInReport: boolean;
  /** 自定义显示标签（覆盖默认 code label） */
  customLabel?: string;
}
```

**默认配置**（内置，用户可覆盖）：

| 分类 | inventoryModule | isLabor | showInReport |
|------|----------------|---------|--------------|
| A1-A10 | food | false | true |
| B1 | spirits | false | true |
| B2 | spirits | false | true |
| B3 | spirits | false | true |
| D1-D3 | null | true | false |
| K1 | null | true | false |
| K9 | null | true | false |
| L1-L2 | null | false | true |
| M1-M2 | null | false | true |
| 其他 | null | false | false |

**存储位置**：月报 store（`useMonthlySummaryStore`）新增 `pettyCodeConfigs` 字段

---

### 1B. 库存模块月报配置（新增）

新增持久化配置 `inventory_report_config.v1`：

```typescript
interface InventoryReportConfig {
  module: "spirits" | "wine" | "food" | "beer" | "ice";
  /** 是否在月报中单独显示（false = 归入备用金汇总） */
  showInReport: boolean;
  /** 月报分组标签 */
  groupLabel: string;
}
```

**默认配置**：

| 模块 | showInReport | groupLabel |
|------|-------------|------------|
| spirits | true | 烈酒 |
| wine | true | 葡萄酒 |
| food | true | 食材 |
| beer | true | 啤酒 |
| ice | true | 冰块 |

**存储位置**：月报 store 新增 `inventoryConfigs` 字段

---

### 1C. MonthlyPaymentRecord 扩展

新增字段：
```typescript
interface MonthlyPaymentRecord {
  // ...现有字段...
  /** 来源类型（用于货款 Tab 分组） */
  sourceType: "supplier" | "employee" | "petty" | "rent" | "utilities" | "manual";
  /** 来源标识（备用金分类代码 / 供应商ID / 员工ID） */
  sourceKey: string;
  /** 显示标签 */
  displayLabel: string;
  /** 付款方式标注（已付备用金 / 待付转账 / 已付微信） */
  paymentMethodNote: string;
}
```

---

### 1D. SummaryLineItem 扩展

新增字段：
```typescript
interface SummaryLineItem {
  // ...现有字段...
  /** 用户手工设置的 isDuplicate（优先于自动检测） */
  manualDuplicate?: boolean;
  /** 关联的备用金分类代码 */
  pettyCode?: string;
  /** 关联的库存模块 */
  inventoryModule?: string;
}
```

---

## Phase 2：聚合器升级

### 2A. 收入行生成规则

从经营分析 `paymentMethods` 生成：
- 正数 → 收入行（绿色）
- 负数 → 支出扣减行（红字，如手续费/服务费）
- 无数据 → 不生成行（不强制显示空行）

### 2B. 支出行生成规则

**备用金分类处理逻辑**（按 `PettyCodeConfig`）：

```
for each pettyCode:
  config = getPettyCodeConfig(code)
  
  if config.inventoryModule != null:
    inventoryConfig = getInventoryConfig(config.inventoryModule)
    if inventoryConfig.showInReport:
      → 生成独立科目行，归入对应库存分组
      → 标注「已付(备用金)」
      → 从备用金汇总中排除
    else:
      → 归入备用金汇总行
      → 库存分析仍然使用该数据
  
  elif config.isLabor:
    if config.showInReport:
      → 生成独立科目行，归入人工分组
      → 从备用金汇总中排除
    else:
      → 归入备用金汇总行
  
  elif code in [L1, L2, M1, M2]:
    → 始终生成独立科目行（固定成本）
    → 从备用金汇总中排除
  
  else:
    → 归入备用金汇总行
```

### 2C. 防重叠自动检测

```
for each lineItem:
  if item.pettyCode != null and item.inventoryModule != null:
    // 检查是否有来自库存进货的同类科目行
    inventoryItem = items.find(i => i.inventoryModule == item.inventoryModule && i.source != "petty_cash")
    if inventoryItem exists and inventoryItem.amount ≈ item.amount:
      item.isDuplicate = true
      item.duplicateNote = "与库存进货记录金额重叠，请核对后保留其中一项"
```

---

## Phase 3：月报页面升级

### 3A. 科目行长按菜单（所有行）

```
长按任意科目行 → Alert 菜单：
  ├── 「标记为已在其他科目计入（不重复叠加）」（当前未标记时）
  ├── 「取消重复标记」（当前已标记时）
  ├── 「编辑」（仅手工录入行）
  ├── 「删除」（仅手工录入行）
  └── 「取消」
```

### 3B. 新增科目行 Modal 升级

新增科目行时，弹出选择：
```
新增科目行类型：
  ├── 「链接备用金分类」→ 选择备用金分类代码 → 自动填入金额和标签
  ├── 「链接库存模块」→ 选择库存模块 → 自动填入进货金额
  ├── 「链接经营分析」→ 选择 paymentMethod 字段 → 自动填入金额（收入行）
  └── 「独立录入」→ 手工填写所有字段
```

### 3C. 备用金配置入口

在月报设置页面新增「备用金分类配置」：
- 列出所有备用金分类
- 每个分类可设置：归属库存模块 / 是否人工 / 是否单独显示
- 保存后下次一键汇总时生效

---

## Phase 4：货款 Tab 全面升级

### 4A. 分组结构

```
货款 Tab
├── 食材（A1-A10，已付备用金）
│   ├── A1 新鲜肉类  ¥3,382  已付(备用金)
│   ├── A2 新鲜海鲜  —       已付(备用金)
│   └── ...
├── 酒水
│   ├── B1 啤酒现结  —       已付(备用金)
│   ├── B2 酒水配料  ¥730    已付(备用金)
│   ├── B3 酒水耗材  ¥25     已付(备用金)
│   ├── 至缘烈酒     ¥12,423 待付  [复制][已付]
│   ├── 戒恒烈酒     —       待付
│   ├── 甘澧         ¥2,240  待付  [复制][已付]
│   └── ...
├── 工资
│   ├── 苟瑞雪       ¥14,300 待发  [复制][录入发放]
│   ├── 赵彦九       ¥7,540  部分  [复制][录入发放]
│   └── ...
├── 房租
│   ├── 店铺房租(M1) ¥64,000 待付  [复制][已付]
│   └── 仓库房租(M2) ¥2,200  待付  [复制][已付]
├── 水电
│   ├── 电费(L1)     ¥2,973  已付(微信)
│   └── 水费(L2)     ¥364    已付(微信)
└── 备用金其他
    └── 其他费用汇总  ¥5,666  已付(备用金)
```

### 4B. 部分付款功能

**「录入付款」Modal**：
```
录入付款
├── 本次付款金额：[输入框，默认=待付金额]
├── 付款方式：[转账 / 现金 / 微信 / 支付宝]
├── 付款账户：[公司账户 / 私人账户 / 备用金]
├── 付款日期：[日期选择，默认今天]
├── 备注：[输入框]
└── [确认付款] [取消]
```

确认后：
- `paidAmount += 本次金额`
- `remainingAmount = totalAmount - paidAmount`
- `status = paidAmount >= totalAmount ? "paid" : "partial"`
- 添加到 `payments[]` 历史记录

### 4C. 手工增删改

```
货款 Tab 底部：
├── [+ 新增货款卡片] → 选择来源（备用金/供应商/独立）
└── 长按任意卡片 → [编辑] [删除] [取消]
```

---

## Phase 5：薪资 Tab 升级

### 5A. 兼职同步

备用金中归属人工的分类（K1 固定兼职、K9 临时兼职、D1-D3 员工福利等）：
- `showInReport = true` → 在薪资 Tab 中显示独立卡片
- 卡片标注「已付(备用金)」，无需银行转账操作

### 5B. 部分发放功能

与货款 Tab 相同的「录入发放」Modal，支持：
- 分批发放（预支 + 尾款）
- 历史发放记录展开查看

---

## Phase 6：TypeScript 检查 + 提交

---

## 工作量估算

| Phase | 文件改动 | 估计行数 | 复杂度 |
|-------|---------|---------|--------|
| 1A-1D 数据层 | types.ts, store.tsx, petty-store.tsx | +200行 | 中 |
| 2A-2C 聚合器 | aggregator.ts | 重写 ~500行 | 高 |
| 3A-3C 月报页面 | monthly-summary.tsx | +300行 | 中 |
| 4A-4C 货款Tab | monthly-summary.tsx | +400行 | 高 |
| 5A-5B 薪资Tab | monthly-summary.tsx | +150行 | 中 |
| 6 TS检查 | — | — | 低 |

**总计**：约 1550 行新增/修改，预计 4-6 个 Build 完成

---

## 实施顺序建议

**Build 134**：Phase 1（数据层）+ Phase 2（聚合器）
**Build 135**：Phase 3（月报页面科目行操作）+ Phase 4A（货款Tab分组）
**Build 136**：Phase 4B（部分付款）+ Phase 4C（手工增删改）+ Phase 5（薪资Tab）
**Build 137**：全面 TypeScript 检查 + 测试修复 + 文档
