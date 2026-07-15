# 当前任务上下文

## 待修复的两个问题

### 问题 1：装饰条目无法进入 Garnish Tab
- 根本原因：用户在 homemade-form.tsx 选了 "Other"（key: "other"），该类型属于 `misc` 分区，`misc` 分区的 group 是 `non_alcoholic`，所以条目被归入无酒精 Tab，而非 Garnish Tab
- isGarnishType 判断逻辑（第 127-131 行）：只看 type -> section -> group，不看用户是否想要装饰
- handleSave 只有 isGarnishType 为 true 时才写 abvGroup: "garnish"
- 修复方案：在表单顶部增加"顶层分组"选择器（含酒精/无酒精/装饰），用户可显式选择，保存时写入 abvGroup

### 问题 2：类型标签全部混在一起
- 根本原因：homemade-form.tsx 第 386-455 行已经按 PREP_GROUPS 分组渲染了，但用户看到的是所有三组（含酒精/无酒精/装饰）全部展开
- 用户期望：选了"含酒精自制"就只显示含酒精的类型标签；选了"无酒精自制"就只显示无酒精的类型标签
- 修复方案：增加顶层分组选择器后，类型选择区域只显示当前选中分组的类型

## 修复方案

### 方案：增加顶层分组选择器 + 类型区域按分组过滤

1. **在 type 字段上方增加 abvGroup 选择器**（三个大按钮：含酒精自制 / 无酒精自制 / 装饰）
   - 默认值：按当前 type 推断（isGarnishType ? "garnish" : classifyPrepGroup(...)）
   - 用户切换分组时，如果当前 type 不属于新分组，自动重置 type 到新分组的第一个类型

2. **类型选择区域只显示当前 abvGroup 的类型**
   - PREP_GROUPS.map 改为只渲染 grp.key === selectedGroup 的分组

3. **handleSave 直接用 selectedGroup 写入 abvGroup**
   - 不再依赖 isGarnishType 推断

## 关键文件
- /home/ubuntu/cocktail-r/app/homemade-form.tsx：主要修改文件
- /home/ubuntu/cocktail-r/lib/homemade/types.ts：PREP_GROUPS/PREP_SECTIONS/PREP_TYPES 定义
- /home/ubuntu/cocktail-r/app/(tabs)/homemade.tsx：列表页，按 prepGroupOf 分 Tab（无需大改）

## 技术细节
- PrepGroup = "alcoholic" | "non_alcoholic" | "garnish"
- PREP_GROUPS 三项：alcoholic/non_alcoholic/garnish
- isGarnishType 逻辑在第 127-131 行
- handleSave 写 abvGroup 在第 213-267 行（需确认）
- 类型选择 UI 在第 386-455 行
