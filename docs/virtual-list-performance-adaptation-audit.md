# 虚拟列表与移动端性能规范适配审计

**项目**：Cocktail R  
**范围**：React Native `FlatList`、`NestableDraggableFlatList` 与长列表滚动回归  
**审计结论**：所有实际渲染的虚拟列表组件已统一接入移动端窗口化配置；未发现实际使用的 `SectionList` 或第三方 FlashList / RecyclerListView 实现。

## 1. 审计范围与发现

本次全库扫描覆盖 `app/` 与 `components/` 下的 React Native 列表组件、可拖拽嵌套列表、列表渲染参数和滚动处理。项目中不存在名为 `VirtualList` 的自定义组件，也未安装或使用 FlashList、RecyclerListView。实际列表技术栈是 React Native `FlatList` 与 `react-native-draggable-flatlist`。

`app/spirits-inventory.tsx` 曾导入但未渲染 `SectionList`。该未使用导入已经删除，避免将普通横向 Excel 台账错误视为虚拟列表。库存横向台账仍保留其必要的局部横向滚动语义，不会被本次纵向虚拟列表参数改造影响。

| 实现类型 | 数量 | 处理结果 |
|---|---:|---|
| `FlatList` 所在文件 | 18 | 每一个实际 JSX `FlatList` 都接入 `MOBILE_VIRTUAL_LIST_PROPS`。 |
| `NestableDraggableFlatList` 所在文件 | 2 | 每一个拖拽列表都接入 `MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS`。 |
| 实际 `SectionList` | 0 | 无需接入；删除一处未使用导入。 |
| FlashList / RecyclerListView | 0 | 未安装、未使用。 |

## 2. 统一性能策略

统一配置位于以下两层：

| 文件 | 职责 |
|---|---|
| `lib/performance/mobile-virtual-list-policy.ts` | 无原生依赖的策略常量，可被 Vitest 与客户端共同读取。 |
| `components/performance/mobile-virtual-list.ts` | React Native 平台适配层；Android 启用 `removeClippedSubviews`，iOS 保持关闭以规避动画行被错误裁剪。 |

标准 `FlatList` 配置如下：

```ts
{
  initialNumToRender: 12,
  maxToRenderPerBatch: 12,
  windowSize: 7,
  updateCellsBatchingPeriod: 40,
  removeClippedSubviews: Platform.OS === "android",
}
```

拖拽列表在此基础上增加 `autoscrollThreshold: 80` 和 `autoscrollSpeed: 120`。该策略避免首屏一次性创建过多项目，同时防止渲染窗口过小导致快速滚动白屏。每个列表保留自己的稳定 `keyExtractor`、数据源、筛选状态、滚动位置恢复和业务事件；本次只消除散落且缺失的渲染窗口策略，不重写业务状态机。

## 3. 已适配组件

| 类别 | 文件 | 列表用途 |
|---|---|---|
| 资料库与菜单 | `app/(tabs)/books.tsx`、`bottles.tsx`、`food.tsx`、`homemade.tsx`、`menu.tsx`、`recipes.tsx`、`shopping.tsx`、`wine.tsx` | 书籍、酒款、餐食、自制品、酒单、采购与葡萄酒浏览。 |
| 表单与研发 | `app/homemade-form.tsx`、`app/recipe-form.tsx`、`app/lab/plan.tsx`、`app/lab/projects.tsx` | 原料/步骤拖拽、实验计划和项目列表。 |
| 导入与日志 | `app/supplier-import.tsx`、`app/sync-log.tsx` | 供应商导入预览、同步日志。 |
| 库存 | `app/wine-inventory.tsx`、`components/store/petty-cash.tsx`、`components/store/purchase.tsx`、`components/store/sale.tsx` | 葡萄酒、备用金、采购与销售列表。 |
| 共享选择器 | `components/link-picker-sheet.tsx` | 关联对象检索与选择。 |

## 4. 性能与状态同步监控规范

每个长列表改造必须同时满足以下条件：

1. **排序与内容正确性**：逆序注入的 120 条夹具必须按唯一业务排序源展示；不能依赖 Store 数组原始顺序。
2. **根级宽度稳定性**：`document.documentElement.scrollWidth` 和 `document.body.scrollWidth` 都不能超过视口宽度。允许横向浏览时，滚动必须约束在明确的局部容器。
3. **真实滚动验证**：脚本必须找到具有溢出的纵向滚动容器并确认 `scrollTop` 实际变化；不能仅调用 `window.scrollTo()`。
4. **帧间隔监控**：连续采集 24 个 `requestAnimationFrame` 回调。最大间隔不得超过 100ms，以捕捉主线程长任务和可感知卡顿。
5. **状态同步稳定性**：列表筛选、选中、拖拽、分页或排序调整后，稳定 key 必须保持项目身份；数据重取、前后台同步或重新渲染不能令选中项错位或回跳。

当前员工考勤概况的 `pnpm test:h5:employee-order` 已经执行这些 H5 实机浏览器回归：120 名员工、320pt / 375pt / 430pt、真实滚动、根级溢出与 24 帧间隔。虚拟列表配置测试则保证所有组件不会在后续开发中丢失统一窗口参数。

## 5. 旧逻辑与遗留清理

| 清理项 | 处理 |
|---|---|
| 未使用的 `SectionList` 导入 | 已从烈酒库存移除。 |
| 列表各自缺失或不一致的虚拟化窗口 | 删除“未配置即默认”的分散行为，改为统一性能配置常量。 |
| 依赖原生 `Platform` 的测试策略 | 已拆分为纯策略模块与客户端适配模块，避免 Vitest 解析 React Native Flow 依赖失败。 |
| 一次性迁移脚本 | 已在应用配置后删除，不保留运行时或仓库垃圾文件。 |

## 6. 自动化门禁

`tests/mobile-virtual-list-policy.test.ts` 建立了 21 项防退化断言：

- 验证渲染窗口、批处理、拖拽自动滚动和帧间隔阈值的策略值；
- 对 18 个含 `FlatList` 的文件逐一计数，保证每个 JSX 列表均有统一属性展开；
- 验证两个嵌套拖拽列表使用专用配置；
- 验证员工 H5 长列表回归仍包含 120 条夹具、排序、根宽、真实滚动与帧间隔检查。

因此，后续若有人新增 `FlatList` 却没有接入 `MOBILE_VIRTUAL_LIST_PROPS`，或删除了长列表移动端关键断言，测试会失败。

## 7. 后续开发规则

> 新增 `FlatList` 时，必须使用 `MOBILE_VIRTUAL_LIST_PROPS`；新增可拖拽嵌套列表时，必须使用 `MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS`。任何例外都必须在代码旁说明原因，并新增专门的性能回归。

列表项目必须提供稳定 `keyExtractor`。对高度固定的高密度行，应评估是否补充 `getItemLayout`；对高度动态的卡片，不得伪造固定行高。数据量超过 500 条、单行包含图片/图表、或者同时发生同步和筛选时，除 H5 回归外还必须在中低端实体 iOS / Android 设备进行内存与交互验证。
