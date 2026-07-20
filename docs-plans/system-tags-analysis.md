# 系统标签升级方案 - 代码分析结论

## 需要修改的文件

### 1. lib/recipes/types.ts
- `TagItem` 接口增加 `isSystem?: boolean` 字段
- `buildDefaultTags()` 中 duration/occasion 标签打上 `isSystem: true`

### 2. lib/recipes/store.tsx
- 启动时迁移：为已存在的 duration/occasion 标签补 `isSystem: true`
- `deleteTag` 函数：系统标签不允许删除（守卫）
- `renameTag` 函数：系统标签不允许改名（守卫）
- `addTag` 函数：duration/occasion 类型不允许新增（守卫）

### 3. app/tags.tsx
- `SECTION_KEYS` 移除 "duration" 和 "occasion"
- `isTagKind` 移除 duration/occasion（或保留但不展示）
- 顶部 Tab 切换器不再显示 duration/occasion
- `+` 按钮：当 section 为 duration/occasion 时隐藏（已不需要，因为 Tab 已移除）
- 在 ScrollView 末尾（`tags.hint` 前）新增「系统标签」折叠卡片
  - 包含两个子分组：饮用时长（短饮/长饮）和饮用场合（6个值）
  - 每行：颜色点（可点击打开 IOSColorPickerSheet）+ 标签名 + 使用数量 + 锁图标
  - 无拖拽、无编辑、无删除
  - 颜色修改走 `setTagColor(id, color)`

### 4. app/recipe/[id].tsx
- duration chip：从 `bg-surface border-border` 改为读取 `tags.find(t => t.kind==="duration" && t.name===recipe.drinkDuration)?.color`
- occasion chip：同上
- 有颜色时：`backgroundColor: color + "22"`, `color: color`（与 category chip 一致）

### 5. app/recipe-form.tsx
- duration chip 激活色：从硬编码 `#007AFF` 改为读取标签颜色（`tagsOf("duration").find(t => t.name===dur)?.color ?? "#007AFF"`）
- occasion chip 激活色：从硬编码 `#AF52DE` 改为读取标签颜色

### 6. lib/recipes/recipe-tag-renderer.tsx
- duration slot：`customColors.duration ?? tags.find(t => t.kind==="duration" && t.name===recipe.drinkDuration)?.color ?? "#007AFF"`
- occasion slot：同上
- 需要从 store 获取 tags（已有 `useRecipeStore`）

### 7. lib/i18n/translations.ts
- 新增 key：`"tags.system.title"` = { zh: "系统标签", en: "System Tags" }
- 新增 key：`"tags.system.hint"` = { zh: "系统标签不可增删改名，仅支持修改颜色", en: "System tags cannot be added, removed, or renamed. Only colors can be changed." }

## 关键数据流

### 颜色来源优先级（recipe-tag-renderer）
1. `customColors[slot]`（card-tag-settings 中用户自定义）
2. `tags.find(t => t.kind===kind && t.name===value)?.color`（标签管理页设置的颜色）
3. 硬编码默认色（`#007AFF` / `#AF52DE`）

### 系统标签 ID
- 由 `buildDefaultTags()` 生成，格式为 `tag-duration-N` / `tag-occasion-N`
- 实际 ID 在用户设备上已存储，通过 `tags.find(t => t.kind==="duration" && t.name===name)` 查找

## 注意事项
- `isSystem` 字段是可选的，旧数据不会有这个字段，store 启动时需要迁移
- 迁移逻辑：`tagList = tagList.map(t => (t.kind === "duration" || t.kind === "occasion") ? { ...t, isSystem: true } : t)`
- 系统标签折叠卡片需要独立的 `colorPickerId` state（与现有的 `colorPickerId` 隔离）
- recipe-tag-renderer 中 tags 已通过 `useRecipeStore()` 可访问

