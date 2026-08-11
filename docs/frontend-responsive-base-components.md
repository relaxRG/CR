# 基础组件移动端响应式布局规范

**版本：** 1.0  
**实现入口：** `lib/theme/responsive-layout-tokens.ts`  
**适用范围：** 搜索框、TextInput、下拉选择、筛选抽屉、批量编辑、底部操作栏、浮动 Tab、Modal/Sheet 及所有“文字 + 固定图标/按钮”的横向布局。

## 目标

在 375pt、390pt、430pt 宽度下，基础交互组件必须满足：可变文本不会推出固定控件；长选项不越出父容器；Modal 不造成根级横向滚动；底部操作按钮保持可读和可点击。

> 可变内容负责收缩，固定控件负责保留尺寸；空间不足时选项在自身容器换行，筛选条件在专用横向容器滚动，禁止把内容裁切或推到屏幕外。

## Layout Token

| Token | 用途 | 约束 |
|---|---|---|
| `RESPONSIVE_LAYOUT.fluidRowContent` | 输入框、候选名称、行内正文区域 | `flex: 1` + `minWidth: 0`，允许 Web/Flex 正确收缩。 |
| `RESPONSIVE_LAYOUT.fixedRowItem` | 图标、清除按钮、来源标签、关闭按钮 | `flexShrink: 0`，不会被长文字压缩或推出视口。 |
| `RESPONSIVE_LAYOUT.wrapOption` | 筛选、下拉、批量编辑和单位选择 Chip | 最大宽度为父容器 100%，可在自身容器换行。 |
| `RESPONSIVE_LAYOUT.rowText` | 与图标或徽标同行的文字 | `flexShrink: 1`，保留固定控件空间。 |
| `RESPONSIVE_LAYOUT.actionText` | 底部双按钮、导航标签 | 居中、可收缩；配合 `adjustsFontSizeToFit`。 |
| `RESPONSIVE_LAYOUT.sheetContent` | Sheet/Modal 内容容器 | 宽度不超过当前视口，最大内容宽度 640pt。 |

## 组件调用规范

### 搜索框和输入行

```tsx
<View style={styles.searchRow}>
  <Icon style={RESPONSIVE_LAYOUT.fixedRowItem} />
  <TextInput style={[RESPONSIVE_LAYOUT.fluidRowContent, styles.input]} />
  <Pressable style={RESPONSIVE_LAYOUT.fixedRowItem} />
</View>
```

输入区域不能只写 `flex: 1`；在 Web/Flex 环境中还必须使用 `minWidth: 0`，否则长文本可能扩大父容器。

### 下拉/筛选/单位选项

```tsx
<Pressable style={[styles.option, RESPONSIVE_LAYOUT.wrapOption]}>
  <Text numberOfLines={2} style={RESPONSIVE_LAYOUT.rowText}>长选项名称</Text>
</Pressable>
```

选项文字最多两行。若它属于筛选导航而非信息选项，应放入 `horizontal ScrollView` 并采用 `CHIP_BADGE_LAYOUT.scrollChip`，不要通过换行改变筛选栏高度。

### Modal 与底部操作

```tsx
<View style={[styles.sheet, RESPONSIVE_LAYOUT.sheetContent]}>
  <View style={styles.footer}>
    <Pressable style={styles.footerButton}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
        style={RESPONSIVE_LAYOUT.actionText}>
        确认并继续处理
      </Text>
    </Pressable>
  </View>
</View>
```

底部双按钮使用相等 `flex` 宽度。长本地化文案可缩至 80%，但不得缩小触控区域或制造页面级横向滚动。

## 审计结果与修复

| 组件 | 审计结论 | 本次处理 |
|---|---|---|
| `SearchBar` | 原结构已具备 `flex: 1`，但缺少 `minWidth: 0` 和固定按钮语义。 | 接入 fluid/fixed Token。 |
| `FilterSortSheet` | 长筛选标签和排序项可能在 `flexWrap` 中溢出。 | 选项最大宽度限制、最多两行、底部按钮自适应文字。 |
| `BulkEditSheet` | 长分类/标签选项可能超出 Sheet 宽度。 | 选项换行、固定色点、确认按钮文字缩放。 |
| `UnitPickerSheet` | 自定义或多语言单位标签可超出 Chip。 | 所有单位 Chip 使用可换行约束。 |
| `LinkPickerSheet` | 长候选名、来源标签和搜索框可能互相挤压。 | 输入/候选文本使用 fluid，来源/清除控件使用 fixed。 |
| `FloatingTabBar` | 多语言较长 Tab 标签可能在均分空间裁切。 | Tab 加 `minWidth: 0`；文字启用字体自适应。 |
| `BulkActionBar` | 操作项有横向滚动，风险低；批量编辑 Sheet 的选项存在风险。 | 保留操作栏横滚，修复编辑选项。 |

## 禁止模式

| 禁止 | 原因 | 替代 |
|---|---|---|
| 横向 TextInput 仅设置 `flex: 1` | 在 Web 下仍可能撑开父容器。 | `fluidRowContent`。 |
| 选项 Chip 无 `maxWidth` 且放在 `flexWrap` | 长文字可能越出屏幕。 | `wrapOption` + 两行文本。 |
| 关闭/清除/来源标签可 `flexShrink` | 长正文会挤掉关键操作。 | `fixedRowItem`。 |
| 底部按钮长文案不作处理 | 本地化后会截断或挤压。 | `actionText` + 字体自适应。 |
| 用页面级 ScrollView 解决 Sheet 横向溢出 | 掩盖组件问题且破坏交互。 | 组件内部收缩/换行。 |

## 发布前检查

1. 在 375/390/430pt 验证全局搜索、筛选抽屉、选择 Sheet、底部操作和浮动 Tab。
2. 使用至少一个 20 字中文选项、一个 30 字英文选项和 `99+` 数量夹具。
3. 确认 `document.documentElement.scrollWidth` 与 viewport 一致。
4. 确认底部操作区在安全区上方、长文字没有遮挡取消或关闭按钮。
5. 每个新增基础组件都应引用对应 Token，并增加结构或 H5 回归断言。
