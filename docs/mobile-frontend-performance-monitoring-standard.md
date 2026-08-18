# 移动端前端组件性能卡顿监控规范

## 1. 目的与适用范围

本规范用于防止移动端长列表、复杂卡片、分页容器和横向台账在数据量增长、状态同步或排序重构后出现可感知卡顿、错序和布局溢出。适用于 React Native / Expo 的原生端与 H5 回归环境，重点覆盖员工列表、考勤概况、库存台账、排班网格和可滚动筛选面板。

本规范把性能验证分为三层：**数据正确性、布局稳定性、交互响应性**。三层必须同时通过；仅证明“页面能打开”不代表移动端体验合格。

| 层级 | 必测对象 | 通过标准 |
|---|---|---|
| 数据正确性 | 数据条数、排序、筛选与状态同步 | 渲染记录数与夹具一致；顺序与唯一排序源一致。 |
| 布局稳定性 | 根节点、页面正文、专属滚动容器 | 根级无横向溢出；只允许设计明确的局部容器滚动。 |
| 交互响应性 | 滚动、分页、切换、展开/收起、状态更新 | 连续动画帧无明显主线程阻塞，状态不丢失、不回跳。 |

## 2. 标准长列表夹具

每个需要验证的员工或业务对象列表，都应使用**逆序写入、正序期望**的夹具。这样可以识别“碰巧依赖 Store 原数组顺序”的错误，而不是仅验证数据量。

```ts
const employees = Array.from({ length: 120 }, (_, index) => ({
  id: `employee-${String(index + 1).padStart(3, "0")}`,
  realName: `排序员工 ${String(index + 1).padStart(3, "0")}`,
  sortOrder: index + 1,
  active: true,
})).reverse();
```

夹具规模默认使用 120 条。它足以覆盖手机端较长的考勤、员工、供应商和台账列表；若目标模块使用虚拟列表、无限滚动或预计承载更高数据量，应在 300 条和 500 条两个档位追加测试。

## 3. 必须执行的断言

### 3.1 排序与完整渲染

回归脚本必须确认全部记录出现，并校验至少前五项与期望顺序一致。前五项断言可以快速识别部门排序、`sortOrder`、稳定兜底字段或过滤分组被破坏的问题。

```ts
expect(renderedEmployees).toBe(120);
expect(firstFive).toEqual([
  "排序员工 001",
  "排序员工 002",
  "排序员工 003",
  "排序员工 004",
  "排序员工 005",
]);
```

对于分组页面，还应分别断言分组顺序与组内顺序；对于历史页面，应断言其明确定义的历史顺序，不能错误继承当前档案顺序。

### 3.2 根级横向溢出

任何表格、标签、抽屉或卡片都不得推动浏览器根节点横向滚动。允许横向浏览的台账必须把滚动约束在明确的局部容器中。

```ts
if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
  throw new Error("出现根级横向溢出");
}
if (document.body.scrollWidth > document.documentElement.clientWidth) {
  throw new Error("body 出现根级横向溢出");
}
```

### 3.3 真实滚动容器与滚动生效

测试不能只调用 `window.scrollTo()` 后即宣布通过。脚本应定位实际 `overflowY: auto | scroll` 且 `scrollHeight > clientHeight` 的容器，执行连续滚动，并断言滚动位置发生变化。

```ts
const scroller = findScrollableContainer();
expect(scroller).toBeTruthy();
scroller.scrollTop += 320;
expect(scroller.scrollTop).toBeGreaterThan(0);
```

### 3.4 动画帧间隔

滚动期间连续采集 24 个 `requestAnimationFrame` 回调。当前严格回归阈值为**最大帧间隔不超过 100ms**；通常应显著低于该值。该阈值用于发现 JavaScript 主线程被长任务阻塞，而不是替代真实设备的 FPS 基准测试。

```ts
const gaps: number[] = [];
let previous = performance.now();
function step(now: number) {
  gaps.push(now - previous);
  previous = now;
  scroller.scrollTop += 320;
  if (gaps.length < 24) requestAnimationFrame(step);
  else expect(Math.max(...gaps)).toBeLessThanOrEqual(100);
}
requestAnimationFrame(step);
```

## 4. 推荐视口与回归命令

默认移动视口为 320pt、375pt 和 430pt，分别覆盖极窄屏、主流 iPhone 宽度与大屏手机。排班、Excel 台账等复杂页面还应额外覆盖 360、390 和 412pt。

当前员工排序长列表回归命令为：

```bash
pnpm test:h5:employee-order
```

该命令构建 H5 产物后，针对 120 名逆序存储员工验证考勤概况的完整渲染、档案排序、真实滚动容器、根级宽度和动画帧间隔。

## 5. 性能结果解释与边界

H5 设备模拟能够稳定捕获 DOM 溢出、逻辑错序、同步回跳和显著主线程长任务，但它不是低端实体设备的替代品。以下情形必须补充真机验证：

| 情形 | 必须补充的验证 |
|---|---|
| 使用大图片、视频、图表或 PDF 预览 | 中低端 iOS / Android 真机内存与滚动测试。 |
| 列表规模超过 500 条 | 验证虚拟列表、分页或增量渲染，避免一次性创建全部行。 |
| 伴随同步、筛选和后台计算 | 在弱网和 App 前后台切换中确认 UI 更新不阻塞。 |
| 原生手势或拖拽排序 | 在真机验证手势抢占、滚动惯性和无障碍操作。 |

## 6. 开发门禁

所有新建的可滚动业务组件应在 PR 中说明：夹具规模、目标视口、局部滚动容器、排序数据源和帧间隔阈值。若修改了列表数据源、排序工具、状态同步或布局容器，必须同步更新对应 H5 回归脚本和 Vitest 逻辑测试。

> 禁止把页面数组的当前遍历顺序当作业务排序。所有可见业务列表必须先进入唯一排序工具，再进行分组、筛选和渲染。

## 7. 当前员工排序回归的基线

2026-08-18 的 H5 回归中，120 名员工在 320pt、375pt、430pt 三个视口均完整渲染；根节点与正文宽度均等于视口宽度；24 帧连续滚动的最大帧间隔为 16.9ms。该结果可作为后续排序或考勤概况改造的参考基线，但不构成跨设备的绝对性能承诺。
