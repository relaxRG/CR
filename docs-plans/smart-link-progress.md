# 智能链接升级实施进度（2026-07-20 会话内部笔记）

## 用户确认的决策
1. 精确匹配默认自动链接；无匹配时自动创建入库（沿用现有 suggestion/classification 快捷入口）
2. 详情页已链接行：第一行显示库内规范名，第二行小字显示用户原文
3. 详情页装饰 = 列表行卡片样式（同配料，白卡片+每行一条+chevron），用户截图确认

## 已完成
- lib/recipes/types.ts：GarnishItem 接口、Recipe.garnishItems 字段、normalizeRecipe 迁移（garnish 字符串↔garnishItems 双向）、parseGarnishToItems / serializeGarnishItems 导出
- lib/recipes/store.tsx：RecipeDraft.garnishItems 字段（garnish 字段后）
- components/link-picker-sheet.tsx：新建多候选选择器 Bottom Sheet（LinkPickerSheet，Props: visible/initialQuery/bottles/preps/groupOf/onPick/onClose；LinkPickResult = bottle|prep|none；用 suggestIngredients 的 refId）
- lib/i18n/translations.ts：新增 form.link.dismissed/relink/rebind/more/pickTitle/keepText/noResults/searchPlaceholder
- app/recipe-form.tsx：
  - 导入 GarnishItem/parseGarnishToItems/serializeGarnishItems + LinkPickerSheet
  - garnishRows 改为 GarnishItem[]，从 editing.garnishItems 优先初始化
  - linkPickerTarget state（scope garnish|ingredient + id + query）
  - handleSave 写入 draft.garnishItems（过滤空名，linkDismissed 持久化）
  - 装饰行四状态判定（gDismissed > explicitGLink(ID解析) > rawGLink auto/fuzzy），换绑/更多候选/重新链接按钮
  - 配料行四状态判定（iDismissed > explicitLink > rawLink），同样按钮；suggestion/classification 在 dismissed 时不显示
  - 表单尾部（UnitPickerSheet 之后）挂载 LinkPickerSheet，onPick 写入显式 ID 或 linkDismissed

## 待完成
## 已全部完成（2026-07-20）
1. ✅ tsc 0 错误
2. ✅ 详情页装饰改列表行卡片（garnishItems 优先/尊重忽略/规范名+原文小字/chevron 可点）
3. ✅ estimateGarnishCost 支持 garnishItems 通道（显式 ID + linkDismissed，忽略的不进 unmatchedNames→不触发自动入库）
4. ✅ 自制库表单补「全」来源筛选按钮 + exact 断开持久化 + 已忽略提示/重新匹配
5. ✅ 新测试 tests/garnish-items.test.ts 7 项；全量 42 通过
6. ✅ web 截图验证（recipe-form 的 findNodeHandle 报错为 draggable-flatlist 在 web 的存量已知问题，已用 git stash 对比确认与本轮改动无关，真机不受影响）
7. 批量导入/AI 解析生成 garnishItems（可延后，旧字符串通道仍兼容）

## 遗留观察
- web 控制台 "Unexpected text node: . A text node cannot be a child of a <View>."：仅在 /recipe-form SSR（λ）渲染时出现；22:56:06 时段是 stash 后的旧 HEAD 版本同样触发 → 确认为存量问题，与本轮改动无关；22:59 首页截图不触发。findNodeHandle（draggable-flatlist web 已知问题）同样存量，真机不受影响。

## 关键代码位置（行号约）
- recipe-form.tsx 配料行 renderIngredientItem ~982；装饰行 map ~2100；handleSave draft ~1340
- recipe/[id].tsx 装饰渲染区块 grep "garnish"
- smart-link.ts: smartLinkIngredient(name, bottles, preps, source?) 返回 {kind:bottle|prep, matchConfidence: exact|fuzzy}
- suggest.ts: suggestIngredients(q, bottles, preps, lang, limit, groupOf) → IngredientSuggestion{refId, source, value, secondary}
